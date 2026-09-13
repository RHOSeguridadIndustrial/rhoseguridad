import { supabase } from './supabase-client.js?v=20260913-loyalty';
import QRCode from 'https://cdn.jsdelivr.net/npm/qrcode@1.5.4/+esm';

const { data: { session } } = await supabase.auth.getSession();
if (!session) {
  location.replace('login.html');
  throw new Error('Sesión requerida');
}

const { data: me } = await supabase.from('profiles').select('role').eq('id', session.user.id).single();
if (me?.role !== 'admin') {
  location.replace('membresia.html');
  throw new Error('Acceso de administrador requerido');
}

let profiles = [];
let cards = [];
await loadData();

async function loadData(preferredUserId = '') {
  const [p, c, report] = await Promise.all([
    supabase.from('profiles').select('id,full_name,email,role').order('full_name'),
    supabase.from('loyalty_cards').select('id,user_id,card_number,tier_code,status,points_balance,expires_at').order('issued_at', { ascending: false }),
    adminAction({ action: 'get_report' }),
  ]);

  profiles = (p.data || []).filter((profile) => profile.role === 'customer');
  cards = c.data || [];
  const issued = new Set(cards.map((card) => card.user_id));
  const clientSelect = document.getElementById('clientSelect');
  clientSelect.innerHTML = '<option value="">Seleccionar…</option>' + profiles
    .filter((profile) => !issued.has(profile.id))
    .map((profile) => `<option value="${profile.id}">${escapeHtml(profile.full_name || profile.email)}</option>`)
    .join('');
  if (preferredUserId && !issued.has(preferredUserId)) clientSelect.value = preferredUserId;

  const profileMap = new Map(profiles.map((profile) => [profile.id, profile]));
  document.getElementById('cardsBody').innerHTML = cards.length
    ? cards.map((card) => `<tr><td>${escapeHtml(profileMap.get(card.user_id)?.full_name || profileMap.get(card.user_id)?.email || 'Cliente')}</td><td>${formatCard(card.card_number)}</td><td>${labelTier(card.tier_code)}</td><td>${Number(card.points_balance || 0).toLocaleString('es-MX')}</td><td>${escapeHtml(card.status)}</td><td><div class="actions"><button class="secondary small" data-points="${card.id}">Puntos</button><button class="secondary small" data-rotate="${card.id}">Nuevo QR</button></div></td></tr>`).join('')
    : '<tr><td colspan="6">Aún no hay tarjetas emitidas.</td></tr>';
  renderReport(report.report);
  bindActions();
}

function renderReport(report) {
  if (!report) return;
  document.getElementById('reportIssued').textContent = Number(report.issued || 0).toLocaleString('es-MX');
  document.getElementById('reportActive').textContent = Number(report.active || 0).toLocaleString('es-MX');
  document.getElementById('reportPoints').textContent = Number(report.points || 0).toLocaleString('es-MX');
  document.getElementById('reportScans').textContent = Number(report.scans_30d || 0).toLocaleString('es-MX');
  const tiers = report.by_tier || {};
  document.getElementById('tierSummary').textContent = `Distribución: RHO Black ${tiers.black || 0} · Platino ${tiers.platino || 0} · Oro ${tiers.oro || 0} · Azul ${tiers.azul || 0}`;
}

document.getElementById('customerForm').addEventListener('submit', async (event) => {
  event.preventDefault();
  const form = event.currentTarget;
  const status = document.getElementById('customerStatus');
  const submit = form.querySelector('button[type="submit"]');
  const values = new FormData(form);
  submit.disabled = true;
  status.className = 'status';
  status.textContent = 'Registrando cliente…';
  const result = await adminAction({
    action: 'create_customer',
    full_name: values.get('full_name'),
    email: values.get('email'),
    company_name: values.get('company_name'),
    phone: values.get('phone'),
  });
  submit.disabled = false;
  if (result.error) {
    status.className = 'status error';
    status.textContent = result.error;
    return;
  }
  status.className = 'status ok';
  status.textContent = 'Cliente registrado. Se envió una invitación a su correo.';
  form.reset();
  await loadData(result.user.id);
});

document.getElementById('issueForm').addEventListener('submit', async (event) => {
  event.preventDefault();
  const form = event.currentTarget;
  const status = document.getElementById('issueStatus');
  const values = new FormData(form);
  status.textContent = 'Emitiendo…';
  status.className = 'status';
  const result = await adminAction({
    action: 'issue_card',
    user_id: values.get('user_id'),
    tier_code: values.get('tier_code'),
    expires_at: values.get('expires_at') ? new Date(`${values.get('expires_at')}T23:59:59`).toISOString() : null,
  });
  if (result.error) {
    status.className = 'status error';
    status.textContent = result.error;
    return;
  }
  status.className = 'status ok';
  status.textContent = 'Tarjeta emitida correctamente.';
  await showQr(result.validation_url);
  form.reset();
  await loadData();
});

function bindActions() {
  document.querySelectorAll('[data-points]').forEach((button) => button.addEventListener('click', async () => {
    const amount = prompt('Puntos a agregar. Usa un número negativo para descontar:');
    if (amount === null) return;
    const points = Number(amount);
    if (!Number.isInteger(points) || points === 0) {
      alert('Ingresa un número entero distinto de cero.');
      return;
    }
    const description = prompt('Concepto del movimiento:', 'Ajuste administrativo') || 'Ajuste administrativo';
    const result = await adminAction({
      action: 'add_points',
      card_id: button.dataset.points,
      points,
      event_type: points >= 0 ? 'earn' : 'adjust',
      description,
    });
    if (result.error) {
      alert(result.error);
      return;
    }
    alert(`Saldo actualizado: ${result.balance.points_balance} puntos`);
    await loadData();
  }));

  document.querySelectorAll('[data-rotate]').forEach((button) => button.addEventListener('click', async () => {
    if (!confirm('El QR anterior dejará de funcionar. ¿Continuar?')) return;
    const result = await adminAction({ action: 'rotate_qr', card_id: button.dataset.rotate });
    if (result.error) {
      alert(result.error);
      return;
    }
    await showQr(result.validation_url);
    await loadData();
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }));
}

async function adminAction(payload) {
  try {
    const response = await fetch('https://mtpqpxcmngrsivntbgcc.supabase.co/functions/v1/loyalty-admin', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${session.access_token}`,
        apikey: 'sb_publishable_5Dan5EdjEHyfPDG30opQ8Q_d-Kkp72_',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(payload),
    });
    const data = await response.json();
    return response.ok ? data : { error: data.error || 'No fue posible completar la operación.' };
  } catch {
    return { error: 'No fue posible conectar con el servicio de lealtad.' };
  }
}

async function showQr(url) {
  const result = document.getElementById('qrResult');
  result.hidden = false;
  document.getElementById('qrUrl').value = url;
  await QRCode.toCanvas(document.getElementById('adminQr'), url, { width: 230, margin: 2, errorCorrectionLevel: 'M' });
}

document.getElementById('copyQr').addEventListener('click', () => navigator.clipboard.writeText(document.getElementById('qrUrl').value));
document.getElementById('logoutBtn').addEventListener('click', async () => {
  await supabase.auth.signOut();
  location.replace('login.html');
});

function labelTier(value) {
  return ({ azul: 'RHO Azul', black: 'RHO Black', oro: 'RHO Oro', platino: 'RHO Platino' })[value] || value;
}

function formatCard(value) {
  return String(value).replace(/(.{4})/g, '$1 ').trim();
}

function escapeHtml(value) {
  return String(value).replace(/[&<>'"]/g, (character) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' })[character]);
}
