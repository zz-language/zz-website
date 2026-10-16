// GET /api/auth/me — session check (proxy).
//
// Forwards the user's Bearer credential (unlike public GETs: identity
// verification is authenticated by definition). Used by the header and
// pages to prove a stored token is still valid and which login it owns.
export async function onRequestGet(context: any) {
  const { env, request } = context;
  const raw = typeof env?.REGISTRY_UPSTREAM === 'string' ? env.REGISTRY_UPSTREAM : '';
  const base = raw.replace(/\/+$/, '') || 'https://zz-registry.onrender.com';

  const auth = request.headers.get('Authorization');
  if (!auth?.startsWith('Bearer zz_')) {
    return new Response(JSON.stringify({ error: 'Invalid token format' }), {
      status: 401,
      headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
    });
  }

  try {
    const upstream = await fetch(`${base}/api/auth/me`, {
      headers: { Accept: 'application/json', Authorization: auth },
    });
    const text = await upstream.text();
    return new Response(text, {
      status: upstream.status,
      headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
    });
  } catch {
    return new Response(JSON.stringify({ error: 'registry unreachable' }), {
      status: 502,
      headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
    });
  }
}
