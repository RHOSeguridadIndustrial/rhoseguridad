import {supabase} from './supabase-client.js?v=20260913-loyalty';
import {requireSecureAdmin} from './admin-security-guard.js?v=20261007-1';
import {validateReceipt,transferError} from './transfer-persistence.js?v=20261101';
import {deliveryText} from './transfer-request-model.js?v=20261031-postal';
const admin=document.body.dataset.admin==='true',list=document.getElementById('requests'),status=document.getElementById('status'),refresh=document.getElementById('refresh');
let epoch=0,owner=null,busy=false;
const node=(tag,text)=>{const element=document.createElement(tag);element.textContent=text;return element;};
const money=cents=>new Intl.NumberFormat('es-MX',{style:'currency',currency:'MXN'}).format(cents/100);
function clear(){epoch++;list.replaceChildren();status.textContent='Inicia sesión para consultar tus solicitudes.';document.getElementById('login-help').hidden=false;}
async function load(){
 if(busy)return;busy=true;refresh.disabled=true;const attempt=++epoch;list.replaceChildren();status.textContent='Consultando solicitudes…';
 try{
  const {data:identity,error:authError}=await supabase.auth.getUser();if(authError||!identity?.user)throw Error('transfer_auth_required');
  const user=identity.user.id;
  if(admin) {const {data:allowed,error}=await supabase.rpc('admin_session_touch');if(error||!allowed)throw Error('transfer_auth_required');}
  const {data,error}=await supabase.rpc('list_transfer_requests',{p_admin:admin});if(error)throw error;
  const {data:session}=await supabase.auth.getSession();if(attempt!==epoch||session.session?.user?.id!==user)return;
  if(!Array.isArray(data?.requests))throw Error('invalid_receipt');
  const receipts=data.requests.map(validateReceipt);
  for(const receipt of receipts){
   const card=node('article','');card.className='panel';
   card.append(node('h2',receipt.reference),node('p','Pendiente de revisión · Pago sin confirmar'),node('p',new Date(receipt.created_at).toLocaleString('es-MX',{timeZone:'America/Mexico_City'})+' (CDMX)'));
   const items=node('ul','');for(const item of receipt.items)items.append(node('li',`${item.quantity} × ${item.name} · ${money(item.amount_cents)}`));card.append(items);
   card.append(node('p',`Productos · IVA incluido: ${money(receipt.products_cents)}. Envío y total final por confirmar.`));
   const c=receipt.contact;card.append(node('p',`${c.name} · ${c.phone}${c.email?' · '+c.email:''}${c.company?' · '+c.company:''}`));
   card.append(node('p',deliveryText(c)),node('p',c.invoice?'Requiere factura':'Sin factura solicitada'));
   if(c.notes)card.append(node('p','Referencias: '+c.notes));
   card.append(node('p','La solicitud no reserva mercancía, confirma un pago ni programa una entrega.'));list.append(card);
  }
  status.textContent=receipts.length?`${receipts.length} solicitudes recientes (máximo 50).`:'Todavía no hay solicitudes registradas.';document.getElementById('login-help').hidden=true;
 }catch(error){if(attempt===epoch){list.replaceChildren();status.textContent=transferError(error);document.getElementById('login-help').hidden=false;}}
 finally{busy=false;refresh.disabled=false;}
}
supabase.auth.onAuthStateChange((event,session)=>{const next=session?.user?.id||null;if(event==='SIGNED_OUT'||(owner!==null&&next!==owner))clear();owner=next;});
refresh.addEventListener('click',load);
window.addEventListener('pageshow',event=>{if(event.persisted){clear();load();}});
document.addEventListener('visibilitychange',()=>{if(document.visibilityState==='hidden')clear();else load();});
try{if(admin)await requireSecureAdmin(supabase);await load();}catch{clear();}
