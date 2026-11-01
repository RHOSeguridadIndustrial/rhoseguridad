import {searchCatalog} from './search-catalog.js?v=20261008-4';
import {inventoryVariants} from './inventory-catalog.js?v=20261008-1';
import {buildQuoteCatalog, calculateQuote} from './quote-model.js?v=20261025-1';
import {transferContact, deliveryText} from './transfer-request-model.js?v=20261031-postal';
import {setupPostalAddress} from './postal-address.js?v=20261031-mx';

import {submitTransferRequest, transferError} from './transfer-persistence.js?v=20261101';

const $ = id => document.getElementById(id);
const form = $('transfer-form');
const money = cents => new Intl.NumberFormat('es-MX',{style:'currency',currency:'MXN'}).format(cents/100);
let client, getCart, catalog = [], registered = false, checkedAt = 0;
let revision = 0, loadGeneration = 0, observedOwner, currentOwner = null, prepared = null, busy = false;
const node = (tag,text) => {const element=document.createElement(tag);element.textContent=text;return element;};
function invalidate(message = '') {
  revision++; prepared = null;
  $('review-panel').hidden = true; $('send-request').disabled=false;
  $('review-contact').textContent = ''; $('review-delivery').textContent = '';
  $('request-status').textContent = message; $('whatsapp-status').textContent = '';
}
function formValues() {
  return {...Object.fromEntries(new FormData(form)), invoice:form.elements.invoice.checked};
}
function selection() {return getCart().map(item=>({sku:item.id,quantity:item.qty}));}
function quote() {
  if (!checkedAt || Date.now()-checkedAt > 5*60*1000) throw new Error('Actualiza los precios y existencias para continuar.');
  return calculateQuote(selection(),catalog,{registered,paymentMethod:'transfer',coverage:form.elements.destination.value});
}
function fingerprint() {return JSON.stringify({items:selection(),contact:formValues()});}
function shippingText(value) {
  if (value.shipping.status === 'eligible') return `Beneficio estimado: envío ${value.shipping.mode === 'express' ? 'express (24 hrs)' : 'estándar'} gratis. RHO confirmará tu registro, domicilio y fecha de entrega.`;
  if (value.shipping.status === 'paid') return 'Envío estándar estimado para CDMX. RHO confirmará cobertura, costo y fecha de entrega.';
  return ({registration:'Envío por confirmar. Ingresa a tu cuenta RHO para consultar el beneficio de envío.',coverage:'RHO debe confirmar cobertura y costo para este destino.',special:'La cantidad solicitada supera las existencias. Continúa en Suministro especializado.',inventory:'Hay existencias pendientes de confirmar. Consulta con RHO en Suministro especializado.'})[value.shipping.reason] || 'Envío y total final por confirmar con RHO.';
}
function render() {
  if (!getCart) return;
  const empty = !getCart().length;
  $('empty-cart').hidden = !empty; $('checkout-layout').hidden = empty;
  $('review-request').disabled = true; $('special-link').hidden = true;
  $('transfer-items').replaceChildren();
  $('products-total').textContent = '—'; $('shipping-total').textContent = 'Por confirmar'; $('transfer-total').textContent = 'Por confirmar';
  if (empty) return;
  try {
    const value = quote();
    for (const line of value.lines) {
      const li=node('li',''),copy=node('div',line.name),amount=node('strong',money(line.amountCents));
      copy.append(node('small',`${line.quantity} ${line.unit === 'par' ? 'par(es)' : 'pieza(s)'} × ${money(line.unitCents)}`));
      const stock=node('span',line.stock === null ? 'Existencias por confirmar' : `${line.stock} ${line.unit === 'par' ? 'pares' : 'piezas'} disponibles al consultar${line.shortage ? ' · cantidad insuficiente' : ''}`);stock.className='availability';
      li.append(copy,amount,stock);$('transfer-items').append(li);
    }
    $('products-total').textContent = money(value.productsCents);
    if (value.shipping.shippingCents !== null) $('shipping-total').textContent = money(value.shipping.shippingCents);
    if (value.shipping.totalCents !== null) $('transfer-total').textContent = money(value.shipping.totalCents);
    $('shipping-note').textContent = shippingText(value);
    $('special-link').hidden = !value.specialOrder && !value.stockUnknown;
    $('review-request').disabled = busy || value.specialOrder || value.stockUnknown;
  } catch(error) { $('shipping-note').textContent = error.message; }
}
function timeout(promise) {
  let timer;
  return Promise.race([promise,new Promise((_,reject)=>{timer=setTimeout(()=>reject(new Error('timeout')),15000);})]).finally(()=>clearTimeout(timer));
}
async function refresh() {
  const attempt = ++loadGeneration;
  checkedAt = 0; registered = false; $('refresh-catalog').disabled = true; render();
  $('catalog-status').textContent = 'Consultando precios y existencias…';
  const controller = new AbortController(), timer = setTimeout(()=>controller.abort(),15000);
  try {
    const [products, inventory, identity] = await Promise.all([
      client.from('products').select('id,name,price,currency,is_active').eq('is_active',true).abortSignal(controller.signal),
      client.from('inventory_items').select('sku,name,quantity,unit,state,is_active').abortSignal(controller.signal),
      timeout(client.auth.getUser()).catch(()=>({data:{user:null}}))
    ]);
    if (attempt !== loadGeneration) return false;
    if (products.error || inventory.error || !Array.isArray(products.data) || !Array.isArray(inventory.data)) throw new Error();
    catalog = buildQuoteCatalog(searchCatalog,inventoryVariants,products.data,inventory.data);
    currentOwner = identity.data?.user?.id || null;
    registered = !identity.error && !!identity.data?.user?.id && identity.data.user.is_anonymous !== true;
    checkedAt = Date.now();
    $('catalog-status').textContent = 'Precios y existencias consultados. La disponibilidad final se confirma con RHO.';
    render(); return true;
  } catch {
    if (attempt === loadGeneration) {$('catalog-status').textContent='No pudimos consultar los precios y existencias. Revisa tu conexión y pulsa Actualizar.';render();}
    return false;
  } finally {clearTimeout(timer); if (attempt === loadGeneration) $('refresh-catalog').disabled = false;}
}
function destinationChanged() {
  const other=form.elements.destination.value==='other';
  $('state-field').hidden=!other;form.elements.state.disabled=!other;form.elements.state.required=other;
}
form.addEventListener('input',()=>{invalidate();destinationChanged();render();});
form.addEventListener('change',()=>{invalidate();destinationChanged();render();});
form.addEventListener('submit',async event=>{
  event.preventDefault();if(busy || !form.reportValidity())return;
  let contact;
  try {contact=transferContact(formValues());}catch(error){$('request-status').textContent=error.message;return;}
  invalidate(); const attempt=revision, original=fingerprint(); busy=true;render();
  $('request-status').textContent='Revisando precios y existencias actuales…';
  try {
    const loaded=await refresh();
    if (attempt !== revision || original !== fingerprint()) return;
    if (!loaded) { $('request-status').textContent='No pudimos revisar la solicitud. Actualiza los precios y vuelve a intentarlo.'; return; }
    const value=quote();
    if(value.specialOrder || value.stockUnknown) throw Error('Confirma las existencias con RHO antes de continuar.');
    if(!registered || !currentOwner) throw Error('Inicia sesión en tu cuenta RHO para registrar y consultar tu solicitud.');
    prepared={fingerprint:original,checkedAt,owner:currentOwner,contact,items:selection(),productsCents:value.productsCents};
    $('review-contact').textContent=`${contact.name} · ${contact.phone}${contact.company ? ' · '+contact.company : ''}${contact.email ? ' · '+contact.email : ''}`;
    $('review-delivery').textContent=deliveryText(contact)+(contact.notes ? '. Referencias: '+contact.notes : '')+(contact.invoice ? '. Requiere factura.' : '');
    $('review-panel').hidden=false;
    $('request-status').textContent='Solicitud lista para revisar. Confirma el resumen y pulsa Registrar solicitud en RHO.';
    $('review-panel').focus();$('review-panel').scrollIntoView({behavior:'smooth',block:'nearest'});
  } catch(error) {if(attempt===revision)$('request-status').textContent=error.message;}
  finally {busy=false;render();}
});
$('send-request').addEventListener('click',async event=>{
  event.preventDefault(); if(busy)return;
  if (!prepared || prepared.fingerprint!==fingerprint() || Date.now()-prepared.checkedAt>5*60*1000) {
    invalidate('Los datos o precios necesitan una nueva revisión. Pulsa Revisar mi solicitud.');render();return;
  }
  const request=prepared, attempt=revision;
  busy=true;
  const controls=[...form.querySelectorAll('input,select,textarea,button')];
  const states=controls.map(element=>element.disabled);
  controls.forEach(element=>element.disabled=true);$('send-request').disabled=true;
  $('whatsapp-status').textContent='Registrando tu solicitud en RHO…';
  try{
    const receipt=await submitTransferRequest(client,request);
    const {data}=await client.auth.getSession();
    if(attempt!==revision || data.session?.user?.id!==request.owner)return;
    $('request-receipt').hidden=false;
    $('receipt-reference').textContent=receipt.reference;
    $('receipt-products').textContent=money(receipt.products_cents);
    $('review-panel').hidden=true;prepared=null;
    $('request-status').textContent='Solicitud registrada. Consulta el folio y los siguientes pasos.';
    $('request-receipt').focus();$('request-receipt').scrollIntoView({behavior:'smooth',block:'nearest'});
  }catch(error){if(attempt===revision)$('whatsapp-status').textContent=transferError(error);}
  finally{controls.forEach((element,i)=>element.disabled=states[i]);busy=false;$('send-request').disabled=false;render();}
});
$('refresh-catalog').addEventListener('click',()=>{if(busy)return;invalidate();refresh();});
window.addEventListener('rho-cart-changed',()=>{invalidate('El carrito cambió. Revisa nuevamente tu solicitud.');render();});
window.addEventListener('rho-prices-updated',()=>{invalidate('Los precios cambiaron. Revisa nuevamente tu solicitud.');checkedAt=0;render();});
window.addEventListener('pageshow',event=>{if(event.persisted){invalidate();refresh();}});
window.addEventListener('focus',()=>{if(checkedAt && Date.now()-checkedAt>5*60*1000){invalidate('Actualiza tu resumen antes de enviar la solicitud.');render();}});
setInterval(()=>{if(checkedAt && Date.now()-checkedAt>5*60*1000){if(prepared)invalidate('Actualiza tu resumen antes de enviar la solicitud.');render();}},30000);
async function start() {
  try {
    const [supabaseModule,cartModule]=await timeout(Promise.all([import('./supabase-client.js?v=20260913-loyalty'),import('./cart.js?v=10.4')]));
    client=supabaseModule.supabase;getCart=cartModule.getCart;
    client.auth.onAuthStateChange((event,session)=>{
      const owner=session?.user?.id??null,changed=observedOwner!==undefined && owner!==observedOwner;
      observedOwner=owner;
      if(changed || event==='SIGNED_OUT'){
        ++loadGeneration;checkedAt=0;registered=false;currentOwner=null;
        $('request-receipt').hidden=true;$('receipt-reference').textContent='';$('receipt-products').textContent='';form.reset();postalAddress.reset();destinationChanged();
        invalidate('La sesión cambió. Completa una nueva solicitud.');render();setTimeout(refresh,0);
      }
    });
    destinationChanged();await refresh();
  } catch {$('catalog-status').textContent='No pudimos cargar tu carrito. Revisa tu conexión y vuelve a abrir esta página.';}
}
const postalAddress=setupPostalAddress({form,onChange:()=>{invalidate();destinationChanged();render();}});
start();

