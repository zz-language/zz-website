// DELETE /api/pkg/:name/owners/:login (proxy). See owners.ts.
function upstreamBase(env: any): string {
  const raw = typeof env?.REGISTRY_UPSTREAM === 'string' ? env.REGISTRY_UPSTREAM : '';
  return raw.replace(/\/+$/, '') || 'https://zz-registry.onrender.com';
}

export async function onRequestDelete(context: any) {
  const { env, params, request } = context;
  const name = params.name as string;
  const login = params.login as string;
  if (!name || !/^[a-z0-9_-]+$/.test(name) || !login) {
    return new Response(JSON.stringify({ error: 'Invalid package or login' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
    });
  }
  const auth = request.headers.get('Authorization');
  if (!auth?.startsWith('Bearer zz_')) {
    return new Response(JSON.stringify({ error: 'Invalid token format' }), {
      status: 401,
      headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
    });
  }
  try {
    const upstream = await fetch(
      `${upstreamBase(env)}/api/pkg/${encodeURIComponent(name)}/owners/${encodeURIComponent(login)}`,
      { method: 'DELETE', headers: { Accept: 'application/json', Authorization: auth } },
    );
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
