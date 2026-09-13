import { createClient } from "npm:@supabase/supabase-js@2.112.4";

const allowedOrigins = new Set([
  "https://rhosegind.com",
  "https://rhoseguridadindustrial.github.io",
]);

const corsFor = (request: Request) => {
  const origin = request.headers.get("Origin") || "";
  return {
    "Access-Control-Allow-Origin": allowedOrigins.has(origin) ? origin : "https://rhosegind.com",
    "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Vary": "Origin",
  };
};

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
  const cors = corsFor(request);
  const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), {
    status,
    headers: { ...cors, "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" },
  });

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
  const audit = async (
    auditAction: "create_customer" | "issue_card" | "rotate_qr" | "add_points",
    cardId: string | null,
    targetUserId: string | null,
    metadata: Record<string, unknown> = {},
  ) => {
    const { error } = await service.from("loyalty_admin_audit").insert({
      admin_user_id: authData.user.id,
      action: auditAction,
      card_id: cardId,
      target_user_id: targetUserId,
      metadata,
    });
    if (error) console.error("loyalty_admin_audit", error.message);
  };

  if (action === "get_report") {
    const since = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();
    const [cardsResult, scansResult, auditResult] = await Promise.all([
      service.from("loyalty_cards").select("tier_code,status,points_balance"),
      service.from("loyalty_qr_scans").select("id", { count: "exact", head: true }).gte("scanned_at", since),
      service.from("loyalty_admin_audit").select("action,created_at").order("created_at", { ascending: false }).limit(8),
    ]);
    if (cardsResult.error || scansResult.error || auditResult.error) {
      return json({ error: "No fue posible generar el reporte" }, 500);
    }
    const cards = cardsResult.data || [];
    const byTier = cards.reduce<Record<string, number>>((summary, card) => {
      summary[card.tier_code] = (summary[card.tier_code] || 0) + 1;
      return summary;
    }, {});
    return json({
      report: {
        issued: cards.length,
        active: cards.filter((card) => card.status === "active").length,
        points: cards.reduce((total, card) => total + Number(card.points_balance || 0), 0),
        scans_30d: scansResult.count || 0,
        by_tier: byTier,
        recent_actions: auditResult.data || [],
        generated_at: new Date().toISOString(),
      },
    });
  }

  if (action === "create_customer") {
    const fullName = String(payload.full_name || "").trim().slice(0, 160);
    const email = String(payload.email || "").trim().toLowerCase().slice(0, 254);
    const companyName = String(payload.company_name || "").trim().slice(0, 160);
    const phone = String(payload.phone || "").trim().slice(0, 40);
    if (fullName.length < 3 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      return json({ error: "Nombre o correo inválido" }, 400);
    }

    const { data, error } = await service.auth.admin.inviteUserByEmail(email, {
      data: {
        full_name: fullName,
        company_name: companyName || null,
        phone: phone || null,
        customer_type: "Cliente RHO",
      },
    });
    if (error || !data.user) {
      const duplicate = /registered|already|exists/i.test(error?.message || "");
      return json({ error: duplicate ? "Ese correo ya está registrado." : "No fue posible registrar e invitar al cliente." }, 400);
    }

    await audit("create_customer", null, data.user.id, { email, company_name: companyName || null });
    return json({ user: { id: data.user.id, full_name: fullName, email }, invited: true }, 201);
  }

  if (action === "issue_card") {
    const userId = String(payload.user_id || "");
    const tierCode = String(payload.tier_code || "");
    const expiresAt = payload.expires_at ? String(payload.expires_at) : null;
    if (!userId || !["azul", "black", "oro", "platino"].includes(tierCode)) {
      return json({ error: "Cliente o nivel inválido" }, 400);
    }

    const { data: customer } = await service.from("profiles").select("id,role").eq("id", userId).maybeSingle();
    if (!customer || customer.role !== "customer") return json({ error: "Cliente no válido" }, 400);

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

    await audit("issue_card", card.id, userId, { tier_code: tierCode, expires_at: expiresAt });
    return json({
      card,
      validation_url: `https://rhosegind.com/validar.html?t=${token}`,
      notice: "Guarda esta URL ahora: el token no se almacena en texto plano.",
    }, 201);
  }

  if (action === "rotate_qr") {
    const cardId = String(payload.card_id || "");
    if (!cardId) return json({ error: "Tarjeta requerida" }, 400);

    const { data: card } = await service.from("loyalty_cards").select("id,user_id,expires_at").eq("id", cardId).maybeSingle();
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

    await audit("rotate_qr", cardId, card.user_id, {});
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
    const { data: card } = await service.from("loyalty_cards").select("id,user_id").eq("id", cardId).maybeSingle();
    if (!card) return json({ error: "Tarjeta no encontrada" }, 404);
    const description = payload.description ? String(payload.description).slice(0, 300) : null;
    const { data, error } = await service.from("loyalty_points_ledger").insert({
      card_id: cardId,
      points_delta: points,
      event_type: eventType,
      description,
      expires_at: payload.expires_at ? String(payload.expires_at) : null,
      created_by: authData.user.id,
    }).select("id,points_delta,created_at").single();
    if (error) return json({ error: error.message.includes("Insufficient") ? "Puntos insuficientes" : "No fue posible registrar los puntos" }, 400);
    const { data: balance } = await service.from("loyalty_cards").select("points_balance,lifetime_points").eq("id", cardId).single();
    await audit("add_points", cardId, card.user_id, { points_delta: points, event_type: eventType });
    return json({ movement: data, balance });
  }

  return json({ error: "Acción no reconocida" }, 400);
});
