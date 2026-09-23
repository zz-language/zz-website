// POST /api/pkg/publish — Publish a package
export async function onRequestPost(context: any) {
  const { env, request } = context;

  // Verify API token
  const authHeader = request.headers.get('Authorization');
  if (!authHeader?.startsWith('Bearer zz_pat_')) {
    return new Response(JSON.stringify({ error: 'Invalid token format' }), {
      status: 401,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  const token = authHeader.slice(7);
  const tokenHash = await hashToken(token);

  const tokenRow = await env.DB.prepare(
    'SELECT user_id FROM tokens WHERE hash = ?'
  ).bind(tokenHash).first();

  if (!tokenRow) {
    return new Response(JSON.stringify({ error: 'Invalid token' }), {
      status: 401,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  const userRow = await env.DB.prepare(
    'SELECT github_login FROM users WHERE id = ?'
  ).bind(tokenRow.user_id).first();

  // Parse body
  const body = await request.json();
  const {
    name,
    version,
    tarball_b64,
    readme_md,
    deps,
    description,
    repo,
    license,
    tarball_sha256,
  } = body;

  // Validate name
  if (!/^[a-z0-9-_]+$/.test(name)) {
    return new Response(JSON.stringify({ error: 'Invalid package name' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  // Validate semver
  if (!/^\d+\.\d+\.\d+$/.test(version)) {
    return new Response(JSON.stringify({ error: 'Invalid version (use semver)' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  // Validate tarball payload
  if (!tarball_b64 || typeof tarball_b64 !== 'string') {
    return new Response(JSON.stringify({ error: 'Missing tarball' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  // Validate client-claimed content hash when provided (hex SHA-256).
  if (
    tarball_sha256 !== undefined &&
    (typeof tarball_sha256 !== 'string' || !/^[0-9a-f]{64}$/.test(tarball_sha256))
  ) {
    return new Response(JSON.stringify({ error: 'Invalid tarball_sha256 (want hex SHA-256)' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  // License is a short SPDX identifier (e.g. "MIT"). Free-form but bounded
  // so it cannot be abused as a second README.
  if (license !== undefined && (typeof license !== 'string' || license.length > 64)) {
    return new Response(JSON.stringify({ error: 'Invalid license (max 64 chars)' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  try {
    // Decode + verify the tarball before storing anything.
    const tarballBytes = Uint8Array.from(atob(tarball_b64), c => c.charCodeAt(0));
    const digest = await crypto.subtle.digest('SHA-256', tarballBytes);
    const actualSha256 = Array.from(new Uint8Array(digest))
      .map(b => b.toString(16).padStart(2, '0'))
      .join('');
    if (tarball_sha256 && tarball_sha256 !== actualSha256) {
      return new Response(JSON.stringify({ error: 'Tarball hash mismatch' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    // Tarballs are immutable: republishing an existing version is a
    // conflict, never a silent overwrite.
    const existing = await env.DB.prepare(
      'SELECT version FROM versions WHERE pkg = ? AND version = ?'
    )
      .bind(name, version)
      .first();
    if (existing) {
      return new Response(JSON.stringify({ error: 'Version already published' }), {
        status: 409,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    // Upload tarball to R2
    const tarballKey = `pkgs/${name}/${version}.tgz`;
    await env.PKGS.put(tarballKey, tarballBytes);

    // Upload README to R2
    if (readme_md) {
      const readmeKey = `readmes/${name}/${version}.md`;
      await env.PKGS.put(readmeKey, readme_md);
    }

    // Upsert package metadata in D1
    await env.DB.prepare(
      'INSERT OR REPLACE INTO packages (name, latest, author, repo, description, license, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)'
    ).bind(name, version, userRow.github_login, repo || '', description || '', license || '', Date.now()).run();

    // Insert version record
    await env.DB.prepare(
      'INSERT INTO versions (pkg, version, tarball_key, tarball_sha256, readme_key, deps, license, published_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)'
    ).bind(name, version, tarballKey, actualSha256, readme_md ? `readmes/${name}/${version}.md` : null, JSON.stringify(deps || {}), license || '', Date.now()).run();

    return new Response(JSON.stringify({ ok: true, url: `/pkg/${name}`, sha256: actualSha256 }), {
      status: 201,
      headers: { 'Content-Type': 'application/json' },
    });
  } catch (err) {
    return new Response(JSON.stringify({ error: 'Publish failed' }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }
}

async function hashToken(token: string): Promise<string> {
  const encoder = new TextEncoder();
  const data = encoder.encode(token);
  const hashBuffer = await crypto.subtle.digest('SHA-256', data);
  return Array.from(new Uint8Array(hashBuffer)).map(b => b.toString(16).padStart(2, '0')).join('');
}
