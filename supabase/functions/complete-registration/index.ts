import { createClient } from "npm:@supabase/supabase-js@2.112.4";

const allowedOrigins = new Set([
  "https://rhosegind.com",
  "https://rhoseguridadindustrial.github.io",
]);

const corsFor = (request: Request) => {
  const origin = request.headers.get("Origin") || "";
  return {
    "Access-Control-Allow-Origin": allowedOrigins.has(origin) ? origin : "https://rhosegind.com",
    "Access-Control-Allow-Headers": "apikey, content-type",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Vary": "Origin",
  };
};

const validUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const validNonce = /^[0-9a-f]{64}$/;

Deno.serve(async (request) => {
  const cors = corsFor(request);
  const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), {
    status,
    headers: { ...cors, "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" },
  });

  if (request.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (request.method !== "POST") return json({ error: "Método no permitido" }, 405);
  if (Number(request.headers.get("content-length") || 0) > 8192) {
    return json({ error: "Solicitud demasiado grande" }, 413);
  }

  let payload: Record<string, unknown>;
  try {
    payload = await request.json();
  } catch {
    return json({ error: "Solicitud inválida" }, 400);
  }

  const userId = String(payload.user_id || "");
  const email = String(payload.email || "").trim().toLowerCase();
  const nonce = String(payload.nonce || "").toLowerCase();
  if (!validUuid.test(userId) || !validNonce.test(nonce) || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return json({ error: "Registro inválido" }, 400);
  }

  const service = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    { auth: { persistSession: false, autoRefreshToken: false } },
  );
  const { data, error } = await service.auth.admin.getUserById(userId);
  const user = data?.user;
  if (error || !user) return json({ error: "Registro no encontrado" }, 404);

  const ageMs = Date.now() - Date.parse(user.created_at);
  const metadata = (user.user_metadata || {}) as Record<string, unknown>;
  const storedNonce = String(metadata.registration_nonce || "").toLowerCase();
  if (ageMs < 0 || ageMs > 10 * 60 * 1000 || user.email?.toLowerCase() !== email || storedNonce !== nonce) {
    return json({ error: "La validación del registro venció o no coincide" }, 403);
  }

  const { registration_nonce: _discardedNonce, ...cleanMetadata } = metadata;
  const { error: confirmError } = await service.auth.admin.updateUserById(userId, {
    email_confirm: true,
    user_metadata: cleanMetadata,
  });
  if (confirmError) return json({ error: "No fue posible activar la cuenta" }, 500);

  return json({ confirmed: true });
});
