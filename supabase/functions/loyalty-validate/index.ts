import { createClient } from "npm:@supabase/supabase-js@2.112.4";

const cors = {
  "Access-Control-Allow-Origin": "https://rhosegind.com",
  "Access-Control-Allow-Headers": "content-type",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
};

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), {
  status,
  headers: { ...cors, "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" },
});

const bytesToHex = (bytes: Uint8Array) => [...bytes].map((b) => b.toString(16).padStart(2, "0")).join("");
async function sha256(value: string) {
  return bytesToHex(new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value))));
}

Deno.serve(async (request) => {
  if (request.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (request.method !== "GET") return json({ error: "Método no permitido" }, 405);

  const token = new URL(request.url).searchParams.get("t") || "";
  if (!/^[0-9a-f]{64}$/.test(token)) return json({ valid: false, reason: "invalid" }, 400);

  const service = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    { auth: { persistSession: false, autoRefreshToken: false } },
  );

  const { data: qr } = await service.from("loyalty_qr_tokens")
    .select("id,card_id,is_active,expires_at,revoked_at")
    .eq("token_hash", await sha256(token)).maybeSingle();

  if (!qr) {
    await service.from("loyalty_qr_scans").insert({ scan_result: "invalid" });
    return json({ valid: false, reason: "invalid" }, 404);
  }

  const now = Date.now();
  let result = !qr.is_active || qr.revoked_at ? "revoked" : qr.expires_at && Date.parse(qr.expires_at) <= now ? "expired" : "valid";
  const { data: card } = await service.from("loyalty_cards")
    .select("id,card_number,tier_code,status,expires_at")
    .eq("id", qr.card_id).maybeSingle();

  if (!card || card.status !== "active") result = card?.status === "expired" ? "expired" : "revoked";
  if (card?.expires_at && Date.parse(card.expires_at) <= now) result = "expired";

  const { data: tier } = card ? await service.from("loyalty_tiers")
    .select("display_name,color_hex,benefits").eq("code", card.tier_code).maybeSingle() : { data: null };

  await service.from("loyalty_qr_scans").insert({ card_id: card?.id || null, token_id: qr.id, scan_result: result });

  if (result !== "valid" || !card) return json({ valid: false, reason: result });
  const masked = `${card.card_number.slice(0, 4)} •••• •••• ${card.card_number.slice(-4)}`;
  return json({
    valid: true,
    card_number: masked,
    tier: card.tier_code,
    tier_name: tier?.display_name || card.tier_code,
    color_hex: tier?.color_hex || "#01283B",
    benefits: tier?.benefits || [],
    expires_at: card.expires_at,
  });
});
