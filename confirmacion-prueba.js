import {supabase} from './supabase-client.js?v=20260913-loyalty';
import {deliverySnapshotText} from './delivery-snapshot.js?v=20261025-fulfillment';
const $=id=>document.getElementById(id);
const money=cents=>new Intl.NumberFormat('es-MX',{style:'currency',currency:'MXN'}).format(cents/100);
// The redirect is only a lookup key; it never establishes payment success.
const sessionId=new URL(location.href).searchParams.get('session_id');
const validAmount=x=>Number.isSafeInteger(x)&&x>=0;
let operationBusy=false;
let operationOwner=null;
let epoch=0,observedOwner;
function disableOperations(){ $('prepare-test').disabled=true;$('dispatch-test').disabled=true;operationOwner=null; }
function clearDetail(){
 $('result-detail').hidden=true;
 for(const id of ['result-order','result-items','result-preparation','result-delivery','result-subtotal','result-shipping','result-total'])$(id).replaceChildren();
}
async function refresh(){
 const version=++epoch;
 disableOperations();$('session-help').hidden=true;
 $('result-refresh').disabled=true;clearDetail();
 $('result-title').textContent='Verificando pago de prueba';
 try{
  if(!/^cs_test_[A-Za-z0-9_]{1,250}$/.test(sessionId||'')) throw Error();
  const {data:{session},error}=await supabase.auth.getSession();if(version!==epoch)return;if(error||!session) throw Error('session_required');
  const {data,error:failure}=await supabase.functions.invoke('test-order-status',{
   headers:{Authorization:`Bearer ${session.access_token}`},body:{environment:'test',sessionId}});
  if(version!==epoch)return;
  if(failure){if(failure.context?.status===401)throw Error('session_required');if(failure.context?.status===404)throw Error('order_not_found');throw Error('query_failed');}
  if(data?.environment!=='test') throw Error();
  const current=await supabase.auth.getSession();if(version!==epoch)return;if(current.error||current.data.session?.user.id!==session.user.id) throw Error();
  if(data.state==='pending'){$('result-title').textContent='Pago de prueba sin confirmar';$('result-status').textContent='Aún no se ha confirmado el pago. Puedes consultar de nuevo.';return;}
  if(data.state==='reconciliation_required'){$('result-title').textContent='Prueba pendiente de revisión';$('result-status').textContent='El resultado requiere revisión. No se confirmó una orden.';return;}
  const q=data.quote;
  if(data.state!=='paid'||!/^\d+$/.test(data.orderId||'')||!q||q.currency!=='mxn'||!['standard','express'].includes(q.mode)||!Array.isArray(q.lines)||!q.lines.length||
    ![q.subtotalCents,q.shippingCents,q.totalCents].every(validAmount)||q.totalCents<=0||q.totalCents!==q.subtotalCents+q.shippingCents||
    q.lines.some(i=>typeof i.sku!=='string'||!/^[a-z0-9][a-z0-9-]{1,119}$/.test(i.sku)||typeof i.name!=='string'||!Number.isSafeInteger(i.quantity)||i.quantity<1||!validAmount(i.unitPriceCents)||i.lineTotalCents!==i.unitPriceCents*i.quantity)||
    q.lines.reduce((s,i)=>s+i.lineTotalCents,0)!==q.subtotalCents) throw Error();
  const delivery=deliverySnapshotText(q.delivery);
  $('result-title').textContent='Pago de prueba aprobado';
  $('result-status').textContent='La orden se generó automáticamente al verificar el pago simulado.';
  $('result-order').textContent=`Orden de prueba #${data.orderId}`;
  $('result-items').replaceChildren(...q.lines.map(i=>{const li=document.createElement('li');li.textContent=`${i.quantity} × ${i.name} · ${money(i.lineTotalCents)}`;return li;}));
  $('result-shipping-label').textContent=q.mode==='express'?'Envío express simulado':'Envío estándar simulado';
  $('result-subtotal').textContent=money(q.subtotalCents);$('result-shipping').textContent=money(q.shippingCents);$('result-total').textContent=money(q.totalCents);
  $('result-preparation').replaceChildren(...q.lines.map(i=>{const li=document.createElement('li');li.textContent=`${i.name} · SKU: ${i.sku} · Cantidad: ${i.quantity}`;return li;}));
  $('result-delivery').textContent=delivery;
  const stage=data.preparation?.state;
  if(!['pending','prepared','dispatched'].includes(stage)){
   $('preparation-status').textContent='Preparación de prueba aún no disponible';
  }else{
   operationOwner=session.user.id;
   $('preparation-status').textContent=({pending:'Preparación pendiente · prueba',prepared:'Pedido preparado · prueba',dispatched:'Salida registrada · prueba'})[stage];
   $('prepare-test').disabled=operationBusy||stage!=='pending';
   $('dispatch-test').disabled=operationBusy||stage!=='prepared';
  }
  $('result-detail').hidden=false;
 }catch(error){
  if(version!==epoch)return;
  const needsSession=error.message==='session_required';
  $('result-title').textContent=needsSession?'Verifica tu sesión de administrador':'No se pudo verificar la prueba';
  $('result-status').textContent=needsSession?'Inicia sesión y completa el autenticador en este mismo navegador. Después regresa a esta pestaña y pulsa Consultar de nuevo.':error.message==='order_not_found'?'Esta orden de prueba no está disponible para la cuenta actual.':'La consulta no se completó. Pulsa Consultar de nuevo. Esta pantalla no confirma un pago.';
  $('session-help').hidden=!needsSession;
 }
 finally{if(version===epoch)$('result-refresh').disabled=false;}
}
async function recordOperation(action){
 if(operationBusy||!operationOwner)return;
 const owner=operationOwner,version=epoch;operationBusy=true;disableOperations();$('result-refresh').disabled=true;
 try{
  const {data:{session},error}=await supabase.auth.getSession();if(version!==epoch||error||session?.user.id!==owner)throw Error();
  const {data,error:failure}=await supabase.functions.invoke('test-order-preparation',{headers:{Authorization:`Bearer ${session.access_token}`},body:{environment:'test',sessionId,action}});
  const current=await supabase.auth.getSession();if(failure||data?.environment!=='test'||current.data.session?.user.id!==owner)throw Error();
 }catch{
  // A lost response may follow a committed action. Re-read before allowing retry.
 }finally{operationBusy=false;if(version===epoch)await refresh();}
}
$('prepare-test').addEventListener('click',()=>{if(!$('prepare-test').disabled)recordOperation('prepare');});
$('dispatch-test').addEventListener('click',()=>{if(!$('dispatch-test').disabled)recordOperation('dispatch');});
$('result-refresh').addEventListener('click',()=>{if(!operationBusy)refresh();});
supabase.auth.onAuthStateChange((event,session)=>{
 const owner=session?.user?.id??null,changed=observedOwner!==undefined&&owner!==observedOwner;observedOwner=owner;
 if(!changed&&['INITIAL_SESSION','SIGNED_IN','TOKEN_REFRESHED'].includes(event))return;
 epoch++;disableOperations();clearDetail();$('result-title').textContent='Verificando sesión';$('result-status').textContent='';
 // Defer session reads until the authentication callback releases its lock.
 setTimeout(refresh,0);
});
refresh();
