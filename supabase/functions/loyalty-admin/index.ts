import { createClient } from "npm:@supabase/supabase-js@2.112.4";

const cors = {
  "Access-Control-Allow-Origin": "https://rhosegind.com",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), {
  status,
  headers: { ...cors, "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" },
});

const bytesToHex = (bytes: Uint8Array) => [...bytes].map((b) => b.toString(16).padStart(2, "0")).join("");

async function sha256(value: string) {
  return bytesToHex(new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value))));
}

function randomDigits(length: number) {
  const bytes = new Uint8Array(length);
  crypto.getRandomValues(bytes);
  return [...bytes].map((value) => String(value % 10)).join("");
}

function randomToken() {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return bytesToHex(bytes);
}

async function encryptionKey() {
  const secret = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(`rho-loyalty:${secret}`));
  return crypto.subtle.importKey("raw", digest, { name: "AES-GCM" }, false, ["encrypt"]);
}

async function encryptToken(token: string) {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ciphertext = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv },
    await encryptionKey(),
    new TextEncoder().encode(token),
  );
  return { token_ciphertext: bytesToHex(new Uint8Array(ciphertext)), token_iv: bytesToHex(iv) };
}

Deno.serve(async (request) => {
  if (request.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (request.method !== "POST") return json({ error: "Método no permitido" }, 405);

  const authHeader = request.headers.get("Authorization") || "";
  const jwt = authHeader.replace(/^Bearer\s+/i, "");
  if (!jwt) return json({ error: "Sesión requerida" }, 401);

  const service = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    { auth: { persistSession: false, autoRefreshToken: false } },
  );

  const { data: authData, error: authError } = await service.auth.getUser(jwt);
  if (authError || !authData.user) return json({ error: "Sesión inválida" }, 401);

  const { data: profile } = await service.from("profiles").select("role").eq("id", authData.user.id).single();
  if (profile?.role !== "admin") return json({ error: "Acceso de administrador requerido" }, 403);

  let payload: Record<string, unknown>;
  try {
    payload = await request.json();
  } catch {
    return json({ error: "Solicitud inválida" }, 400);
  }

  const action = String(payload.action || "");

  if (action === "issue_card") {
    const userId = String(payload.user_id || "");
    const tierCode = String(payload.tier_code || "");
    const expiresAt = payload.expires_at ? String(payload.expires_at) : null;
    if (!userId || !["azul", "black", "oro", "platino"].includes(tierCode)) {
      return json({ error: "Cliente o nivel inválido" }, 400);
    }

    const { data: existing } = await service.from("loyalty_cards").select("id").eq("user_id", userId).maybeSingle();
    if (existing) return json({ error: "El cliente ya tiene una tarjeta de lealtad" }, 409);

    let card: { id: string; card_number: string; tier_code: string } | null = null;
    for (let attempt = 0; attempt < 5 && !card; attempt += 1) {
      const cardNumber = `9263${randomDigits(12)}`;
      const { data, error } = await service.from("loyalty_cards").insert({
        user_id: userId,
        card_number: cardNumber,
        tier_code: tierCode,
        expires_at: expiresAt,
      }).select("id,card_number,tier_code").single();
      if (!error) card = data;
      else if (error.code !== "23505") return json({ error: "No fue posible emitir la tarjeta" }, 500);
    }
    if (!card) return json({ error: "No fue posible generar un número único" }, 500);

    const token = randomToken();
    const tokenHash = await sha256(token);
    const encrypted = await encryptToken(token);
    const { error: tokenError } = await service.from("loyalty_qr_tokens").insert({
      card_id: card.id,
      token_hash: tokenHash,
      ...encrypted,
      expires_at: expiresAt,
    });
    if (tokenError) {
      await service.from("loyalty_cards").delete().eq("id", card.id);
      return json({ error: "No fue posible asociar el QR" }, 500);
    }

    return json({
      card,
      validation_url: `https://rhosegind.com/validar.html?t=${token}`,
      notice: "Guarda esta URL ahora: el token no se almacena en texto plano.",
    }, 201);
  }

  if (action === "rotate_qr") {
    const cardId = String(payload.card_id || "");
    if (!cardId) return json({ error: "Tarjeta requerida" }, 400);

    const { data: card } = await service.from("loyalty_cards").select("id,expires_at").eq("id", cardId).maybeSingle();
    if (!card) return json({ error: "Tarjeta no encontrada" }, 404);

    await service.from("loyalty_qr_tokens").update({ is_active: false, revoked_at: new Date().toISOString() })
      .eq("card_id", cardId).eq("is_active", true);

    const token = randomToken();
    const encrypted = await encryptToken(token);
    const { error } = await service.from("loyalty_qr_tokens").insert({
      card_id: cardId,
      token_hash: await sha256(token),
      ...encrypted,
      expires_at: card.expires_at,
    });
    if (error) return json({ error: "No fue posible rotar el QR" }, 500);

    return json({
      validation_url: `https://rhosegind.com/validar.html?t=${token}`,
      notice: "El QR anterior quedó revocado.",
    });
  }

  if (action === "add_points") {
    const cardId = String(payload.card_id || "");
    const points = Number(payload.points);
    const eventType = String(payload.event_type || (points >= 0 ? "earn" : "adjust"));
    const allowed = ["earn", "redeem", "adjust", "expire", "bonus"];
    if (!cardId || !Number.isInteger(points) || points === 0 || !allowed.includes(eventType)) {
      return json({ error: "Movimiento de puntos inválido" }, 400);
    }
    const { data, error } = await service.from("loyalty_points_ledger").insert({
      card_id: cardId,
      points_delta: points,
      event_type: eventType,
      description: payload.description ? String(payload.description) : null,
      expires_at: payload.expires_at ? String(payload.expires_at) : null,
      created_by: authData.user.id,
    }).select("id,points_delta,created_at").single();
    if (error) return json({ error: error.message.includes("Insufficient") ? "Puntos insuficientes" : "No fue posible registrar los puntos" }, 400);
    const { data: balance } = await service.from("loyalty_cards").select("points_balance,lifetime_points").eq("id", cardId).single();
    return json({ movement: data, balance });
  }

  return json({ error: "Acción no reconocida" }, 400);
});
