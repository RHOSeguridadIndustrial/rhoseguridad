import { searchCatalog } from './search-catalog.js?v=20261008-4';
import { inventoryVariants } from './inventory-catalog.js?v=20261008-1';
import { buildQuoteCatalog, calculateQuote, MAX_QUANTITY } from './quote-model.js?v=20261025-1';

const $ = id => document.getElementById(id);
const money = cents => new Intl.NumberFormat('es-MX', {style:'currency', currency:'MXN'}).format(cents / 100);
const normalize = value => String(value).normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
const dateText = date => new Intl.DateTimeFormat('es-MX', {dateStyle:'medium', timeStyle:'short', timeZone:'America/Mexico_City'}).format(date) + ' (CDMX)';
const selected = new Map();
let catalog = [], ready = false, loading = false, checkedAt = null, registered = false, client = null;
let authGeneration = 0, activeUser = undefined;

function node(tag, text, className) {
  const el = document.createElement(tag);
  if (text !== undefined) el.textContent = text;
  if (className) el.className = className;
  return el;
}
function timeout(promise, milliseconds = 15000) {
  let timer;
  return Promise.race([promise, new Promise((_, reject) => { timer = setTimeout(() => reject(new Error('timeout')), milliseconds); })])
    .finally(() => clearTimeout(timer));
}
function stockText(product) {
  if (product.stock === null) return 'Existencias sin confirmar · Consulta con RHO';
  const units = product.unit === 'par' ? ['par', 'pares'] : ['pieza', 'piezas'];
  return `Existencias en stock: ${product.stock} ${product.stock === 1 ? units[0] : units[1]}`;
}
function snapshot() {
  if (!ready || !checkedAt || Date.now() - checkedAt.getTime() > 5 * 60 * 1000)
    throw new Error('Actualiza el catálogo para consultar precios y existencias.');
  return calculateQuote([...selected].map(([sku, quantity]) => ({sku, quantity:Number(quantity)})), catalog,
    {registered, paymentMethod:$('payment').value, coverage:$('destination').value});
}
function shippingMessage(quote) {
  const s = quote.shipping;
  if (s.status === 'eligible') return `Envío ${s.mode === 'express' ? 'express: 24 hrs' : 'estándar: 2 a 3 días hábiles'}, gratis para tu cuenta RHO. Estimación para CDMX; plazo a partir de la confirmación del pago y sujeto a validar domicilio y disponibilidad.`;
  if (s.status === 'paid') return 'Envío estándar estimado: $99.00 en CDMX. Plazo de 2 a 3 días hábiles desde la confirmación del pago, sujeto a validar domicilio y disponibilidad.';
  return ({special:'Pedido especial: la cantidad supera las existencias. El precio final, descuento, envío y entrega se confirman por WhatsApp.',
    inventory:'Es necesario confirmar las existencias con RHO. El envío y total final están pendientes.',
    coverage:$('destination').value === 'other' ? 'La cobertura publicada es CDMX. Para otra ubicación, RHO debe confirmar cobertura y costo; el envío no está incluido.' : 'Selecciona el destino para estimar el envío.',
    payment:'Selecciona la forma de pago prevista para estimar el envío.',
    registration:'No hemos podido reconocer tu registro RHO. En compras desde $299, el costo de envío queda pendiente hasta confirmar tu registro. Puedes entrar a tu cuenta para consultar el beneficio.'})[s.reason] || 'Envío pendiente de confirmar.';
}
function renderCatalog() {
  const list = $('catalog-list'); list.replaceChildren();
  if (!ready) return;
  const tokens = normalize($('search').value).split(/\s+/).filter(Boolean);
  const matches = catalog.filter(p => (!$('category').value || p.category === $('category').value) && tokens.every(t => normalize(`${p.name} ${p.category} ${p.sku}`).includes(t)));
  if (!matches.length) { list.append(node('p', 'No encontramos artículos. Prueba otro nombre o categoría.', 'empty-state')); return; }
  for (const product of matches) {
    const card = node('article', undefined, 'catalog-item'), copy = node('div');
    copy.append(node('h3', product.name), node('p', product.category), node('p', `${money(product.unitCents)} / ${product.unit} · IVA incluido`, 'item-price'), node('p', stockText(product)));
    const button = node('button', 'Agregar', 'add-button'); button.type = 'button';
    button.setAttribute('aria-label', `Agregar ${product.name}`);
    button.addEventListener('click', () => {
      const next = Number(selected.get(product.sku) || 0) + 1;
      if (!Number.isSafeInteger(next) || next > MAX_QUANTITY) { $('action-status').textContent = `El máximo por artículo es ${MAX_QUANTITY}.`; return; }
      selected.set(product.sku, next); renderLines(); renderSummary();
      $('action-status').textContent = `${product.name}: ${next} en tu cotización.`;
      button.textContent = 'Agregado'; setTimeout(() => { button.textContent = 'Agregar'; }, 1200);
    });
    card.append(copy, button); list.append(card);
  }
}
function updateLine(row, sku) {
  const product = catalog.find(p => p.sku === sku), qty = Number(selected.get(sku));
  const valid = Number.isSafeInteger(qty) && qty >= 1 && qty <= MAX_QUANTITY;
  row.querySelector('.line-price').textContent = ready && product && valid ? money(product.unitCents * qty) : 'Importe por confirmar';
  const status = row.querySelector('.line-stock');
  const shortage = !!product && product.stock !== null && valid && qty > product.stock;
  status.textContent = !ready ? 'Actualiza el catálogo para confirmar existencias.' : !product ? 'Artículo no disponible: retíralo para continuar.' : shortage ? `${stockText(product)} · Pedido especial: ${qty - product.stock} ${qty - product.stock === 1 ? 'adicional' : 'adicionales'}` : stockText(product);
  status.classList.toggle('stock-warning', shortage || !product);
}
function renderLines() {
  $('empty-selection').hidden = selected.size > 0;
  const container = $('quote-lines'); container.replaceChildren();
  for (const [sku, quantity] of selected) {
    const product = catalog.find(p => p.sku === sku), row = node('article', undefined, 'quote-line'), copy = node('div');
    row.dataset.sku = sku;
    copy.append(node('h3', product?.name || sku), node('p', product && ready ? `${money(product.unitCents)} / ${product.unit} · IVA incluido` : 'Precio por confirmar'), node('p', '', 'line-stock'), node('p', '', 'line-price'));
    const remove = node('button', 'Eliminar', 'remove-button'); remove.type = 'button'; remove.setAttribute('aria-label', `Eliminar ${product?.name || sku}`);
    remove.addEventListener('click', () => { selected.delete(sku); renderLines(); renderSummary(); $('action-status').textContent = 'Artículo eliminado.'; });
    copy.append(remove);
    const label = node('label', 'Cantidad', 'line-quantity'), input = node('input');
    input.type = 'number'; input.min = '1'; input.max = String(MAX_QUANTITY); input.step = '1'; input.inputMode = 'numeric'; input.value = quantity;
    input.setAttribute('aria-label', `Cantidad de ${product?.name || sku}`);
    input.addEventListener('input', () => { selected.set(sku, input.value); input.setAttribute('aria-invalid', String(!input.validity.valid || input.value === '')); updateLine(row, sku); renderSummary(); });
    label.append(input); row.append(copy, label); container.append(row); updateLine(row, sku);
  }
}
function specialMessage(quote) {
  const lines = ['Hola RHO, quisiera cotizar este pedido especial.', $('customer').value.trim() && `Nombre: ${$('customer').value.trim()}`, $('company').value.trim() && `Empresa: ${$('company').value.trim()}`,
    ...quote.lines.map(p => `${p.quantity} ${p.unit === 'par' ? 'par(es)' : 'pieza(s)'} de ${p.name} (${p.sku}) — ${money(p.amountCents)} de referencia${p.shortage ? '; excede las existencias' : ''}.`),
    `Productos con IVA, importe de referencia: ${money(quote.productsCents)} MXN.`,
    'Solicito confirmar precio final, descuento, disponibilidad, costo de envío y fecha de entrega. Esta cotización preliminar no reserva mercancía.'];
  return lines.filter(Boolean).join('\n');
}
function renderSummary() {
  $('print').disabled = true; $('special-order').hidden = true; $('special-help').hidden = true;
  $('special-order').removeAttribute('href');
  for (const id of ['net', 'tax', 'products-total', 'total']) $(id).textContent = '—';
  $('shipping').textContent = 'Por confirmar';
  try {
    const q = snapshot();
    $('net').textContent = money(q.netCents); $('tax').textContent = money(q.taxCents); $('products-total').textContent = money(q.productsCents);
    if (q.shipping.shippingCents !== null) $('shipping').textContent = money(q.shipping.shippingCents);
    if (q.shipping.totalCents !== null) $('total').textContent = money(q.shipping.totalCents);
    else $('total').textContent = 'Por confirmar';
    $('quote-status').textContent = shippingMessage(q); $('print').disabled = false;
    if (q.specialOrder) {
      $('special-order').href = 'https://wa.me/525545683441?text=' + encodeURIComponent(specialMessage(q));
      $('special-order').hidden = false; $('special-help').hidden = false;
    }
  } catch (error) { $('quote-status').textContent = selected.size ? error.message : 'Agrega al menos un artículo.'; }
}
async function loadCatalog() {
  if (loading) return false;
  loading = true; ready = false; $('refresh').disabled = true;
  $('catalog-status').textContent = 'Consultando precios y existencias…'; renderSummary(); renderCatalog();
  try {
    if (!client) {
      const { supabase } = await timeout(import('./supabase-client.js?v=20260913-loyalty'));
      client = supabase;
      client.auth.onAuthStateChange((event, session) => {
        const user = session?.user?.id || null;
        if (activeUser !== undefined && activeUser !== user) {
          selected.clear(); $('customer').value = ''; $('company').value = ''; renderLines();
          $('action-status').textContent = 'La sesión cambió. Inicia una nueva cotización.';
        }
        activeUser = user; registered = false; ++authGeneration; renderSummary();
        setTimeout(verifyRegistration, 0);
      });
      verifyRegistration();
    }
    const controller = new AbortController(), timer = setTimeout(() => controller.abort(), 15000);
    let responses;
    try {
      responses = await Promise.all([
        client.from('products').select('id,name,price,currency,is_active').eq('is_active', true).abortSignal(controller.signal),
        client.from('inventory_items').select('sku,name,quantity,unit,state,is_active').abortSignal(controller.signal)
      ]);
    } finally { clearTimeout(timer); }
    if (responses.some(r => r.error || !Array.isArray(r.data))) throw new Error('catalog unavailable');
    catalog = buildQuoteCatalog(searchCatalog, inventoryVariants, responses[0].data, responses[1].data);
    if (!catalog.length) throw new Error('empty catalog');
    ready = true; checkedAt = new Date();
    const value = $('category').value; $('category').replaceChildren(new Option('Todas las categorías', ''));
    [...new Set(catalog.map(p => p.category))].forEach(category => $('category').add(new Option(category, category)));
    $('category').value = value;
    $('catalog-status').textContent = `${catalog.length} variantes disponibles para cotizar. Selecciona color o talla en el nombre del artículo.`;
    $('checked-at').textContent = `Consulta: ${dateText(checkedAt)}`;
    return true;
  } catch {
    $('catalog-status').textContent = 'No pudimos consultar el catálogo. Revisa tu conexión y pulsa Actualizar catálogo.';
    $('checked-at').textContent = 'Sin consulta vigente: no se puede emitir la cotización.';
    if (!client) $('registration-status').textContent = 'No pudimos consultar tu registro RHO. Intenta actualizar el catálogo.';
    return false;
  } finally { loading = false; $('refresh').disabled = false; renderCatalog(); renderLines(); renderSummary(); }
}
async function verifyRegistration() {
  const generation = ++authGeneration; registered = false;
  $('registration-status').textContent = 'Consultando tu registro RHO…'; renderSummary();
  try {
    const { data, error } = await timeout(client.auth.getUser());
    if (generation !== authGeneration) return;
    registered = !error && !!data?.user?.id && data.user.is_anonymous !== true;
  } catch { if (generation !== authGeneration) return; }
  $('registration-status').textContent = registered ? 'Registro RHO reconocido. Consulta tu beneficio de envío en el resumen.' : 'Sin registro reconocido en esta sesión. El beneficio de envío se mostrará cuando podamos verificar tu cuenta.';
  renderSummary();
}
async function importCart() {
  $('import-cart').disabled = true;
  try {
    const { getCart } = await timeout(import('./cart.js?v=20260914-account-isolation'));
    const items = getCart();
    if (!items.length) { $('action-status').textContent = 'Tu carrito está vacío o tu sesión no está disponible.'; return; }
    const imported = new Map(); let omitted = 0;
    for (const item of items) {
      const quantity = Number(item.qty), sum = (imported.get(item.id) || 0) + quantity;
      if (!catalog.some(p => p.sku === item.id) || !Number.isSafeInteger(quantity) || quantity < 1 || sum > MAX_QUANTITY) { omitted++; continue; }
      imported.set(item.id, sum);
    }
    if (!imported.size) { $('action-status').textContent = 'Los artículos del carrito no están disponibles para cotizar. Revisa el catálogo.'; return; }
    selected.clear(); for (const [sku, quantity] of imported) selected.set(sku, quantity);
    renderLines(); renderSummary();
    $('action-status').textContent = `Selección reemplazada por ${imported.size} artículo(s) del carrito con los precios consultados.${omitted ? ` Se omitieron ${omitted} artículo(s) no disponibles o con cantidades inválidas.` : ''} Tu carrito conserva su contenido.`;
  } catch { $('action-status').textContent = 'No pudimos leer tu carrito. Intenta de nuevo.'; }
  finally { $('import-cart').disabled = false; }
}
function renderPrint() {
  const doc = $('print-document'); doc.replaceChildren();
  let quote;
  try { quote = snapshot(); } catch { doc.append(node('h1', 'Cotización no disponible'), node('p', 'Regresa al cotizador, actualiza el catálogo y revisa los artículos y cantidades.')); return false; }
  const header = node('div', undefined, 'print-header'), logo = node('img'); logo.src = 'logo-rho.jpeg'; logo.alt = 'RHO Seguridad Industrial';
  const title = node('div'); title.append(node('h1', 'Cotización preliminar'), node('p', 'RHO Seguridad Industrial'), node('p', 'rhosegind.com · 55 4568 3441')); header.append(logo, title); doc.append(header);
  const details = node('div', undefined, 'print-meta'); details.append(node('p', `Consulta: ${dateText(checkedAt)}`));
  if ($('customer').value.trim()) details.append(node('p', `Cliente: ${$('customer').value.trim()}`));
  if ($('company').value.trim()) details.append(node('p', `Empresa: ${$('company').value.trim()}`));
  if ($('destination').value) details.append(node('p', `Destino previsto: ${$('destination').selectedOptions[0].textContent}`));
  if ($('payment').value) details.append(node('p', `Forma de pago prevista: ${$('payment').selectedOptions[0].textContent}`));
  doc.append(details);
  const table = node('table'), head = node('thead'), heading = node('tr');
  ['Artículo / variante', 'Cantidad', 'Precio unitario', 'Importe'].forEach(t => { const th = node('th', t); th.scope = 'col'; heading.append(th); }); head.append(heading); table.append(head);
  const body = node('tbody');
  for (const p of quote.lines) {
    const row = node('tr'), name = node('td', p.name);
    name.append(node('small', `SKU: ${p.sku}`), node('small', `${stockText(p)}${p.shortage ? ' · Pedido especial' : ''}`));
    row.append(name, node('td', `${p.quantity} ${p.unit === 'par' ? 'par(es)' : 'pieza(s)'}`), node('td', money(p.unitCents)), node('td', money(p.amountCents))); body.append(row);
  }
  table.append(body); doc.append(table);
  const totals = node('div', undefined, 'print-totals');
  for (const [label, value] of [['Productos sin IVA', money(quote.netCents)], ['IVA de productos (16%)', money(quote.taxCents)], ['Productos con IVA', money(quote.productsCents)], ['Envío estimado, IVA incluido', quote.shipping.shippingCents === null ? 'Por confirmar' : money(quote.shipping.shippingCents)], ['Total estimado MXN', quote.shipping.totalCents === null ? 'Por confirmar' : money(quote.shipping.totalCents)]]) {
    const line = node('p', undefined, label.startsWith('Total') ? 'print-total' : ''); line.append(node('span', label), node('strong', value)); totals.append(line);
  }
  doc.append(totals, node('p', shippingMessage(quote), 'print-terms'), node('p', 'Todos los precios están expresados en MXN. Los precios unitarios e importes de productos incluyen IVA; el desglose no añade IVA por segunda vez. Vigencia: precios y existencias sujetos a confirmación al realizar el pedido. Este documento es preliminar, no es una factura ni una orden de compra y no reserva mercancía. RHO confirma el domicilio, cobertura y entrega antes del pago. Los pedidos especiales requieren confirmar precio final, descuento y envío.', 'print-terms'));
  return true;
}
$('search').addEventListener('input', renderCatalog); $('category').addEventListener('change', renderCatalog);
$('refresh').addEventListener('click', loadCatalog); $('import-cart').addEventListener('click', importCart);
for (const id of ['customer', 'company', 'destination', 'payment']) $(id).addEventListener('input', renderSummary);
$('print').addEventListener('click', async () => { if (await loadCatalog()) { if (renderPrint()) window.print(); } });
window.addEventListener('beforeprint', renderPrint);
window.addEventListener('pageshow', event => { if (event.persisted) location.reload(); });
window.addEventListener('focus', () => { if (checkedAt && Date.now() - checkedAt.getTime() > 5 * 60 * 1000) loadCatalog(); });
setInterval(() => { if (!document.hidden) renderSummary(); }, 30000);
loadCatalog().then(success => { if (success && new URLSearchParams(location.search).get('desde') === 'carrito') importCart(); });
