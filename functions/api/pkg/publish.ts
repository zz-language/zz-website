// POST /api/pkg/publish — Publish a package (proxy).
//
// Forwards to the authoritative registry (Render + Supabase + GitHub
// Releases), the single writer. An earlier revision wrote straight to
// D1/R2 (V1 store) — packages published that way "succeeded" yet never
// appeared in the catalog. The proxy now only validates cheaply for fast
// 400s and relays everything else, preserving upstream status codes.
//
// The user's Bearer credential IS forwarded here (unlike public GETs):
// publishing is authenticated by definition, and the upstream owns
// token verification.
import { PKG_NAME_RE, SEMVER_RE } from '../_validate';

const FALLBACK_UPSTREAM = 'https://zz-registry.onrender.com';

function upstreamBase(env: any): string {
  const raw = typeof env?.REGISTRY_UPSTREAM === 'string' ? env.REGISTRY_UPSTREAM : '';
  return raw.replace(/\/+$/, '') || FALLBACK_UPSTREAM;
}

function badRequest(message: string): Response {
  return new Response(JSON.stringify({ error: message }), {
    status: 400,
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
  });
}

export async function onRequestPost(context: any) {
  const { env, request } = context;
  const ray = request.headers.get('cf-ray');

  const authHeader = request.headers.get('Authorization');
  if (!authHeader?.startsWith('Bearer zz_pat_')) {
    return new Response(JSON.stringify({ error: 'Invalid token format' }), {
      status: 401,
      headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
    });
  }

  let body: any;
  try {
    body = await request.json();
  } catch {
    return badRequest('Invalid JSON body');
  }

  // Fast local rejects before spending an upstream round-trip.
  const { name, version } = body ?? {};
  if (typeof name !== 'string' || !PKG_NAME_RE.test(name)) {
    return badRequest('Invalid package name');
  }
  if (typeof version !== 'string' || !SEMVER_RE.test(version)) {
    return badRequest('Invalid version (use semver)');
  }

  try {
    const upstream = await fetch(`${upstreamBase(env)}/api/pkg/publish`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json',
        Authorization: authHeader,
      },
      body: JSON.stringify(body),
    });
    const text = await upstream.text();
    return new Response(text, {
      status: upstream.status,
      headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
    });
  } catch {
    if (ray) console.error(`[pkg-publish] upstream unreachable ray=${ray} pkg=${name}@${version}`);
    return new Response(JSON.stringify({ error: 'registry unreachable' }), {
      status: 502,
      headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
    });
  }
}
