// Retired: a client-provided nonce cannot verify ownership of an email address.
// Existing clients receive an explicit error; no user/account data is modified.
const allowedOrigins = new Set(['https://rhosegind.com', 'https://www.rhosegind.com', 'https://rhoseguridadindustrial.github.io']);
Deno.serve((request: Request) => {
  const origin = request.headers.get('Origin') || '';
  const headers: Record<string, string> = {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
    'Vary': 'Origin',
    'Access-Control-Allow-Headers': 'apikey, content-type',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
  };
  if (allowedOrigins.has(origin)) headers['Access-Control-Allow-Origin'] = origin;
  if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers });
  return new Response(JSON.stringify({
    error: 'email_verification_required',
    message: 'Confirma tu correo con el enlace enviado a tu buzón. Después inicia sesión en RHO.',
  }), { status: 410, headers });
});
