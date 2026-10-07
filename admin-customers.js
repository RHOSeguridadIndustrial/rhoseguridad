const escapeHtml = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const fields = 'id,full_name,company_name,email,phone,role,created_at,updated_at,deactivated_at';
const pageSize = 25;

export function mountCustomerAdmin(supabase, refreshDashboard) {
  const byId = id => document.getElementById(id);
  const body = byId('clientsBody'), status = byId('customerStatus');
  let rows = [], page = 0, sequence = 0, pending = false, opener, timer;
  const dialog = document.createElement('dialog');
  dialog.className = 'customer-dialog';
  dialog.setAttribute('aria-labelledby', 'customerDialogTitle');
  document.body.append(dialog);
  dialog.addEventListener('cancel', e => { if (pending) e.preventDefault(); });
  dialog.addEventListener('close', () => { opener?.focus(); });
  const message = (text, error = false) => { status.textContent = text; status.className = `status ${error ? 'error' : 'ok'}`; };

  async function load() {
    const request = ++sequence;
    byId('customersPrev').disabled = byId('customersNext').disabled = true;
    body.setAttribute('aria-busy', 'true');
    try {
      let query = supabase.from('profiles').select(fields, { count: 'exact' })
        .order('created_at', { ascending: false }).order('id', { ascending: false });
      const filter = byId('customerFilter').value;
      if (filter === 'active') query = query.is('deactivated_at', null);
      if (filter === 'inactive') query = query.not('deactivated_at', 'is', null);
      // Strip PostgREST syntax/wildcards so a search cannot add query conditions.
      const term = byId('customerSearch').value.trim().replace(/[,%()_"\\]/g, ' ').replace(/\s+/g, ' ').trim();
      if (term) query = query.or(['full_name', 'company_name', 'email'].map(key => `${key}.ilike.%${term}%`).join(','));
      const result = await query.range(page * pageSize, (page + 1) * pageSize - 1);
      if (request !== sequence) return;
      if (result.error) throw result.error;
      rows = result.data || [];
      const total = result.count ?? rows.length;
      if (!rows.length && page > 0) { page--; return await load(); }
      body.innerHTML = rows.length ? rows.map(row => {
        const admin = row.role !== 'customer', inactive = !!row.deactivated_at;
        const state = admin ? 'Administrador' : inactive ? 'Inactiva' : 'Activa';
        const date = new Date(row.created_at).toLocaleDateString('es-MX');
        return `<tr><td data-label="Cliente"><span class="customer-name">${escapeHtml(row.full_name || 'Sin nombre')}</span><span class="customer-date">Registro · ${escapeHtml(date)}</span></td><td data-label="Empresa">${escapeHtml(row.company_name || 'Sin empresa')}</td><td data-label="Correo">${escapeHtml(row.email)}</td><td data-label="Estado"><span class="customer-state ${admin ? 'admin' : inactive ? 'inactive' : ''}">${state}</span></td><td data-label="Acciones">${admin ? '<span class="note">Cuenta protegida</span>' : `<div class="customer-actions"><button class="customer-button" data-action="edit" data-id="${escapeHtml(row.id)}" aria-label="Editar a ${escapeHtml(row.full_name)}">Editar</button><button class="customer-button ${inactive ? '' : 'danger'}" data-action="${inactive ? 'reactivate' : 'deactivate'}" data-id="${escapeHtml(row.id)}">${inactive ? 'Reactivar' : 'Dar de baja'}</button></div>`}</td></tr>`;
      }).join('') : '<tr><td colspan="5">No hay clientes con estos filtros.</td></tr>';
      byId('customersPageInfo').textContent = total ? `${page * pageSize + 1}–${page * pageSize + rows.length} de ${total} cuentas` : '0 cuentas';
      byId('customersPrev').disabled = page === 0;
      byId('customersNext').disabled = (page + 1) * pageSize >= total;
    } catch {
      if (request !== sequence) return;
      rows = [];
      body.innerHTML = '<tr><td colspan="5">No fue posible cargar las cuentas. Pulsa Actualizar para volver a intentar.</td></tr>';
      byId('customersPageInfo').textContent = '';
      message('No pudimos actualizar la lista de clientes.', true);
    } finally { if (request === sequence) body.removeAttribute('aria-busy'); }
  }
  byId('refreshCustomers').addEventListener('click', () => { message(''); load(); });
  byId('customerSearch').addEventListener('input', () => { clearTimeout(timer); timer = setTimeout(() => { page = 0; load(); }, 250); });
  byId('customerFilter').addEventListener('change', () => { page = 0; load(); });
  byId('customersPrev').addEventListener('click', () => { if (page > 0) { page--; load(); } });
  byId('customersNext').addEventListener('click', () => { page++; load(); });
  body.addEventListener('click', e => {
    const button = e.target.closest('button[data-action]');
    if (!button) return;
    const row = rows.find(r => r.id === button.dataset.id);
    if (!row || row.role !== 'customer') return;
    opener = button;
    openDialog(row, button.dataset.action);
  });

  function openDialog(row, action) {
    const edit = action === 'edit', deactivate = action === 'deactivate';
    const title = edit ? 'Editar cliente' : deactivate ? 'Dar de baja a cliente' : 'Reactivar cliente';
    const intro = edit ? 'Actualiza los datos de la cuenta. Los pedidos anteriores conservan sus datos originales.' : deactivate ? 'El cliente perderá el acceso a su cuenta. Sus datos e historial de pedidos se conservarán.' : 'El cliente podrá volver a iniciar sesión con sus credenciales.';
    dialog.innerHTML = `<h2 id="customerDialogTitle">${title}</h2><p class="dialog-description">${intro}</p><form class="customer-form">
      ${edit ? `<label>Nombre completo<input name="full_name" value="${escapeHtml(row.full_name)}" required minlength="3" maxlength="160" autocomplete="off"></label><label>Empresa<input name="company_name" value="${escapeHtml(row.company_name)}" maxlength="160" autocomplete="off"></label><label>Correo de acceso<input name="email" type="email" value="${escapeHtml(row.email)}" required maxlength="254" autocomplete="off"></label><div class="customer-email-warning" hidden><label class="customer-check"><input name="confirm_email_change" type="checkbox">Confirmo que el nuevo correo pertenece al cliente. Se utilizará para iniciar sesión y recuperar su contraseña.</label></div><label>Teléfono<input name="phone" type="tel" value="${escapeHtml(row.phone)}" maxlength="40" autocomplete="off"></label>` : `<div class="customer-summary"><strong>${escapeHtml(row.full_name || 'Sin nombre')}</strong>${escapeHtml(row.email)}</div>${deactivate ? '<label>Motivo de la baja<textarea name="reason" placeholder="Ej. Cuenta de prueba o registro duplicado" required minlength="3" maxlength="300"></textarea></label>' : ''}<label class="customer-check"><input name="confirm" type="checkbox" required>Confirmo que deseo ${deactivate ? 'dar de baja' : 'reactivar'} esta cuenta.</label>`}
      <p class="status" role="status" aria-live="polite"></p><div class="dialog-actions"><button type="button" class="customer-button" data-cancel>Cancelar</button><button type="submit" class="customer-button primary ${deactivate ? 'danger' : ''}">${edit ? 'Guardar cambios' : deactivate ? 'Confirmar baja' : 'Reactivar cuenta'}</button></div></form>`;
    const form = dialog.querySelector('form');
    form.querySelector('[data-cancel]').addEventListener('click', () => { if (!pending) dialog.close(); });
    if (edit) form.elements.email.addEventListener('input', () => {
      const changed = form.elements.email.value.trim().toLowerCase() !== row.email.toLowerCase();
      form.querySelector('.customer-email-warning').hidden = !changed;
      form.elements.confirm_email_change.required = changed;
      form.elements.confirm_email_change.checked = false;
    });
    form.addEventListener('submit', async e => {
      e.preventDefault();
      if (pending || !form.reportValidity()) return;
      const data = new FormData(form), resultStatus = form.querySelector('.status');
      const payload = { action, customer_id: row.id, expected_updated_at: row.updated_at };
      if (edit) for (const field of ['full_name', 'company_name', 'email', 'phone']) payload[field] = String(data.get(field) || '').trim();
      if (edit) payload.confirm_email_change = data.get('confirm_email_change') === 'on';
      else { payload.confirm = data.get('confirm') === 'on'; if (deactivate) payload.reason = String(data.get('reason') || '').trim(); }
      pending = true;
      form.querySelectorAll('input,textarea,button').forEach(el => el.disabled = true);
      resultStatus.className = 'status'; resultStatus.textContent = 'Guardando…';
      try {
        const { data: result, error } = await supabase.functions.invoke('admin-manage-customer', { body: payload });
        if (error) {
          let detail = 'No se pudo guardar. Actualiza la lista antes de reintentar.';
          try { const response = await error.context?.json(); if (response?.error) detail = response.error; } catch {}
          throw new Error(detail);
        }
        if (!result?.ok) throw new Error(result?.error || 'No fue posible confirmar el cambio.');
        dialog.close();
        await refreshDashboard();
        message(edit ? 'Datos del cliente actualizados.' : deactivate ? 'Cuenta dada de baja. Su historial se conserva.' : 'Cuenta reactivada.');
      } catch (error) {
        resultStatus.className = 'status error'; resultStatus.textContent = error.message;
      } finally {
        pending = false;
        form.querySelectorAll('input,textarea,button').forEach(el => el.disabled = false);
      }
    });
    dialog.showModal();
  }
  return { load };
}
