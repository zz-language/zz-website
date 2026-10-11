// GET /api/pkg/search?q=&limit=&author= — Search packages (proxy).
//
// Pure pass-through to the authoritative registry. Every row the registry
// returns (name, latest, description, author, license, downloads, category)
// is forwarded verbatim so listing pages never need per-package detail
// fetches (see F-04). Failures are 502s, never empty arrays: an empty
// array means "zero matches", not "registry is down" (F-07).
import { PKG_NAME_RE, CATEGORIES } from '../_validate';

const FALLBACK_UPSTREAM = 'https://zz-registry.onrender.com';

function upstreamBase(env: any): string {
  const raw = typeof env?.REGISTRY_UPSTREAM === 'string' ? env.REGISTRY_UPSTREAM : '';
  return raw.replace(/\/+$/, '') || FALLBACK_UPSTREAM;
}

export async function onRequestGet(context: any) {
  const { env, request } = context;
  const ray = request.headers.get('cf-ray');
  const url = new URL(request.url);
  const limit = Math.min(Math.max(parseInt(url.searchParams.get('limit') || '20', 10) || 20, 1), 100);
  const author = url.searchParams.get('author') || '';
  const category = (url.searchParams.get('category') || '').toLowerCase();

  if (author && !PKG_NAME_RE.test(author)) {
    return new Response(JSON.stringify({ error: 'Invalid author' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
    });
  }

  if (category && !CATEGORIES.includes(category)) {
    return new Response(JSON.stringify({ error: 'Invalid category' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
    });
  }

  const upstreamUrl =
    `${upstreamBase(env)}/api/pkg/search?q=${encodeURIComponent(url.searchParams.get('q') || '')}` +
    `&limit=${limit}` +
    (author ? `&author=${encodeURIComponent(author)}` : '') +
    (category ? `&category=${encodeURIComponent(category)}` : '');

  try {
    const upstream = await fetch(upstreamUrl, { headers: { Accept: 'application/json' } });
    if (!upstream.ok) {
      if (ray) console.error(`[pkg-search] upstream ${upstream.status} ray=${ray}`);
      return new Response(JSON.stringify({ error: 'registry unreachable' }), {
        status: 502,
        headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
      });
    }
    const data = await upstream.json();
    return new Response(JSON.stringify(Array.isArray(data) ? data : []), {
      headers: {
        'Content-Type': 'application/json',
        'Cache-Control': 'public, max-age=60, stale-while-revalidate=300',
      },
    });
  } catch {
    if (ray) console.error(`[pkg-search] network failure ray=${ray}`);
    return new Response(JSON.stringify({ error: 'registry unreachable' }), {
      status: 502,
      headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
    });
  }
}
