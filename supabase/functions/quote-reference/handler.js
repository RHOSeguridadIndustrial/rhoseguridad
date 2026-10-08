const origins = new Set(['https://rhosegind.com', 'https://www.rhosegind.com']);
const requestKeyPattern = /^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i;

export function createQuoteReferenceHandler({ publishableKeys, allocate }) {
  return async request => {
    const origin = request.headers.get('origin') || '';
    const headers = {
      'Content-Type': 'application/json', 'Cache-Control': 'no-store', Vary: 'Origin',
      'Access-Control-Allow-Methods': 'POST, OPTIONS',
      'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type'
    };
    if (origins.has(origin)) headers['Access-Control-Allow-Origin'] = origin;
    const reply = (body, status = 200) => new Response(JSON.stringify(body), { status, headers });
    if (!origins.has(origin)) return reply({ error: 'origin_not_allowed' }, 403);
    if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers });
    if (request.method !== 'POST') return reply({ error: 'method_not_allowed' }, 405);
    if (!publishableKeys.length) return reply({ error: 'service_unavailable' }, 503);
    if (!publishableKeys.includes(request.headers.get('apikey'))) return reply({ error: 'unauthorized' }, 401);
    if (!request.headers.get('content-type')?.startsWith('application/json')) return reply({ error: 'invalid_request' }, 400);
    let body;
    try {
      const text = await request.text();
      if (text.length > 1024) return reply({ error: 'request_too_large' }, 413);
      body = JSON.parse(text);
    } catch { return reply({ error: 'invalid_request' }, 400); }
    if (!body || typeof body.request_key !== 'string' || typeof body.fingerprint !== 'string' ||
        !requestKeyPattern.test(body.request_key) || !/^[a-f0-9]{64}$/.test(body.fingerprint)) {
      return reply({ error: 'invalid_request' }, 400);
    }
    try {
      const { data, error } = await allocate(body.request_key, body.fingerprint);
      if (error) {
        if (error.message === 'quote_reference_rate_limit') return reply({ error: 'try_again_later' }, 429);
        if (error.message === 'quote_request_conflict') return reply({ error: 'request_conflict' }, 409);
        return reply({ error: 'service_unavailable' }, 503);
      }
      if (!/^RHO-\d{8}$/.test(data) || data === 'RHO-00000000') return reply({ error: 'service_unavailable' }, 503);
      return reply({ reference: data });
    } catch { return reply({ error: 'service_unavailable' }, 503); }
  };
}
