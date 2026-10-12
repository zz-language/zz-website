// Pages middleware: `/docs/*` rewrite (NOT redirect — URL is preserved).
//
// Starlight generates docs at site root (/getting-started, /stdlib/str,
// …) and has no subpath-mount option, so this middleware maps the public
// `/docs/<slug>` namespace onto those pages at the edge:
//   /docs/getting-started → serves /getting-started/ (URL stays /docs/…)
// Anything else passes through untouched. Unknown slugs fall through to
// the branded 404. Only runs for paths matched by public/_routes.json.
export async function onRequest(context: any) {
  const url = new URL(context.request.url);
  const path = url.pathname;

  // Exact hub + non-docs traffic: let static/functions handle it.
  if (path === '/docs/' || !path.startsWith('/docs/')) {
    return await context.next();
  }

  let stripped = path.slice('/docs'.length);
  if (!stripped.startsWith('/')) stripped = '/' + stripped;
  // Canonical trailing-slash form: Pages 308s extensionless/.html URLs
  // and ASSETS.fetch surfaces those redirects instead of following them.
  const last = stripped.split('/').pop() || '';
  if (!stripped.endsWith('/') && !last.includes('.')) stripped += '/';

  try {
    const target = new URL(stripped, url.origin);
    target.search = url.search;
    const res = await context.env.ASSETS.fetch(new Request(target.toString(), context.request));
    // A miss here means "no such docs page" — fall through to the 404
    // rather than leaking a wrong-body 200 or a bare status.
    if (!res.ok) return await context.next();
    const headers = new Headers(res.headers);
    headers.set('Cache-Control', 'public, max-age=300, stale-while-revalidate=600');
    headers.set('Link', `<${url.origin}/docs${stripped}>; rel="canonical"`);
    return new Response(await res.text(), { status: 200, headers });
  } catch {
    return await context.next();
  }
}
