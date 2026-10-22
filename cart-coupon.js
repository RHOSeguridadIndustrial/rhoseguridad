import {getCart} from './cart.js?v=20260914-account-isolation';
import {supabase} from './supabase-client.js?v=20260913-loyalty';
import {shippingCoupon} from './shipping-coupon.js?v=20261022';
const money = cents => new Intl.NumberFormat('es-MX',{style:'currency',currency:'MXN'}).format(cents/100);
let registered = false, checking = true, method = '', generation = 0;
function update() {
  const panel = document.querySelector('[data-coupon-preview]');
  if (!panel) return;
  const cart = getCart();
  const valid = cart.length && cart.every(i => Number.isFinite(Number(i.price)) && Number(i.price)>0 && Number.isSafeInteger(i.qty) && i.qty>0);
  const subtotalCents = valid ? cart.reduce((s,i)=>s+Math.round(Number(i.price)*100)*i.qty,0) : null;
  // This is explicitly a CDMX estimate, not a validated delivery address.
  const result = shippingCoupon({subtotalCents,registered,paymentMethod:method,coverage:'cdmx'});
  const output = panel.querySelector('[role="status"]');
  if (checking) output.textContent = 'Verificando tu registro RHO…';
  else if (result.status==='eligible') output.textContent = `Cupón disponible para tu cuenta RHO: envío ${result.mode==='express'?'express (24 hrs)':'estándar (2 a 3 días hábiles)'} gratis. Total estimado: ${money(result.totalCents)}.`;
  else if (result.status==='paid') output.textContent = `Envío estándar: ${money(result.shippingCents)}. Total estimado: ${money(result.totalCents)}. El cupón aplica desde $299 MXN.`;
  else output.textContent = ({payment:'Elige tarjeta o transferencia para consultar tu beneficio.',registration:'No hemos podido reconocer tu registro RHO. El costo de envío está pendiente de confirmar; aún no hay un total final.',invalid:'Revisa los precios y cantidades del carrito.'})[result.reason] || 'Envío pendiente de confirmar.';
}
function mount() {
  const summary = document.querySelector('#cart-content .summary');
  if (!summary || summary.querySelector('[data-coupon-preview]')) return;
  const panel = document.createElement('section');
  panel.dataset.couponPreview = '';
  panel.innerHTML = '<h3>Beneficio de envío RHO</h3><label class="guest-field">Forma de pago prevista<select aria-label="Forma de pago prevista"><option value="">Selecciona una opción</option><option value="card">Tarjeta de crédito o débito</option><option value="transfer">Transferencia bancaria</option></select></label><p role="status" aria-live="polite"></p><p>Estimación para CDMX. Sujeta a confirmar domicilio, existencias y registro antes del pago. Los pedidos especiales se cotizan por separado.</p><p>El pago en línea y la aplicación del cupón al pedido estarán disponibles próximamente.</p><a href="registro.html">Registrarme en RHO</a> · <a href="cuenta.html">Mi cuenta</a> · <a href="envios-entregas.html">Condiciones del cupón</a>';
  const select = panel.querySelector('select');
  select.value=method;
  select.addEventListener('change',()=>{method=select.value;update();});
  summary.append(panel); update();
}
async function verifyRegistration() {
  const request = ++generation;
  registered=false; checking=true; update();
  try {
    const {data,error} = await supabase.auth.getUser();
    if (request !== generation) return;
    registered = !error && !!data?.user?.id && data.user.is_anonymous !== true;
  } catch { if(request !== generation)return; registered=false; }
  checking=false; update();
}
supabase.auth.onAuthStateChange(()=>{
  ++generation; registered=false; checking=true; update();
  setTimeout(verifyRegistration,0);
});
const content=document.getElementById('cart-content');
if(content)new MutationObserver(mount).observe(content,{childList:true});
window.addEventListener('rho-cart-changed',()=>{mount();update();});
window.addEventListener('rho-prices-updated',()=>{mount();update();});
mount();verifyRegistration();
