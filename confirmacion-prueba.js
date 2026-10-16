import {supabase} from './supabase-client.js?v=20260913-loyalty';
const $=id=>document.getElementById(id);
const money=cents=>new Intl.NumberFormat('es-MX',{style:'currency',currency:'MXN'}).format(cents/100);
// The redirect is only a lookup key; it never establishes payment success.
const sessionId=new URL(location.href).searchParams.get('session_id');
const validAmount=x=>Number.isSafeInteger(x)&&x>=0;
async function refresh(){
 $('result-refresh').disabled=true;$('result-detail').hidden=true;
 $('result-title').textContent='Verificando pago de prueba';
 try{
  if(!/^cs_test_[A-Za-z0-9_]{1,250}$/.test(sessionId||'')) throw Error();
  const {data:{session},error}=await supabase.auth.getSession();if(error||!session) throw Error();
  const {data,error:failure}=await supabase.functions.invoke('test-order-status',{
   headers:{Authorization:`Bearer ${session.access_token}`},body:{environment:'test',sessionId}});
  if(failure||data?.environment!=='test') throw Error();
  const current=await supabase.auth.getSession();if(current.data.session?.user.id!==session.user.id) throw Error();
  if(data.state==='pending'){$('result-title').textContent='Pago de prueba sin confirmar';$('result-status').textContent='Aún no se ha confirmado el pago. Puedes consultar de nuevo.';return;}
  if(data.state==='reconciliation_required'){$('result-title').textContent='Prueba pendiente de revisión';$('result-status').textContent='El resultado requiere revisión. No se confirmó una orden.';return;}
  const q=data.quote;
  if(data.state!=='paid'||!/^\d+$/.test(data.orderId||'')||!q||q.currency!=='mxn'||!['standard','express'].includes(q.mode)||!Array.isArray(q.lines)||!q.lines.length||
    ![q.subtotalCents,q.shippingCents,q.totalCents].every(validAmount)||q.totalCents<=0||q.totalCents!==q.subtotalCents+q.shippingCents||
    q.lines.some(i=>typeof i.sku!=='string'||!/^[a-z0-9][a-z0-9-]{1,119}$/.test(i.sku)||typeof i.name!=='string'||!Number.isSafeInteger(i.quantity)||i.quantity<1||!validAmount(i.unitPriceCents)||i.lineTotalCents!==i.unitPriceCents*i.quantity)||
    q.lines.reduce((s,i)=>s+i.lineTotalCents,0)!==q.subtotalCents) throw Error();
  $('result-title').textContent='Pago de prueba aprobado';
  $('result-status').textContent='La orden se generó automáticamente al verificar el pago simulado.';
  $('result-order').textContent=`Orden de prueba #${data.orderId}`;
  $('result-items').replaceChildren(...q.lines.map(i=>{const li=document.createElement('li');li.textContent=`${i.quantity} × ${i.name} · ${money(i.lineTotalCents)}`;return li;}));
  $('result-shipping-label').textContent=q.mode==='express'?'Envío express simulado':'Envío estándar simulado';
  $('result-subtotal').textContent=money(q.subtotalCents);$('result-shipping').textContent=money(q.shippingCents);$('result-total').textContent=money(q.totalCents);
  $('result-preparation').replaceChildren(...q.lines.map(i=>{const li=document.createElement('li');li.textContent=`${i.name} · SKU: ${i.sku} · Cantidad: ${i.quantity}`;return li;}));
  $('result-detail').hidden=false;
 }catch{$('result-title').textContent='No se pudo verificar la prueba';$('result-status').textContent='Revisa tu sesión de administrador con autenticador y consulta de nuevo. Esta pantalla no confirma un pago.';}
 finally{$('result-refresh').disabled=false;}
}
$('result-refresh').addEventListener('click',refresh);
supabase.auth.onAuthStateChange((event)=>{
 if(event==='INITIAL_SESSION'||event==='TOKEN_REFRESHED') return;
 $('result-detail').hidden=true;$('result-title').textContent='Verificando sesión';
 // Defer session reads until the authentication callback releases its lock.
 setTimeout(refresh,0);
});
refresh();
