import {supabase} from './supabase-client.js?v=20261007-inventory';
import {requireSecureAdmin} from './admin-security-guard.js?v=20261007-1';
import {validateIntegrity,integrityIssues} from './test-integrity-model.js?v=20261024-1';
const $=id=>document.getElementById(id),el=(tag,text)=>{const e=document.createElement(tag);e.textContent=text;return e;};
const money=n=>new Intl.NumberFormat('es-MX',{style:'currency',currency:'MXN'}).format(n/100);
const date=s=>new Date(s).toLocaleString('es-MX',{timeZone:'America/Mexico_City'});
let epoch=0,busy=false,observedOwner;
function clear(){ $('report').hidden=true;for(const id of ['checked','outcome','metrics','review-warning','legacy-warning','records'])$(id).replaceChildren(); }
function lock(){epoch++;clear();$('app').hidden=true;$('message').textContent='';$('login-help').hidden=false;$('access').textContent='Inicia sesión como administrador y completa el autenticador.';}
function draw(data){
 const t=data.totals;$('checked').textContent=`Consultado: ${date(data.checkedAt)} (Ciudad de México). Alcance: tus solicitudes de prueba.`;
 $('outcome').textContent=t.inconsistent?`${t.inconsistent} solicitudes con diferencias internas. Revisa los casos antes de continuar su preparación.`:t.requests?'No se detectaron diferencias entre los registros comprobados.':'Todavía no hay solicitudes de prueba en tu cuenta.';
 for(const [value,label] of [[t.requests,'Solicitudes'],[t.receipts,'Recibos registrados'],[t.orders,'Órdenes generadas'],[money(t.paidAmountCents),'Recibos con estado pagado'],[money(t.reviewAmountCents),'Importe en revisión'],[t.dispatched,'Salidas registradas'],[t.inconsistent,'Solicitudes con diferencias'],[t.unpaid,'Solicitudes sin recibo'],[t.transfersWithoutReceipt,'Transferencias sin recibo']]){
  const card=el('div','');card.className='metric';card.append(el('strong',String(value)),el('span',label));$('metrics').append(card);
 }
 $('review-warning').hidden=t.review===0;
 $('review-warning').textContent=`${t.review} pagos siguen en revisión; ${t.reviewNotes} tienen una nota registrada. La nota no resuelve el pago ni autoriza una entrega.`;
 $('legacy-warning').hidden=t.legacyEvidence===0;
 $('legacy-warning').textContent=`${t.legacyEvidence} recibos anteriores no tienen evento de auditoría. Sus registros se comparan, pero no se reconstruye evidencia histórica.`;
 $('limit-warning').hidden=!data.detailsLimited;
 const states={paid:'Recibo pagado',reconciliation_required:'Pago en revisión',awaiting_payment:'Sin recibo de pago'};
 const preparation={none:'Sin orden para preparar',pending:'Preparación pendiente',prepared:'Preparación registrada',dispatched:'Salida registrada'};
 for(const r of data.requests){
  const article=el('article',''),badge=el('span',r.issues.length?'Diferencia detectada':states[r.state]);badge.className='badge'+(r.issues.length?' difference':r.state==='reconciliation_required'?' attention':'');
  article.append(badge,el('h3',`${money(r.amountCents)} · ${r.method==='transfer'?'Transferencia simulada':r.method==='card'?'Tarjeta de prueba':'Método no registrado'}`),el('p',`Solicitud: ${r.requestId}`));
  if(r.receiptAt)article.append(el('p',`${states[r.state]}: ${money(r.receiptAmountCents)} · ${date(r.receiptAt)} (CDMX)`));
  article.append(el('p',r.orderId!==null?`Orden #${r.orderId} · ${preparation[r.preparation]}`:preparation[r.preparation]));
  if(r.state==='reconciliation_required')article.append(el('p',r.reviewed?'Nota registrada; el pago sigue en revisión.':'Pendiente de revisión administrativa.'));
  if(r.legacyEvidence)article.append(el('p','Registro anterior sin evento de auditoría.'));
  if(r.issues.length){const list=el('ul','');list.className='issues';for(const code of r.issues)list.append(el('li',integrityIssues[code]));article.append(list);}
  $('records').append(article);
 }
 $('report').hidden=false;
}
async function refresh(){
 if(busy)return;busy=true;const version=epoch;clear();$('refresh').disabled=true;$('message').textContent='Comprobando registros…';
 try{
  const session=await supabase.auth.getSession(),owner=session.data.session?.user.id;
  if(version!==epoch)return;if(session.error||!owner){lock();return;}
  const {data,error}=await supabase.rpc('qw10_test_integrity');
  if(version!==epoch)return;
  if(error){if(error.code==='42501'){lock();return;}throw Error();}
  const current=await supabase.auth.getSession();
  if(version!==epoch)return;if(current.error||current.data.session?.user.id!==owner){lock();return;}
  draw(validateIntegrity(data));$('message').textContent='';
 }catch{if(version===epoch){clear();$('message').textContent='No se pudo completar el control. Actualiza para volver a consultar; no se modificaron los registros.';}}
 finally{busy=false;$('refresh').disabled=false;}
}
$('refresh').addEventListener('click',refresh);
supabase.auth.onAuthStateChange((event,session)=>{
 const owner=session?.user?.id||null,changed=observedOwner!==undefined&&owner!==observedOwner;
 observedOwner=owner;
 // SIGNED_IN can reconfirm the same session while the guard runs or on refocus.
 // Identity changes and sign-out must still discard every in-flight result.
 if(!owner||changed||!['INITIAL_SESSION','SIGNED_IN','TOKEN_REFRESHED'].includes(event))lock();
});
try{const version=epoch;await requireSecureAdmin(supabase);if(version===epoch){$('access').textContent='';$('app').hidden=false;await refresh();}}catch{lock();}
