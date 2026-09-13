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
  const { name, version, tarball_b64, readme_md, deps, description, repo } = body;

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

  try {
    // Upload tarball to R2
    const tarballBytes = Uint8Array.from(atob(tarball_b64), c => c.charCodeAt(0));
    const tarballKey = `pkgs/${name}/${version}.tgz`;
    await env.PKGS.put(tarballKey, tarballBytes);

    // Upload README to R2
    if (readme_md) {
      const readmeKey = `readmes/${name}/${version}.md`;
      await env.PKGS.put(readmeKey, readme_md);
    }

    // Upsert package metadata in D1
    await env.DB.prepare(
      'INSERT OR REPLACE INTO packages (name, latest, author, repo, description, updated_at) VALUES (?, ?, ?, ?, ?, ?)'
    ).bind(name, version, userRow.github_login, repo || '', description || '', Date.now()).run();

    // Insert version record
    await env.DB.prepare(
      'INSERT OR IGNORE INTO versions (pkg, version, tarball_key, readme_key, deps, published_at) VALUES (?, ?, ?, ?, ?, ?)'
    ).bind(name, version, tarballKey, readme_md ? `readmes/${name}/${version}.md` : null, JSON.stringify(deps || {}), Date.now()).run();

    return new Response(JSON.stringify({ ok: true, url: `/pkg/${name}` }), {
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
