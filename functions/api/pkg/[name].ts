// GET /api/pkg/[name] — Get package details (proxy).
//
// Pure pass-through to the authoritative registry (Render + Supabase).
// An earlier revision queried D1/R2 directly with V1 names (`versions`,
// `readme_key`, `env.PKGS`) and drifted from registry V2, serving 404s for
// healthy packages — so the proxy no longer reads storage bindings at all.
// D1 is a stale V1 snapshot; serving it would be worse than an honest 502,
// hence there is intentionally no DB fallback here.
//
// Contract:
// - upstream 404 → 404 `{error}`
// - upstream 5xx / network failure → 502 `{error: 'registry unreachable'}`
// - success → upstream JSON verbatim + `ETag` + edge cache headers
import { PKG_NAME_RE } from '../_validate';

const FALLBACK_UPSTREAM = 'https://zz-registry.onrender.com';

function upstreamBase(env: any): string {
  const raw = typeof env?.REGISTRY_UPSTREAM === 'string' ? env.REGISTRY_UPSTREAM : '';
  return raw.replace(/\/+$/, '') || FALLBACK_UPSTREAM;
}

function errorBody(status: number, message: string, ray: string | null): Response {
  if (ray) console.error(`[pkg-detail] ${status} ray=${ray} ${message}`);
  return new Response(JSON.stringify({ error: message }), {
    status,
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
  });
}

export async function onRequestGet(context: any) {
  const { env, params, request } = context;
  const name = params.name as string;
  const ray = request.headers.get('cf-ray');

  if (!name || !PKG_NAME_RE.test(name)) {
    return errorBody(400, 'Invalid package name', ray);
  }

  let upstream: Response;
  try {
    upstream = await fetch(`${upstreamBase(env)}/api/pkg/${encodeURIComponent(name)}`, {
      headers: { Accept: 'application/json' },
      // Never forward browser credentials upstream on a public GET.
    });
  } catch {
    return errorBody(502, 'registry unreachable', ray);
  }

  if (upstream.status === 404) {
    return errorBody(404, 'Package not found', ray);
  }
  if (!upstream.ok) {
    return errorBody(502, 'registry unreachable', ray);
  }

  let payload: any;
  try {
    payload = await upstream.json();
  } catch {
    return errorBody(502, 'registry unreachable', ray);
  }

  const md = payload?.metadata ?? {};
  const sha = typeof md.tarball_sha256 === 'string' ? md.tarball_sha256.slice(0, 12) : '';
  const etag = `W/"${md.latest ?? ''}-${sha}"`;

  if (request.headers.get('if-none-match') === etag) {
    return new Response(null, {
      status: 304,
      headers: { ETag: etag, 'Cache-Control': 'public, max-age=60, stale-while-revalidate=600' },
    });
  }

  return new Response(JSON.stringify(payload), {
    headers: {
      'Content-Type': 'application/json',
      'Cache-Control': 'public, max-age=60, stale-while-revalidate=600',
      ETag: etag,
      Vary: 'Origin',
    },
  });
}
