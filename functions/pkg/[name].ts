// GET /pkg/:name — Pages Function fallback for unprerendered packages (F-01).
//
// Fully static Pages output only has HTML for names snapshotted by
// `getStaticPaths()` at build time, so packages published after the last
// build 404 until a manual rebuild. This function serves the static
// `/pkg/view` shell with a 200 while keeping the pretty URL in the
// address bar. The shell's client script resolves the name from the last
// path segment (see `resolveSlug` in src/lib/pkg-api.ts), so no URL
// mangling or redirects are needed.
//
// Precedence: prerendered /pkg/<name>.html wins over this function when
// present (static assets beat Functions); this only fires on misses.
// Rollback: delete this file to restore pure-static behavior.
import { PKG_NAME_RE } from '../api/_validate';

const RESERVED = new Set(['view', 'author', 'tokens']);

export async function onRequestGet(context: any) {
  const { request, env, params } = context;
  const name = params.name as string;

  if (!name || RESERVED.has(name) || !PKG_NAME_RE.test(name)) {
    return new Response(JSON.stringify({ error: 'Package not found' }), {
      status: 404,
      headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
    });
  }

  const shellUrl = new URL('/pkg/view', request.url);
  let shell: Response;
  try {
    // ASSETS serves static files directly (no function re-entry, no loop).
    shell = await env.ASSETS.fetch(new Request(shellUrl.toString(), request));
  } catch {
    return new Response(JSON.stringify({ error: 'registry unreachable' }), {
      status: 502,
      headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
    });
  }
  if (!shell.ok) {
    return new Response(JSON.stringify({ error: 'Package not found' }), {
      status: 404,
      headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
    });
  }

  const html = await shell.text();
  const headers = new Headers(shell.headers);
  headers.set('Cache-Control', 'public, max-age=60, stale-while-revalidate=600');
  headers.set('Link', `<${new URL(`/pkg/${encodeURIComponent(name)}`, request.url).toString()}>; rel="canonical"`);
  return new Response(html, { status: 200, headers });
}
