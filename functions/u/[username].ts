// GET /u/:username — Pages Function fallback for unprerendered authors (F-01).
//
// Same pattern as functions/pkg/[name].ts: serves the static
// `/pkg/author` shell with a 200, keeping the pretty URL. The shell
// resolves the login from the last path segment (see `resolveSlug`).
import { PKG_NAME_RE } from '../api/_validate';

export async function onRequestGet(context: any) {
  const { request, env, params } = context;
  const login = params.username as string;

  if (!login || !PKG_NAME_RE.test(login)) {
    return new Response(JSON.stringify({ error: 'Author not found' }), {
      status: 404,
      headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
    });
  }

  // Fetch the canonical trailing-slash shell URL: Pages 308-redirects
  // extensionless and `.html` URLs to clean form, and ASSETS.fetch
  // surfaces those redirects instead of following them.
  const shellUrl = new URL('/pkg/author/', request.url);
  let shell: Response;
  try {
    shell = await env.ASSETS.fetch(new Request(shellUrl.toString(), request));
  } catch {
    return new Response(JSON.stringify({ error: 'registry unreachable' }), {
      status: 502,
      headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
    });
  }
  if (!shell.ok) {
    return new Response(JSON.stringify({ error: 'Author not found' }), {
      status: 404,
      headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
    });
  }

  const html = await shell.text();
  const headers = new Headers(shell.headers);
  headers.set('Cache-Control', 'public, max-age=60, stale-while-revalidate=600');
  headers.set('Link', `<${new URL(`/u/${encodeURIComponent(login)}`, request.url).toString()}>; rel="canonical"`);
  return new Response(html, { status: 200, headers });
}
