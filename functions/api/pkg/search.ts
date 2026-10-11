// GET /api/pkg/search?q=&limit=&offset=&author=&category=&sort=&envelope= — Search (proxy).
//
// Pure pass-through to the authoritative registry. Every row the registry
// returns is forwarded verbatim so listing pages never need per-package
// detail fetches. `envelope=1` returns {items, total, limit, offset};
// otherwise a bare array (legacy clients). Failures are 502s, never
// empty arrays: an empty array means "zero matches" (F-07).
import { PKG_NAME_RE, CATEGORIES } from '../_validate';

const FALLBACK_UPSTREAM = 'https://zz-registry.onrender.com';
const SORTS = ['updated', 'downloads', 'name'];

function upstreamBase(env: any): string {
  const raw = typeof env?.REGISTRY_UPSTREAM === 'string' ? env.REGISTRY_UPSTREAM : '';
  return raw.replace(/\/+$/, '') || FALLBACK_UPSTREAM;
}

function badParam(message: string): Response {
  return new Response(JSON.stringify({ error: message }), {
    status: 400,
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
  });
}

export async function onRequestGet(context: any) {
  const { env, request } = context;
  const ray = request.headers.get('cf-ray');
  const url = new URL(request.url);
  const limit = Math.min(Math.max(parseInt(url.searchParams.get('limit') || '20', 10) || 20, 1), 100);
  const offset = Math.min(Math.max(parseInt(url.searchParams.get('offset') || '0', 10) || 0, 0), 10000);
  const author = url.searchParams.get('author') || '';
  const category = (url.searchParams.get('category') || '').toLowerCase();
  const license = url.searchParams.get('license') || '';
  const maturity = (url.searchParams.get('maturity') || '').toLowerCase();
  const sort = (url.searchParams.get('sort') || 'updated').toLowerCase();
  const envelope = url.searchParams.get('envelope') || '';

  if (author && !PKG_NAME_RE.test(author)) return badParam('Invalid author');
  if (category && !CATEGORIES.includes(category)) return badParam('Invalid category');
  if (license && (license.length > 64 || /[<>"'&]/.test(license))) return badParam('Invalid license');
  if (maturity && maturity !== 'stable' && maturity !== 'early') return badParam('Invalid maturity');
  if (!SORTS.includes(sort)) return badParam('Invalid sort (want updated, downloads, or name)');

  const params = new URLSearchParams({
    q: url.searchParams.get('q') || '',
    limit: String(limit),
    offset: String(offset),
    sort,
  });
  if (author) params.set('author', author);
  if (category) params.set('category', category);
  if (license) params.set('license', license);
  if (maturity) params.set('maturity', maturity);
  if (envelope === '1') params.set('envelope', '1');

  try {
    const upstream = await fetch(`${upstreamBase(env)}/api/pkg/search?${params.toString()}`, {
      headers: { Accept: 'application/json' },
    });
    if (!upstream.ok) {
      if (ray) console.error(`[pkg-search] upstream ${upstream.status} ray=${ray}`);
      return new Response(JSON.stringify({ error: 'registry unreachable' }), {
        status: 502,
        headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
      });
    }
    const data = await upstream.json();
    // Envelope passes through verbatim; legacy arrays pass as-is.
    const body = data && typeof data === 'object' && Array.isArray((data as any).items) ? data : Array.isArray(data) ? data : [];
    return new Response(JSON.stringify(body), {
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
