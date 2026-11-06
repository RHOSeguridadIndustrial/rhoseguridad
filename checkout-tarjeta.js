import {supabase} from './supabase-client.js?v=20260913-loyalty';
import {getCart} from './cart.js?v=20260914-account-isolation';
import {cardInput,cardFingerprint,cardSummary,cardDelivery,cardLink} from './card-checkout-model.js?v=20261106';
const $=id=>document.getElementById(id),form=$('card-form');
const money=cents=>new Intl.NumberFormat('es-MX',{style:'currency',currency:'MXN'}).format(cents/100);
let revision=0,owner=null,busy=false,options=[],postal='',prepared=null;
const selection=()=>getCart().map(i=>({sku:i.id,quantity:i.qty}));
const storageKey=id=>'rho-card-checkout:'+id;
function readStore(id){
 const text=sessionStorage.getItem(storageKey(id));if(!text)return {active:null,attempts:{}};
 const value=JSON.parse(text);
 if(!value||typeof value.attempts!=='object'||!value.attempts||Array.isArray(value.attempts))throw Error('storage');
 return value;
}
function saveStore(id,value){sessionStorage.setItem(storageKey(id),JSON.stringify(value));}
async function hash(value){return [...new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(value)))].map(b=>b.toString(16).padStart(2,'0')).join('');}
function message(text){$('card-status').textContent=text;}
function invalidate(text=''){
 revision++;prepared=null;$('card-summary').hidden=true;$('card-accept').checked=false;
 $('card-pay').disabled=true;$('card-open').hidden=true;$('card-open').removeAttribute('href');
 $('card-check').hidden=true;$('card-check').removeAttribute('href');message(text);
}
function controls(value){busy=value;for(const id of ['card-review','card-lookup'])$(id).disabled=value;$('card-pay').disabled=value||!prepared||!$('card-accept').checked;}
function renderItems(){
 $('card-items').replaceChildren(...getCart().map(i=>{const li=document.createElement('li');li.textContent=`${i.qty} × ${i.name||i.id}`;return li;}));
}
function resetPostal(){options=[];postal='';$('card-settlement').replaceChildren(new Option('Consulta tu código postal',''));$('card-settlement').disabled=true;$('card-postal-status').textContent='';}
function readInput(){
 if(!form.reportValidity())throw Error('form');
 const option=options.find(r=>r.municipalityCode+':'+r.settlementCode===$('card-settlement').value);
 if(!option||postal!==$('card-postal').value)throw Error('form');
 return cardInput({items:selection(),contact:{name:$('card-name').value,phone:$('card-phone').value},
  address:{country:'MX',state:'CMX',postalCode:postal,municipalityCode:option.municipalityCode,settlementCode:option.settlementCode,
   street:$('card-street').value,exterior:$('card-exterior').value,interior:$('card-interior').value,reference:$('card-reference').value}});
}
async function session(){
 const {data,error}=await supabase.auth.getSession();if(error||!data?.session)throw Error('session');return data.session;
}
async function sameOwner(id,attempt){const s=await session();return revision===attempt&&s.user.id===id;}
async function invoke(body,s){
 const {data,error}=await supabase.functions.invoke('create-card-checkout',{headers:{Authorization:'Bearer '+s.access_token},body:{environment:'live',...body}});
 if(error){const problem=Error('service');problem.status=error.context?.status;throw problem;}return data;
}
function problem(error){
 const needsLogin=error.message==='session'||error.status===401;$('card-login').hidden=!needsLogin;
 message(needsLogin?'Inicia sesión con tu cuenta RHO. Si eres administrador, verifica también tu acceso.':
  error.status===503?'El pago con tarjeta aún no está disponible. Puedes regresar al carrito y continuar con transferencia.':
  error.status===422?'Revisa el código postal, la colonia y los datos del domicilio.':
  error.status===409?'No pudimos preparar el pago. Las existencias o la vigencia pudieron cambiar. Conserva la referencia de esta compra; si ya pagaste, consulta su estado antes de intentarlo de nuevo.':
  error.message==='storage'?'Permite el almacenamiento de este sitio para conservar la referencia de la compra antes de continuar.':
  'No pudimos confirmar la operación. Revisa tu conexión y reintenta con los mismos datos; conservaremos la referencia de esta compra.');
}
function show(value){
 const q=cardSummary(value.quote,value.input.items),delivery=cardDelivery(q,value.input.address);
 prepared=value;$('card-items').hidden=true;
 $('card-lines').replaceChildren(...q.lines.map(line=>{
  const li=document.createElement('li'),small=document.createElement('small');
  li.textContent=`${line.quantity} × ${line.name}`;small.textContent=`${money(line.unitPriceCents)} por unidad · ${money(line.lineTotalCents)}`;li.append(small);return li;
 }));
 $('card-subtotal').textContent=money(q.subtotalCents);$('card-shipping').textContent=money(q.shippingCents);
 $('card-shipping-label').textContent='Envío '+(q.mode==='express'?'exprés':'estándar');$('card-total').textContent=money(q.totalCents);
 $('card-contact').textContent=`Recibe: ${value.input.contact.name} · ${value.input.contact.phone}`;
 $('card-delivery').textContent=delivery;$('card-summary').hidden=false;
 $('card-validity').textContent=value.retry?'Se conserva la referencia de tu intento anterior. Al continuar se verificará su vigencia.':'Verificaremos nuevamente precios y existencias al continuar al pago.';
 if(value.data?.sessionId&&/^cs_live_[A-Za-z0-9_]{1,240}$/.test(value.data.sessionId)){
  $('card-check').href='pago-exitoso.html?session_id='+value.data.sessionId;$('card-check').hidden=false;
 }
}
form.addEventListener('input',()=>{invalidate('Los datos cambiaron. Revisa nuevamente el resumen.');});
form.addEventListener('change',()=>{invalidate('Los datos cambiaron. Revisa nuevamente el resumen.');});
$('card-postal').addEventListener('input',resetPostal);
$('card-lookup').addEventListener('click',async()=>{
 if(busy)return;invalidate();resetPostal();const attempt=revision,cp=$('card-postal').value;
 if(!/^\d{5}$/.test(cp)){$('card-postal-status').textContent='Escribe un código postal de cinco dígitos.';return;}
 controls(true);$('card-postal-status').textContent='Consultando colonias…';
 try{
  const s=await session(),data=await invoke({action:'postal_lookup',postalCode:cp},s);
  if(!await sameOwner(s.user.id,attempt))return;
  if(data?.postalCode!==cp||!Array.isArray(data.options)||data.options.length>500)throw Error();
  if(data.status==='outside_coverage'&&!data.options.length){$('card-postal-status').textContent='Este código postal no está habilitado para entrega con tarjeta.';return;}
  if(data.status!=='postal_options'||!data.options.length||!/^[a-f0-9]{64}$/.test(data.catalogSha256||''))throw Error();
  const seen=new Set();for(const r of data.options){const key=r.municipalityCode+':'+r.settlementCode;
   if(r.postalCode!==cp||!/^\d{3}$/.test(r.municipalityCode)||!/^\d{4}$/.test(r.settlementCode)||typeof r.municipality!=='string'||!r.municipality.trim()||typeof r.settlement!=='string'||!r.settlement.trim()||seen.has(key))throw Error();seen.add(key);
  }
  options=data.options;postal=cp;$('card-settlement').replaceChildren(new Option('Selecciona alcaldía y colonia',''),...options.map(r=>new Option(r.municipality+' · '+r.settlement,r.municipalityCode+':'+r.settlementCode)));
  $('card-settlement').disabled=false;$('card-postal-status').textContent='Selecciona tu colonia.';
 }catch(error){if(attempt===revision){$('card-postal-status').textContent='No se pudo completar la consulta.';problem(error);}}
 finally{controls(false);}
});
form.addEventListener('submit',async event=>{
 event.preventDefault();if(busy)return;invalidate();const attempt=revision;controls(true);
 try{
  const s=await session();if(attempt!==revision)return;
  if(!selection().length){message('Tu carrito está vacío. Agrega productos antes de continuar.');return;}
  let input;try{input=readInput();}catch{message('Completa el nombre, teléfono, código postal y domicilio de entrega.');return;}
  const fingerprint=cardFingerprint(input),key=await hash(fingerprint);let store;
  try{store=readStore(s.user.id);}catch{throw Error('storage');}
  const saved=store.attempts[key];
  if(saved&&cardFingerprint(saved.input)!==fingerprint)throw Error('storage');
  const quote=saved?saved.quote:await invoke({action:'quote',...input},s);
  if(!await sameOwner(s.user.id,attempt)||cardFingerprint(readInput())!==fingerprint)return;
  show({input,quote,owner:s.user.id,fingerprint,hash:key,retry:saved?.key,data:saved?.data});
  message(saved?'Recuperamos tu compra anterior. Revisa sus datos antes de continuar.':'Revisa el desglose y confirma los datos para continuar.');
 }catch(error){if(attempt===revision)problem(error);}finally{controls(false);}
});
$('card-accept').addEventListener('change',()=>{$('card-pay').disabled=busy||!prepared||!$('card-accept').checked;});
$('card-pay').addEventListener('click',async()=>{
 if(busy||!prepared||!$('card-accept').checked)return;
 const value=prepared,attempt=revision;controls(true);message('Preparando tu pago seguro…');
 try{
  const s=await session();if(s.user.id!==value.owner)throw Error('session');
  if(attempt!==revision||cardFingerprint(readInput())!==value.fingerprint)return;
  let store,saved;
  try{
   store=readStore(value.owner);saved=store.attempts[value.hash];
   if(saved&&(cardFingerprint(saved.input)!==value.fingerprint||saved.quote.totalCents!==value.quote.totalCents||!/^[a-zA-Z0-9_-]{16,100}$/.test(saved.key||'')))throw Error();
   if(!saved)saved={key:crypto.randomUUID(),input:value.input,quote:value.quote};
   store.attempts[value.hash]=saved;store.active=value.hash;saveStore(value.owner,store);
  }catch{throw Error('storage');}
  const data=await invoke({action:'create',...saved.input,retryKey:saved.key,expectedTotalCents:saved.quote.totalCents},s);
  if(!await sameOwner(value.owner,attempt)||cardFingerprint(readInput())!==value.fingerprint)return;
  const url=cardLink(data,{items:value.input.items,totalCents:value.quote.totalCents});
  try{saved.data={sessionId:data.sessionId,requestId:data.requestId};store.attempts[value.hash]=saved;saveStore(value.owner,store);}catch{throw Error('storage');}
  $('card-open').href=url;$('card-open').hidden=false;
  $('card-check').href='pago-exitoso.html?session_id='+data.sessionId;$('card-check').hidden=false;
  $('card-validity').textContent='Pago disponible hasta '+new Intl.DateTimeFormat('es-MX',{timeZone:'America/Mexico_City',dateStyle:'short',timeStyle:'short'}).format(new Date(data.expiresAt*1000))+' (hora de CDMX).';
  message('Tu compra está lista. Abre Stripe para completar el pago. Aún no se ha confirmado un cobro.');
 }catch(error){if(attempt===revision)problem(error);}finally{controls(false);}
});
async function start(){
 renderItems();const attempt=revision;
 try{
  const s=await session();if(attempt!==revision)return;owner=s.user.id;$('card-login').hidden=true;
  let store;try{store=readStore(owner);}catch{throw Error('storage');}
  const saved=store.attempts[store.active];
  if(saved){
   const input=cardInput(saved.input);cardSummary(saved.quote,input.items);cardDelivery(saved.quote,input.address);
   if(JSON.stringify(input.items)===JSON.stringify(cardInput({...input,items:selection()}).items)){
    const a=input.address,d=saved.quote.delivery.address;
    for(const [id,value] of Object.entries({'card-name':input.contact.name,'card-phone':input.contact.phone,'card-postal':a.postalCode,'card-street':a.street,'card-exterior':a.exterior,'card-interior':a.interior,'card-reference':a.reference}))$(id).value=value;
    postal=a.postalCode;options=[d];$('card-settlement').replaceChildren(new Option(d.municipality+' · '+d.settlement,a.municipalityCode+':'+a.settlementCode));$('card-settlement').disabled=false;
    show({input,quote:saved.quote,owner,fingerprint:cardFingerprint(input),hash:store.active,retry:saved.key,data:saved.data});
    message('Recuperamos tu intento anterior. Revisa los datos o consulta el estado si ya pagaste.');return;
   }
  }
  message(selection().length?'Completa tus datos para consultar el total.':'Tu carrito está vacío. Agrega productos antes de continuar.');
 }catch(error){if(attempt===revision)problem(error);}
}
supabase.auth.onAuthStateChange((event,s)=>{
 if((owner!==null&&s?.user?.id!==owner)||event==='SIGNED_OUT'){
  invalidate('La sesión cambió. Inicia sesión para continuar.');form.reset();resetPostal();$('card-lines').replaceChildren();$('card-contact').textContent='';$('card-delivery').textContent='';owner=null;$('card-login').hidden=false;renderItems();
 }
});
window.addEventListener('rho-cart-changed',()=>{invalidate('El carrito cambió. Revisa nuevamente tu compra.');$('card-items').hidden=false;renderItems();});
window.addEventListener('pageshow',event=>{if(event.persisted)location.reload();});
start();
