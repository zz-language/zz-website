// POST /api/pkg/:name/owners + DELETE /api/pkg/:name/owners/:login (proxy).
//
// Owner management, forwarded with the caller's Bearer credential to the
// authoritative registry (which owns the last-owner guard and the
// must-have-signed-in-once rule). Upstream status/body pass through.
function upstreamBase(env: any): string {
  const raw = typeof env?.REGISTRY_UPSTREAM === 'string' ? env.REGISTRY_UPSTREAM : '';
  return raw.replace(/\/+$/, '') || 'https://zz-registry.onrender.com';
}

function authed(request: Request): string | null {
  const auth = request.headers.get('Authorization');
  return auth?.startsWith('Bearer zz_') ? auth : null;
}

async function relay(url: string, request: Request, method: string, body?: string): Promise<Response> {
  const auth = authed(request);
  if (!auth) {
    return new Response(JSON.stringify({ error: 'Invalid token format' }), {
      status: 401,
      headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
    });
  }
  try {
    const upstream = await fetch(url, {
      method,
      headers: { 'Content-Type': 'application/json', Accept: 'application/json', Authorization: auth },
      body,
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

export async function onRequestPost(context: any) {
  const { env, params, request } = context;
  const name = params.name as string;
  if (!name || !/^[a-z0-9_-]+$/.test(name)) {
    return new Response(JSON.stringify({ error: 'Invalid package name' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
    });
  }
  let raw: string;
  try {
    raw = await request.text();
    JSON.parse(raw || '{}');
  } catch {
    return new Response(JSON.stringify({ error: 'Invalid JSON body' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
    });
  }
  return relay(`${upstreamBase(env)}/api/pkg/${encodeURIComponent(name)}/owners`, request, 'POST', raw);
}
