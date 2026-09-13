// GET /api/auth/github — Initiate GitHub OAuth flow
export async function onRequestGet(context: any) {
  const { env } = context;
  const clientId = env.GITHUB_CLIENT_ID;

  if (!clientId) {
    return new Response(JSON.stringify({ error: 'OAuth not configured' }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  const redirectUri = `${env.SITE_DOMAIN}/api/auth/callback`;
  const scope = 'read:user';
  const state = crypto.randomUUID();

  // Store state in cookie for CSRF protection
  const response = Response.redirect(
    `https://github.com/login/oauth/authorize?client_id=${clientId}&redirect_uri=${encodeURIComponent(redirectUri)}&scope=${scope}&state=${state}`,
    302
  );

  response.headers.set(
    'Set-Cookie',
    `oauth_state=${state}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=600`
  );

  return response;
}
