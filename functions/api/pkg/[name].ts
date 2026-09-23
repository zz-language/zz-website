// GET /api/pkg/[name] — Get package details
export async function onRequestGet(context: any) {
  const { env, params } = context;
  const name = params.name;

  try {
    // Get package metadata
    const pkg = await env.DB.prepare(
      'SELECT * FROM packages WHERE name = ?'
    ).bind(name).first();

    if (!pkg) {
      return new Response(JSON.stringify({ error: 'Package not found' }), {
        status: 404,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    // Get all versions
    const versions = await env.DB.prepare(
      'SELECT version, deps, license, tarball_sha256, published_at FROM versions WHERE pkg = ? ORDER BY published_at DESC'
    ).bind(name).all();

    // Get latest version details
    const latestVersion = versions.results?.[0];

    // Get README from R2
    let readme = '';
    if (latestVersion) {
      const versionData = await env.DB.prepare(
        'SELECT readme_key FROM versions WHERE pkg = ? AND version = ?'
      ).bind(name, pkg.latest).first();

      if (versionData?.readme_key) {
        const readmeObj = await env.PKGS.get(versionData.readme_key);
        if (readmeObj) {
          readme = await readmeObj.text();
        }
      }
    }

    return new Response(JSON.stringify({
      metadata: {
        name: pkg.name,
        latest: pkg.latest,
        author: pkg.author,
        repo: pkg.repo,
        description: pkg.description,
        license: pkg.license || latestVersion?.license || '',
        versions: versions.results?.map((v: any) => v.version) || [],
        // Per-version integrity + license map so installers can verify
        // any pinned version, not just `latest`.
        version_details:
          versions.results?.reduce((acc: any, v: any) => {
            acc[v.version] = {
              sha256: v.tarball_sha256 || '',
              license: v.license || '',
            };
            return acc;
          }, {}) || {},
        deps: latestVersion?.deps ? JSON.parse(latestVersion.deps) : {},
        tarball_sha256: latestVersion?.tarball_sha256 || '',
        download_url: `/api/pkg/${pkg.name}/${pkg.latest}.tgz`,
      },
      readme,
    }), {
      headers: {
        'Content-Type': 'application/json',
        'Cache-Control': 'public, max-age=300',
      },
    });
  } catch {
    return new Response(JSON.stringify({ error: 'Package not found' }), {
      status: 404,
      headers: { 'Content-Type': 'application/json' },
    });
  }
}
