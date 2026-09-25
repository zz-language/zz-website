// Cloudflare Pages Function: dynamic `/pkg/:name` without site rebuilds.
//
// Static prerendering (`src/pages/pkg/[name].astro` + getStaticPaths) covers
// packages known at build time — static files always win. This function is
// the fallback for everything else (newly published packages): it checks
// the live registry, then serves the static `/pkg/view` shell (single
// source of truth, edge-cached) with the package name injected, so the
// existing client code paints details, README, and owner settings.
//
// Responses: 200 + shell (known-live package), 404 + minimal page
// (unknown), 502/503 (registry or shell unreachable). No dependencies.

const REGISTRY_API = 'https://zz-registry.onrender.com';
const SHELL_TTL = 3600;
const API_TTL = 300;

function json(body, status, cacheTtl) {
  return new Response(body, {
    status,
    headers: {
      'Content-Type': 'text/html;charset=UTF-8',
      'Cache-Control': `public, max-age=${cacheTtl}, s-maxage=${cacheTtl}, stale-while-revalidate=86400`,
    },
  });
}

function esc(s) {
  return String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

// eslint-disable-next-line import/prefer-default-export
export async function onRequestGet({ params, request }) {
  const name = (params.name || '').trim();
  if (!name || name.length > 128 || !/^[A-Za-z0-9._-]+$/.test(name)) {
    return json(notFoundHtml(''), 404, 60);
  }

  let alive = false;
  try {
    const res = await fetch(`${REGISTRY_API}/api/pkg/${encodeURIComponent(name)}`, {
      cf: { cacheTtl: API_TTL, cacheEverything: true },
    });
    if (res.status === 404) return json(notFoundHtml(name), 404, 60);
    if (!res.ok) throw new Error(`registry responded ${res.status}`);
    // Body intentionally unread: existence is the gate; the shell's
    // client code loads full details itself.
    alive = true;
  } catch {
    return json(
      `<h1>Registry unreachable</h1><p>Try again in a moment.</p>`,
      502,
      60,
    );
  }
  if (!alive) return json(notFoundHtml(name), 404, 60);

  const url = new URL(request.url);
  // Trailing slash: the extensionless path 308-redirects to it.
  let shell;
  try {
    const res = await fetch(`${url.origin}/pkg/view/`, {
      cf: { cacheTtl: SHELL_TTL, cacheEverything: true },
    });
    if (!res.ok) throw new Error(`shell responded ${res.status}`);
    shell = await res.text();
  } catch {
    return json(
      `<h1>Service unavailable</h1><p>Try again in a moment.</p>`,
      503,
      60,
    );
  }
  const injected = shell.replace(
    '</head>',
    `<script>window.__PKG_NAME__=${JSON.stringify(name)};</script></head>`,
  );
  return json(injected, 200, API_TTL);
}

function notFoundHtml(name) {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>Package not found</title></head><body>
<div style="max-width:42rem;margin:4rem auto;padding:0 1rem;font-family:system-ui,sans-serif;text-align:center">
<h1>Package not found</h1>
<p>The package "${esc(name)}" does not exist yet.</p>
<code>zz publish</code>
</div></body></html>`;
}
