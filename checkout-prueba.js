import {supabase} from './supabase-client.js?v=20260913-loyalty';
import {getCart} from './cart.js?v=20260914-account-isolation';
const button=document.getElementById('test-prepare');
const status=document.getElementById('test-status');
const link=document.getElementById('test-open');
const method=document.getElementById('test-method');
method.addEventListener('change',()=>{link.hidden=true;status.textContent='';});
function render(){
 document.getElementById('test-items').replaceChildren(...getCart().map(i=>{
  const li=document.createElement('li');li.textContent=`${i.qty} × ${i.name||i.id}`;return li;
 }));
}
render();window.addEventListener('rho-cart-changed',()=>{render();link.hidden=true;});
button.addEventListener('click',async()=>{
 button.disabled=true;link.hidden=true;status.textContent='Validando sesión, precios y stock de prueba…';
 try {
  const {data:{session},error}=await supabase.auth.getSession();
  if(error||!session) throw Error();
  const items=getCart().map(i=>({sku:i.id,quantity:i.qty}));
  if(!items.length) {status.textContent='Agrega artículos al carrito para hacer la prueba.';return;}
  const paymentMethod=method.value;
  const fingerprint=JSON.stringify({items,paymentMethod});
  const storageKey=`rho-test-checkout:${session.user.id}`;
  let retry;try{retry=JSON.parse(sessionStorage.getItem(storageKey));}catch{}
  if(retry?.fingerprint!==fingerprint) {
   retry={fingerprint,key:crypto.randomUUID()};sessionStorage.setItem(storageKey,JSON.stringify(retry));
  }
  const {data,error:failure}=await supabase.functions.invoke('create-test-checkout',{
   headers:{Authorization:`Bearer ${session.access_token}`},
   body:{environment:'test',paymentMethod,retryKey:retry.key,items,address:{postalCode:'02000'}}
  });
  if(failure) throw failure;
  const current=await supabase.auth.getSession();
  if(current.data.session?.user.id!==session.user.id || JSON.stringify({items:getCart().map(i=>({sku:i.id,quantity:i.qty})),paymentMethod:method.value})!==fingerprint)
   throw Error();
  if(data.environment!=='test'||!Number.isSafeInteger(data.totalCents)||data.totalCents<=0) throw Error();
  const total=new Intl.NumberFormat('es-MX',{style:'currency',currency:'MXN'}).format(data.totalCents/100);
  const benefit=data.coupon?.applied ? ' Cupón de envío gratis incluido.' : '';
  if(paymentMethod==='transfer') {
   if(data.paymentMethod!=='transfer'||data.status!=='awaiting_test_transfer'||!/^TEST-[a-zA-Z0-9_-]{1,100}$/.test(data.reference||''))throw Error();
   status.textContent=`Transferencia simulada preparada: ${total}.${benefit} Referencia de prueba: ${data.reference}. No transfieras dinero: no se ha registrado ningún pago ni entrega.`;
   return;
  }
  const url=new URL(data.url);
  if(data.environment!=='test'||!/^cs_test_[A-Za-z0-9_]+$/.test(data.sessionId||'')||
    url.origin!=='https://checkout.stripe.com'||url.username||url.password||url.pathname!==`/c/pay/${data.sessionId}`||
    !Number.isSafeInteger(data.totalCents)||data.totalCents<=0) throw Error();
  status.textContent=`Importe simulado, con envío: ${new Intl.NumberFormat('es-MX',{style:'currency',currency:'MXN'}).format(data.totalCents/100)}.${benefit} No se ha realizado ningún pago.`;
  link.href=data.url;link.hidden=false;
 }catch {status.textContent='No se preparó el pago. Verifica tu sesión de administrador con autenticador, los SKU del carrito y las existencias de prueba.';}
 finally{button.disabled=false;}
});
