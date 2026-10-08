import {supabase} from './supabase-client.js?v=20261007-inventory';
import {requireSecureAdmin} from './admin-security-guard.js?v=20261007-1';
const $=id=>document.getElementById(id);
const esc=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
let inventory=[],lines=[],busy=false;
const labels={active:'Activa',expired:'Vencida',cancelled:'Cancelada'};
const date=value=>new Date(value).toLocaleString('es-MX',{timeZone:'America/Mexico_City'});
function status(message,error=false){$('message').textContent=message;$('message').className=error?'error':'';}
function buttons(){for(const id of ['refresh','add','reserve'])$(id).disabled=busy||(id==='reserve'&&!lines.length);}
async function rpc(action,reference=null,items=null){const {data,error}=await supabase.rpc('inventory_reservation',{p_action:action,p_reference:reference,p_items:items});if(error)throw error;return data;}
function drawLines(){const names=new Map(inventory.map(i=>[i.sku,i.name]));$('lines').innerHTML=lines.map((i,n)=>`<li>${esc(names.get(i.sku)||i.sku)} · ${i.quantity} <button type="button" data-remove="${n}">Quitar</button></li>`).join('');buttons();}
async function refresh(){const data=await rpc('list');inventory=data.inventory;
  $('sku').innerHTML=inventory.map(i=>`<option value="${esc(i.sku)}">${esc(i.name)} · ${i.available} para reservar</option>`).join('');
  const names=new Map(inventory.map(i=>[i.sku,i.name]));
  $('reservations').innerHTML=data.reservations.length?data.reservations.map(r=>`<tr><td>${esc(r.reference)}</td><td>${r.items.map(i=>`${esc(names.get(i.sku)||i.sku)} · ${i.quantity}`).join('<br>')}</td><td>${labels[r.status]||'No disponible'}</td><td>${esc(date(r.expires_at))}</td><td>${r.status==='active'?`<button type="button" data-cancel="${esc(r.reference)}">Cancelar reserva</button>`:'—'}</td></tr>`).join(''):'<tr><td colspan="5">Aún no hay reservas.</td></tr>';
  drawLines();
}
async function run(operation){if(busy)return;busy=true;buttons();try{await operation();}catch(error){status(error.message||'No fue posible completar la operación.',true);}finally{busy=false;buttons();}}
$('add').onclick=()=>{const sku=$('sku').value,quantity=Number($('quantity').value);if(!sku||!Number.isInteger(quantity)||quantity<1||quantity>1000000){status('Selecciona un artículo y una cantidad válida.',true);return;}const old=lines.find(i=>i.sku===sku);if(old){if(old.quantity+quantity>1000000){status('Cantidad inválida.',true);return;}old.quantity+=quantity;}else lines.push({sku,quantity});drawLines();};
$('lines').onclick=e=>{const b=e.target.closest('[data-remove]');if(b&&!busy){lines.splice(Number(b.dataset.remove),1);drawLines();}};
$('refresh').onclick=()=>run(async()=>{await refresh();status('Reservas actualizadas.');});
$('reserve-form').onsubmit=e=>{e.preventDefault();run(async()=>{if(!lines.length)return;const reference=$('reference').value.trim().toUpperCase();const result=await rpc('create',reference,lines);
  if(result.action==='reserved'){status(`Reserva ${reference} activa hasta ${date(result.expires_at)} (CDMX).`);lines=[];}
  else if(result.action==='quote')status('No hay existencias suficientes para reservar toda la cotización. Continúa la atención por WhatsApp; no se apartaron piezas.',true);
  else status('Esta referencia corresponde a una reserva '+(labels[result.action]?.toLowerCase()||'cerrada')+'. Confirma una nueva cotización antes de volver a reservar.',true);
  await refresh();});};
$('reservations').onclick=e=>{const button=e.target.closest('[data-cancel]');if(button)run(async()=>{await rpc('cancel',button.dataset.cancel);await refresh();status('Reserva cancelada. Las piezas se liberaron.');});};
try{await requireSecureAdmin(supabase);await refresh();$('access').textContent='';$('app').hidden=false;buttons();}catch{$('access').textContent='Inicia sesión con tu cuenta administradora y completa la verificación para continuar.';}
setInterval(()=>{if(!document.hidden&&!busy&&!$('app').hidden)run(refresh);},60000);
