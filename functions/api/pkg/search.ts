// GET /api/pkg/search?q=... — Search packages
export async function onRequestGet(context: any) {
  const { env, request } = context;
  const url = new URL(request.url);
  const query = url.searchParams.get('q') || '';
  const limit = parseInt(url.searchParams.get('limit') || '20');

  try {
    let results;
    if (query) {
      results = await env.DB.prepare(
        'SELECT name, latest, description, author FROM packages WHERE name LIKE ? OR description LIKE ? LIMIT ?'
      ).bind(`%${query}%`, `%${query}%`, limit).all();
    } else {
      results = await env.DB.prepare(
        'SELECT name, latest, description, author FROM packages ORDER BY updated_at DESC LIMIT ?'
      ).bind(limit).all();
    }

    return new Response(JSON.stringify(results.results || []), {
      headers: {
        'Content-Type': 'application/json',
        'Cache-Control': 'public, max-age=60',
      },
    });
  } catch {
    return new Response(JSON.stringify([]), {
      headers: { 'Content-Type': 'application/json' },
    });
  }
}
