import { createClient } from "npm:@supabase/supabase-js@2.112.4";

const allowedOrigins = new Set(["https://rhosegind.com", "https://rhoseguridadindustrial.github.io"]);
const corsFor = (request: Request) => {
  const origin = request.headers.get("Origin") || "";
  return {
    "Access-Control-Allow-Origin": allowedOrigins.has(origin) ? origin : "https://rhosegind.com",
    "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
    "Access-Control-Allow-Methods": "GET, OPTIONS",
    "Vary": "Origin",
  };
};

const bytesFromHex = (hex: string) => new Uint8Array(hex.match(/.{1,2}/g)?.map((byte) => parseInt(byte, 16)) || []);

async function encryptionKey() {
  const secret = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(`rho-loyalty:${secret}`));
  return crypto.subtle.importKey("raw", digest, { name: "AES-GCM" }, false, ["decrypt"]);
}

async function decryptToken(ciphertext: string, iv: string) {
  const plain = await crypto.subtle.decrypt(
    { name: "AES-GCM", iv: bytesFromHex(iv) },
    await encryptionKey(),
    bytesFromHex(ciphertext),
  );
  return new TextDecoder().decode(plain);
}

Deno.serve(async (request) => {
  const cors = corsFor(request);
  const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), {
    status,
    headers: { ...cors, "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" },
  });
  if (request.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (request.method !== "GET") return json({ error: "Método no permitido" }, 405);

  const jwt = (request.headers.get("Authorization") || "").replace(/^Bearer\s+/i, "");
  if (!jwt) return json({ error: "Sesión requerida" }, 401);

  const service = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    { auth: { persistSession: false, autoRefreshToken: false } },
  );
  const { data: authData, error: authError } = await service.auth.getUser(jwt);
  if (authError || !authData.user) return json({ error: "Sesión inválida" }, 401);

  const { data: card } = await service.from("loyalty_cards")
    .select("id,card_number,tier_code,status,points_balance,lifetime_points,issued_at,expires_at,last_activity_at")
    .eq("user_id", authData.user.id).maybeSingle();
  if (!card) return json({ card: null });

  const [{ data: tier }, { data: tokenRow }] = await Promise.all([
    service.from("loyalty_tiers").select("display_name,color_hex,benefits").eq("code", card.tier_code).single(),
    service.from("loyalty_qr_tokens").select("token_ciphertext,token_iv,expires_at")
      .eq("card_id", card.id).eq("is_active", true).is("revoked_at", null).maybeSingle(),
  ]);

  let validationUrl: string | null = null;
  if (tokenRow?.token_ciphertext && tokenRow?.token_iv) {
    try {
      const token = await decryptToken(tokenRow.token_ciphertext, tokenRow.token_iv);
      validationUrl = `https://rhosegind.com/validar.html?t=${token}`;
    } catch {
      return json({ error: "El QR requiere ser regenerado por un administrador" }, 409);
    }
  }

  return json({ card: { ...card, tier, validation_url: validationUrl } });
});
