const allowedOrigins = new Set([
  'https://rhosegind.com', 'https://www.rhosegind.com',
  'https://rhoseguridadindustrial.github.io',
]);
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const actions = new Set(['edit', 'deactivate', 'reactivate']);
const profileFields = 'id,role,email,full_name,company_name,phone,updated_at,deactivated_at';

export function createHandler(service) {
  return async function handle(request) {
    const origin = request.headers.get('Origin') || '';
    const headers = {
      'Access-Control-Allow-Origin': allowedOrigins.has(origin) ? origin : 'https://rhosegind.com',
      'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
      'Access-Control-Allow-Methods': 'POST, OPTIONS',
      'Vary': 'Origin', 'Cache-Control': 'no-store', 'Content-Type': 'application/json; charset=utf-8',
    };
    const json = (body, status = 200) => new Response(JSON.stringify(body), { status, headers });
    if (origin && !allowedOrigins.has(origin)) return json({ error: 'Origen no permitido.' }, 403);
    if (request.method === 'OPTIONS') return new Response('ok', { headers });
    if (request.method !== 'POST') return json({ error: 'Método no permitido.' }, 405);
    const authorization = request.headers.get('Authorization') || '';
    if (!/^Bearer\s+\S+$/i.test(authorization)) return json({ error: 'Inicia sesión como administrador.' }, 401);
    try {
      const { data: auth, error: authError } = await service.auth.getUser(authorization.replace(/^Bearer\s+/i, ''));
      if (authError || !auth?.user) return json({ error: 'Tu sesión expiró. Inicia sesión de nuevo.' }, 401);
      const { data: actor, error: actorError } = await service.from('profiles')
        .select('id,role,deactivated_at').eq('id', auth.user.id).maybeSingle();
      if (actorError || actor?.role !== 'admin' || actor.deactivated_at) {
        return json({ error: 'Esta acción solo está disponible para administradores.' }, 403);
      }
      const text = await request.text();
      if (new TextEncoder().encode(text).length > 16384) return json({ error: 'Solicitud demasiado grande.' }, 413);
      let input;
      try { input = JSON.parse(text); } catch { return json({ error: 'Solicitud inválida.' }, 400); }
      if (!input || Array.isArray(input) || typeof input !== 'object' || !actions.has(input.action)
          || typeof input.customer_id !== 'string' || !uuid.test(input.customer_id)
          || typeof input.expected_updated_at !== 'string' || !Number.isFinite(Date.parse(input.expected_updated_at))) {
        return json({ error: 'Selecciona un cliente y vuelve a intentar.' }, 400);
      }
      if (input.customer_id === actor.id) return json({ error: 'Tu cuenta de administrador está protegida.' }, 403);
      const { data: target, error: targetError } = await service.from('profiles')
        .select(profileFields).eq('id', input.customer_id).maybeSingle();
      if (targetError) return json({ error: 'No fue posible consultar la cuenta.' }, 503);
      if (!target) return json({ error: 'La cuenta ya no está disponible.' }, 404);
      if (target.role !== 'customer') return json({ error: 'Las cuentas administrativas están protegidas.' }, 403);
      if (target.updated_at !== input.expected_updated_at) {
        return json({ error: 'La cuenta cambió. Actualiza la lista antes de continuar.', code: 'conflict' }, 409);
      }
      const operation = {
        id: crypto.randomUUID(), actor_id: actor.id, action: input.action,
        expected_updated_at: input.expected_updated_at,
      };
      const changes = {};
      if (input.action === 'edit') {
        const fields = {};
        for (const [key, max] of Object.entries({ full_name: 160, company_name: 160, phone: 40, email: 254 })) {
          if (typeof input[key] !== 'string' || input[key].trim().length > max) {
            return json({ error: 'Revisa la longitud y el formato de los datos.' }, 400);
          }
          fields[key] = input[key].trim();
        }
        fields.full_name = fields.full_name.replace(/\s+/g, ' ');
        fields.company_name = fields.company_name.replace(/\s+/g, ' ');
        fields.email = fields.email.toLowerCase();
        if (fields.full_name.length < 3) return json({ error: 'Captura el nombre completo.' }, 400);
        if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(fields.email)) return json({ error: 'Captura un correo válido.' }, 400);
        if (fields.phone && !/^[0-9+()\-\s.]{7,40}$/.test(fields.phone)) return json({ error: 'Captura un teléfono válido.' }, 400);
        if (fields.email !== target.email.toLowerCase() && input.confirm_email_change !== true) {
          return json({ error: 'Confirma el cambio de correo de acceso.' }, 400);
        }
        operation.fields = fields;
        // Auth enforces unique login emails. Profile + audit are synchronized by a DB trigger
        // in the same transaction; failures roll back the Auth update too.
        if (fields.email !== target.email.toLowerCase()) changes.email = fields.email;
        changes.user_metadata = { full_name: fields.full_name, company_name: fields.company_name, phone: fields.phone };
      } else {
        if (input.confirm !== true) return json({ error: 'Confirma la acción sobre esta cuenta.' }, 400);
        if (input.action === 'deactivate') {
          if (target.deactivated_at) return json({ error: 'La cuenta ya está inactiva. Actualiza la lista.' }, 409);
          if (typeof input.reason !== 'string' || input.reason.trim().length < 3 || input.reason.trim().length > 300) {
            return json({ error: 'Escribe un motivo de baja de 3 a 300 caracteres.' }, 400);
          }
          operation.reason = input.reason.trim();
          changes.ban_duration = '876000h';
        } else {
          if (!target.deactivated_at) return json({ error: 'La cuenta ya está activa. Actualiza la lista.' }, 409);
          changes.ban_duration = 'none';
        }
      }
      const { data: authTarget, error: userError } = await service.auth.admin.getUserById(target.id);
      if (userError || !authTarget?.user) return json({ error: 'No fue posible verificar el acceso del cliente.' }, 503);
      changes.app_metadata = { ...authTarget.user.app_metadata, rho_customer_admin_operation: operation };
      if (changes.user_metadata) changes.user_metadata = { ...authTarget.user.user_metadata, ...changes.user_metadata };
      const { error: updateError } = await service.auth.admin.updateUserById(target.id, changes);
      if (updateError) {
        if (['email_exists', 'user_already_exists'].includes(updateError.code)
            || /already.*(registered|exists)|duplicate.*email/i.test(updateError.message || '')) {
          return json({ error: 'Ese correo ya pertenece a otra cuenta de RHO.' }, 409);
        }
        return json({ error: 'No se guardaron los cambios. Actualiza la lista y vuelve a intentar.' }, 409);
      }
      return json({ ok: true, action: input.action, customer_id: target.id });
    } catch {
      return json({ error: 'No pudimos completar la operación. Actualiza la lista para verificar su estado antes de reintentar.' }, 503);
    }
  };
}
