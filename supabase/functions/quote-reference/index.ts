import { createQuoteReferenceHandler } from './handler.js';

function keysFromEnvironment(name: string): Record<string, string> {
  try {
    const parsed = JSON.parse(Deno.env.get(name) || '{}');
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
  } catch { return {}; }
}

const publishableKeys = Object.values(keysFromEnvironment('SUPABASE_PUBLISHABLE_KEYS'))
  .filter(key => typeof key === 'string' && key.startsWith('sb_publishable_'));
const secret = keysFromEnvironment('SUPABASE_SECRET_KEYS').default || Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
const projectUrl = Deno.env.get('SUPABASE_URL');

// Deploy with verify_jwt=false: this guest endpoint validates the publishable
// apikey itself. Publishable keys are not JWTs. Only the reference is exposed.
Deno.serve(createQuoteReferenceHandler({
  publishableKeys,
  allocate: async (requestKey: string, fingerprint: string) => {
    if (!secret || !projectUrl) throw new Error('Missing server configuration');
    const headers: Record<string, string> = { apikey: secret, 'Content-Type': 'application/json' };
    if (!secret.startsWith('sb_secret_')) headers.Authorization = `Bearer ${secret}`;
    const response = await fetch(`${projectUrl}/rest/v1/rpc/allocate_quote_reference`, {
      method: 'POST', headers, signal: AbortSignal.timeout(8000),
      body: JSON.stringify({ p_request_key: requestKey, p_fingerprint: fingerprint })
    });
    const result = await response.json();
    return response.ok ? { data: result, error: null } : { data: null, error: result };
  }
}));
