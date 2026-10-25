import {supabase} from './supabase-client.js?v=20260913-loyalty';
import {getCart} from './cart.js?v=20260914-account-isolation';
const button=document.getElementById('test-prepare');
const status=document.getElementById('test-status');
const link=document.getElementById('test-open');
const method=document.getElementById('test-method');
const help=document.getElementById('test-help');
const cardHelp=document.getElementById('test-card-help');
const restart=document.getElementById('test-restart');
let expiredRetry=null;
let revision=0;
function clearResult(){
 revision++;expiredRetry=null;restart.hidden=true;link.hidden=true;link.removeAttribute('href');help.hidden=true;status.textContent='';
}
function showProblem(kind){
 const problems={
  session:['Inicia sesión con tu cuenta de administrador en este navegador y completa la verificación del autenticador. Después vuelve aquí y reintenta.','Verificar acceso de administrador','admin-seguridad.html'],
  empty:['El carrito está vacío en este navegador. Agrega un artículo antes de preparar la prueba.','Ir al carrito','carrito.html'],
  conflict:['No se pudo confirmar la preparación. Revisa que los artículos estén habilitados y disponibles en el inventario de prueba y que la reserva siga vigente. Reintenta con los mismos datos para evitar duplicados.','Revisar carrito','carrito.html'],
  disabled:['El servicio de pruebas no está disponible en este momento. Intenta más tarde.'],
  invalid:['Los datos de esta prueba no son válidos. Revisa el carrito y utiliza una de las formas de pago disponibles.','Revisar carrito','carrito.html'],
  storage:['No se pudo conservar la referencia de reintento en este navegador. Permite el almacenamiento del sitio y vuelve a intentarlo.'],
  unknown:['No se pudo confirmar la preparación. Comprueba tu conexión y reintenta con los mismos datos para evitar duplicados.']
 };
 const [message,label,href]=problems[kind]||problems.unknown;
 status.textContent=message;
 help.hidden=!href;
 if(href){help.textContent=label;help.href=href;}else help.removeAttribute('href');
}
function updateMethod(){cardHelp.hidden=method.value!=='card';}
function fingerprint(){return JSON.stringify({items:getCart().map(i=>({sku:i.id,quantity:i.qty})),paymentMethod:method.value});}
restart.addEventListener('click',async()=>{
 if(restart.disabled||button.disabled||!expiredRetry)return;
 const expired=expiredRetry,attempt=revision;
 restart.disabled=true;button.disabled=true;
 try{
  const {data:{session},error}=await supabase.auth.getSession();
  if(attempt!==revision)return;
  if(error||session?.user.id!==expired.ownerId){clearResult();showProblem('session');return;}
  if(method.value!=='transfer'||fingerprint()!==expired.fingerprint){clearResult();return;}
  const storageKey=`rho-test-checkout:${expired.ownerId}`;
  const saved=JSON.parse(sessionStorage.getItem(storageKey));
  if(saved?.key!==expired.key||saved.fingerprint!==expired.fingerprint){clearResult();showProblem('unknown');return;}
  sessionStorage.removeItem(storageKey);
  clearResult();status.textContent='Ya puedes preparar una nueva transferencia simulada. Se volverán a comprobar los precios y las existencias de prueba.';
 }catch{if(attempt===revision){clearResult();showProblem('storage');}}
 finally{restart.disabled=false;button.disabled=false;}
});
method.addEventListener('change',()=>{clearResult();updateMethod();});
updateMethod();
function render(){
 document.getElementById('test-items').replaceChildren(...getCart().map(i=>{
  const li=document.createElement('li');li.textContent=`${i.qty} × ${i.name||i.id}`;return li;
 }));
}
render();window.addEventListener('rho-cart-changed',()=>{render();clearResult();});
supabase.auth.onAuthStateChange(event=>{
 if(!['INITIAL_SESSION','TOKEN_REFRESHED'].includes(event)){
  clearResult();if(event==='SIGNED_OUT')showProblem('session');
 }
});
button.addEventListener('click',async()=>{
 if(button.disabled)return;
 clearResult();const attempt=revision;
 button.disabled=true;status.textContent='Validando sesión, precios y stock de prueba…';
 try {
  const {data:{session},error}=await supabase.auth.getSession();
  if(attempt!==revision)return;
  if(error||!session){showProblem('session');return;}
  const items=getCart().map(i=>({sku:i.id,quantity:i.qty}));
  if(!items.length){showProblem('empty');return;}
  const paymentMethod=method.value;
  const fingerprint=JSON.stringify({items,paymentMethod});
  const storageKey=`rho-test-checkout:${session.user.id}`;
  let retry;try{retry=JSON.parse(sessionStorage.getItem(storageKey));}catch{}
  if(retry?.fingerprint!==fingerprint || typeof retry.key!=='string' || !retry.key) {
   retry={fingerprint,key:crypto.randomUUID()};
   try{sessionStorage.setItem(storageKey,JSON.stringify(retry));}
   catch{showProblem('storage');return;}
  }
  const {data,error:failure}=await supabase.functions.invoke('create-test-checkout',{
   headers:{Authorization:`Bearer ${session.access_token}`},
   body:{environment:'test',paymentMethod,retryKey:retry.key,items,address:{postalCode:'02000'}}
  });
  if(attempt!==revision)return;
  if(failure){
   if(failure.context?.status===410 && paymentMethod==='transfer'){
    let details;try{details=await failure.context.clone().json();}catch{}
    if(attempt!==revision)return;
    const current=await supabase.auth.getSession();
    if(attempt!==revision)return;
    if(current.error||current.data.session?.user.id!==session.user.id){clearResult();showProblem('session');return;}
    if(details?.error==='test_transfer_expired'){
     expiredRetry={ownerId:session.user.id,key:retry.key,fingerprint};restart.hidden=false;
     status.textContent='La reserva de esta transferencia simulada venció sin registrar un pago. Puedes iniciar una nueva prueba; la referencia anterior se conserva en el historial.';
     return;
    }
   }
   const kinds={401:'session',409:'conflict',503:'disabled',400:'invalid'};
   showProblem(kinds[failure.context?.status]||'unknown');return;
  }
  const current=await supabase.auth.getSession();
  if(attempt!==revision)return;
  if(current.data.session?.user.id!==session.user.id){clearResult();showProblem('session');return;}
  if(JSON.stringify({items:getCart().map(i=>({sku:i.id,quantity:i.qty})),paymentMethod:method.value})!==fingerprint){clearResult();return;}
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
 }catch {if(attempt===revision)showProblem('unknown');}
 finally{button.disabled=false;}
});
