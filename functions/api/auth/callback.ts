// GET /api/auth/callback — GitHub OAuth callback
export async function onRequestGet(context: any) {
  const { env, request } = context;
  const url = new URL(request.url);
  const code = url.searchParams.get('code');
  const state = url.searchParams.get('state');

  // Verify state from cookie
  const cookies = Object.fromEntries(
    request.headers.get('Cookie')?.split(';').map((c: string) => c.trim().split('=')) || []
  );

  if (state !== cookies.oauth_state) {
    return new Response('Invalid state', { status: 403 });
  }

  if (!code) {
    return new Response('Missing code', { status: 400 });
  }

  try {
    // Exchange code for access token
    const tokenRes = await fetch('https://github.com/login/oauth/access_token', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Accept': 'application/json',
      },
      body: JSON.stringify({
        client_id: env.GITHUB_CLIENT_ID,
        client_secret: env.GITHUB_CLIENT_SECRET,
        code,
      }),
    });

    const { access_token } = await tokenRes.json();

    // Fetch user info
    const userRes = await fetch('https://api.github.com/user', {
      headers: { Authorization: `Bearer ${access_token}` },
    });
    const githubUser = await userRes.json();

    // Generate ZZ API token
    const tokenId = crypto.randomUUID().replace(/-/g, '');
    const token = `zz_pat_${tokenId}`;
    const tokenHash = await hashToken(token);

    // Save to D1
    const userId = `gh_${githubUser.id}`;
    await env.DB.prepare(
      'INSERT OR REPLACE INTO users (id, github_login, avatar_url, created_at) VALUES (?, ?, ?, ?)'
    ).bind(userId, githubUser.login, githubUser.avatar_url, Date.now()).run();

    await env.DB.prepare(
      'INSERT INTO tokens (hash, user_id, prefix, created_at) VALUES (?, ?, ?, ?)'
    ).bind(tokenHash, userId, token.slice(0, 12), Date.now()).run();

    // Return token to user
    const response = new Response(JSON.stringify({ token, login: githubUser.login }), {
      headers: { 'Content-Type': 'application/json' },
    });

    response.headers.set(
      'Set-Cookie',
      `oauth_state=; Path=/; HttpOnly; Secure; Max-Age=0`
    );

    return response;
  } catch (err) {
    return new Response(JSON.stringify({ error: 'OAuth failed' }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }
}

async function hashToken(token: string): Promise<string> {
  const encoder = new TextEncoder();
  const data = encoder.encode(token);
  const hashBuffer = await crypto.subtle.digest('SHA-256', data);
  return Array.from(new Uint8Array(hashBuffer)).map(b => b.toString(16).padStart(2, '0')).join('');
}
