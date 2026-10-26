import {normalizeDeliveryAddress} from './supabase/functions/_shared/delivery-address.js';
export async function checkoutFingerprint(items,paymentMethod,delivery){
 const old={items,paymentMethod};if(!delivery?.deliveryMode)return JSON.stringify(old);
 const bytes=new TextEncoder().encode(JSON.stringify({...old,...delivery}));
 return 'address:'+Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',bytes)),b=>b.toString(16).padStart(2,'0')).join('');
}
export function checkoutAddress(supabase,onChange){
 const $=id=>document.getElementById(id),mode=$('test-delivery-mode'),form=$('test-address'),postal=$('test-postal'),select=$('test-settlement'),lookup=$('test-postal-lookup'),status=$('test-postal-status');
 let version=0,options=[],verifiedPostal='';
 function reset(){version++;options=[];verifiedPostal='';select.replaceChildren(new Option('Consulta primero tu código postal',''));select.disabled=true;status.textContent='';}
 function changed(){version++;onChange();}
 function read(){
  if(mode.value==='fixture')return {address:{postalCode:'02000'}};
  if(!form.reportValidity())throw Error('invalid_address');
  const option=options.find(r=>r.municipalityCode+':'+r.settlementCode===select.value);
  if(!option||postal.value!==verifiedPostal)throw Error('invalid_address');
  const address=normalizeDeliveryAddress({country:'MX',state:'CMX',postalCode:postal.value,municipalityCode:option.municipalityCode,settlementCode:option.settlementCode,
   street:$('test-street').value,exterior:$('test-exterior').value,interior:$('test-interior').value,reference:$('test-reference').value});
  if(!address)throw Error('invalid_address');return {deliveryMode:'catalog',address};
 }
 form.addEventListener('submit',e=>e.preventDefault());
 form.addEventListener('input',()=>{changed();});
 select.addEventListener('change',changed);
 postal.addEventListener('input',reset);
 mode.addEventListener('change',()=>{reset();onChange();form.hidden=mode.value!=='catalog';});
 lookup.addEventListener('click',async()=>{
  if(lookup.disabled)return;reset();onChange();const attempt=version,cp=postal.value;lookup.disabled=true;
  try{
   if(!/^\d{5}$/.test(cp)){status.textContent='Escribe un código postal de cinco dígitos.';return;}
   status.textContent='Consultando catálogo postal…';
   const first=await supabase.auth.getSession(),session=first.data.session;
   if(attempt!==version)return;
   if(first.error||!session){status.textContent='Verifica tu acceso de administrador con el autenticador.';return;}
   const {data,error}=await supabase.functions.invoke('create-test-checkout',{headers:{Authorization:'Bearer '+session.access_token},body:{environment:'test',action:'postal_lookup',postalCode:cp}});
   const current=await supabase.auth.getSession();if(attempt!==version)return;
   if(current.error||current.data.session?.user.id!==session.user.id){reset();return;}
   if(error){status.textContent=error.context?.status===401?'Verifica tu acceso de administrador con el autenticador.':'No se pudo consultar el catálogo. Reintenta sin cambiar tus datos.';return;}
   if(data?.environment!=='test'||data.postalCode!==cp||!Array.isArray(data.options)||data.options.length>500)throw Error();
   if(data.status==='outside_coverage'&&!data.options.length){status.textContent='Este código postal no está incluido en el catálogo de CDMX habilitado.';return;}
   if(data.status!=='postal_options'||!data.options.length||!/^[a-f0-9]{64}$/.test(data.catalogSha256||''))throw Error();
   const seen=new Set();for(const r of data.options){const key=r.municipalityCode+':'+r.settlementCode;
    if(r.postalCode!==cp||!/^\d{3}$/.test(r.municipalityCode)||!/^\d{4}$/.test(r.settlementCode)||typeof r.municipality!=='string'||typeof r.settlement!=='string'||!r.municipality.trim()||!r.settlement.trim()||seen.has(key))throw Error();seen.add(key);}
   options=data.options;verifiedPostal=cp;select.replaceChildren(new Option('Selecciona alcaldía y colonia',''),...options.map(r=>new Option(r.municipality+' · '+r.settlement,r.municipalityCode+':'+r.settlementCode)));select.disabled=false;
   status.textContent='Selecciona la colonia. El servidor comprobará nuevamente el domicilio al preparar la prueba.';
  }catch{if(attempt===version)status.textContent='No se pudo validar la respuesta del catálogo. Reintenta.';}
  finally{lookup.disabled=false;}
 });
 return {read,reset:()=>{reset();form.reset();},summary(data,request){
  if(!request.deliveryMode)return '';
  const d=data?.delivery,a=d?.address;
  if(d?.status!=='postal_match'||d.assurance!=='postal_catalog_only'||!/^[a-f0-9]{64}$/.test(d.catalogSha256||'')||!a||typeof a.municipality!=='string'||typeof a.settlement!=='string'||!a.municipality||!a.settlement)throw Error();
  for(const [k,v] of Object.entries(request.address))if(a[k]!==v)throw Error();
  return `Domicilio de prueba: ${a.street} ${a.exterior}${a.interior?' · Interior '+a.interior:''}, ${a.settlement}, ${a.municipality}, CP ${a.postalCode}. Coincidencia postal; sin entrega real.`;
 }};
}
