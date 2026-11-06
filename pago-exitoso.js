import {supabase} from './supabase-client.js?v=20260913-loyalty';
import {cardStatus} from './card-checkout-model.js?v=20261106';
const $=id=>document.getElementById(id),sessionId=new URLSearchParams(location.search).get('session_id');
let generation=0,owner=null,timer=null,checks=0,busy=false;
const valid=/^cs_live_[A-Za-z0-9_]{1,240}$/.test(sessionId||'');
const target=valid?'pago-exitoso.html?session_id='+sessionId:'checkout-tarjeta.html';
$('payment-login').href='login.html?next='+encodeURIComponent(target);
function paint(kind,title,message){
 $('card').className='card '+kind;$('icon').textContent=kind==='error'?'!':kind==='pending'?'…':'✓';
 $('title').textContent=title;$('message').textContent=message;$('continue').classList.remove('hidden');
}
function erase(){generation++;clearTimeout(timer);$('summary').classList.add('hidden');for(const id of ['order','amount','reference'])$(id).textContent='—';}
function login(){erase();$('payment-login').hidden=false;paint('pending','Verifica tu cuenta','Inicia sesión con la misma cuenta que utilizaste al comprar. Los administradores deben verificar también su acceso.');}
async function check(){
 if(busy)return;clearTimeout(timer);const attempt=++generation;busy=true;$('payment-refresh').disabled=true;
 try{
  const initial=await supabase.auth.getSession(),s=initial.data?.session;
  if(attempt!==generation)return;if(initial.error||!s){login();return;}owner=s.user.id;
  const {data,error}=await supabase.rpc('card_checkout_status',{p_session:sessionId});
  const current=await supabase.auth.getSession();
  if(attempt!==generation)return;
  if(current.error||current.data?.session?.user.id!==owner){login();return;}
  if(error){if(['42501','PGRST301'].includes(error.code)){login();return;}throw Error();}
  const value=cardStatus(data);$('payment-login').hidden=true;
  if(!value){erase();paint('error','No encontramos esta compra','La referencia no corresponde a una compra de esta cuenta. Comprueba que iniciaste sesión con la cuenta utilizada al pagar.');$('payment-login').hidden=false;return;}
  $('order').textContent=value.orderId?value.orderId.slice(0,8).toUpperCase():'Pendiente';
  $('amount').textContent=new Intl.NumberFormat('es-MX',{style:'currency',currency:'MXN'}).format(value.totalCents/100);
  $('reference').textContent=value.requestId;$('summary').classList.remove('hidden');
  if(value.state==='paid'){
   paint('','Pago confirmado','Gracias por tu compra. El pago y el pedido ya están registrados en RHO.');
   $('payment-refresh').hidden=true;
  }else if(value.state==='reconciliation_required'){
   paint('pending','Pago recibido; pedido en revisión','Recibimos el pago y necesitamos revisar tu pedido antes de surtirlo. Conserva esta referencia y no vuelvas a pagar.');
  }else if(value.state==='expired'){
   paint('pending','La reserva venció','Todavía no tenemos un pago confirmado para esta referencia. Si tu banco ya autorizó el cargo, no repitas el pago; conserva tu comprobante y vuelve a consultar el estado.');
  }else{
   paint('pending','Pago pendiente de confirmación','Esperamos la confirmación del pago. Si ya completaste la operación en Stripe, no vuelvas a pagar.');
   if(++checks<10)timer=setTimeout(check,3000);
  }
 }catch{if(attempt===generation){erase();paint('error','No pudimos consultar el pago','Revisa tu conexión y vuelve a consultar. Este mensaje no indica que el cobro haya fallado. Si ya pagaste, conserva tu comprobante.');}}
 finally{busy=false;$('payment-refresh').disabled=false;}
}
$('payment-refresh').addEventListener('click',()=>{checks=0;check();});
supabase.auth.onAuthStateChange((event,s)=>{if(event==='SIGNED_OUT'||(owner&&s?.user?.id!==owner)){owner=null;login();$('payment-refresh').hidden=false;}});
window.addEventListener('pagehide',()=>{erase();});
window.addEventListener('pageshow',event=>{if(event.persisted)location.reload();});
if(valid)check();else{paint('error','Referencia de compra no válida','Abre el enlace de confirmación de tu compra. No se ha consultado ni confirmado ningún pago.');$('payment-refresh').hidden=true;}
