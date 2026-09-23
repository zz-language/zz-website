// GET /api/pkg/:name/:version.tgz — Download a package tarball
//
// Serves `pkgs/{name}/{version}.tgz` directly from R2, mirroring the
// storage key layout. Accepts the version with or without the `.tgz`
// suffix so both of these work:
//   GET /api/pkg/zimg/0.1.0.tgz
//   GET /api/pkg/zimg/0.1.0
//
// Response headers:
// - `Content-Type: application/gzip`
// - `Content-Disposition: attachment; filename="<name>-<version>.tar.gz"`
// - `ETag: "<tarball_sha256>"` when the versions row records a hash
// - `Cache-Control: public, max-age=31536000, immutable` (tarballs are
//   content-addressed and never mutated; republishing the same version
//   is rejected at publish time)
export async function onRequestGet(context: any) {
  const { env, params } = context;
  const rawName = params.name as string;
  const rawVersion = params.version as string;

  // Validate package name (same allowlist as publish).
  if (!rawName || !/^[a-z0-9-_]+$/.test(rawName)) {
    return new Response(JSON.stringify({ error: 'Invalid package name' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  // Accept an optional `.tgz` suffix; the R2 key never contains it twice.
  const version = rawVersion?.endsWith('.tgz')
    ? rawVersion.slice(0, -'.tgz'.length)
    : rawVersion;

  // Strict semver (same allowlist as publish) — rejects `..`, `/`, etc.
  if (!version || !/^\d+\.\d+\.\d+$/.test(version)) {
    return new Response(JSON.stringify({ error: 'Invalid version (use semver)' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  try {
    const tarballKey = `pkgs/${rawName}/${version}.tgz`;
    const obj = await env.PKGS.get(tarballKey);
    if (!obj) {
      return new Response(JSON.stringify({ error: 'Tarball not found' }), {
        status: 404,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    // Look up the recorded content hash for ETag / integrity signalling.
    // Missing rows (legacy publishes) simply omit the ETag — the client
    // still verifies whatever hash the lockfile pins.
    let etag: string | null = null;
    try {
      const row = await env.DB.prepare(
        'SELECT tarball_sha256 FROM versions WHERE pkg = ? AND version = ?'
      )
        .bind(rawName, version)
        .first();
      if (row?.tarball_sha256) {
        etag = `"${row.tarball_sha256}"`;
      }
    } catch {
      // D1 lookup is best-effort here; the bytes are authoritative.
    }

    const headers: Record<string, string> = {
      'Content-Type': 'application/gzip',
      'Content-Disposition': `attachment; filename="${rawName}-${version}.tar.gz"`,
      'Cache-Control': 'public, max-age=31536000, immutable',
    };
    if (etag) {
      headers['ETag'] = etag;
    }

    return new Response(obj.body, { headers });
  } catch {
    return new Response(JSON.stringify({ error: 'Download failed' }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }
}
