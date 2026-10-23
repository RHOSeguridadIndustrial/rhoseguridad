import {supabase} from './supabase-client.js?v=20261007-inventory';
import {requireSecureAdmin} from './admin-security-guard.js?v=20261007-1';
import {validateReviewCases,reviewReasons} from './test-review-model.js?v=20261023-1';
const $=id=>document.getElementById(id);
const money=v=>new Intl.NumberFormat('es-MX',{style:'currency',currency:'MXN'}).format(v/100);
const date=v=>new Date(v).toLocaleString('es-MX',{timeZone:'America/Mexico_City'});
let busy=false,epoch=0;
const element=(tag,text)=>{const e=document.createElement(tag);e.textContent=text;return e;};
function lock(){epoch++;$('cases').replaceChildren();$('app').hidden=true;$('login-help').hidden=false;$('access').textContent='Inicia sesión como administrador y completa el autenticador para consultar estos casos.';}
async function call(action,request=null,note=null){
 const {data,error}=await supabase.rpc('qw10_test_review',{p_action:action,p_request:request,p_note:note});
 if(error)throw error;return data;
}
async function sameOwner(owner,version){const {data,error}=await supabase.auth.getSession();if(error||version!==epoch||data.session?.user.id!==owner)throw Error('session_changed');}
function draw(cases){
 $('summary').textContent=`${cases.filter(c=>!c.reviewed).length} pendientes · ${cases.length} casos recientes`;
 if(!cases.length){$('cases').replaceChildren(element('p','No hay pagos de prueba pendientes de revisión.'));return;}
 $('cases').replaceChildren(...cases.map(c=>{
  const article=document.createElement('article'),badge=element('span',c.reviewed?'Revisión registrada':'Revisión pendiente');badge.className='badge'+(c.reviewed?' reviewed':'');
  article.append(badge,element('h2',`${money(c.amount_cents)} · Pago simulado`),element('p',reviewReasons[c.reason]),element('small',`Registrado: ${date(c.recorded_at)} (CDMX)`),element('p',`Referencia: ${c.request_id}`));
  const items=document.createElement('ul');for(const i of c.items)items.append(element('li',`${i.quantity} × ${i.sku}`));article.append(items);
  if(c.reviewed){article.append(element('p',c.note),element('small',`Revisado: ${date(c.reviewed_at)} (CDMX)`));return article;}
  const form=document.createElement('form'),label=element('label','Nota de revisión'),note=document.createElement('textarea'),save=element('button','Registrar revisión');
  note.id=`note-${c.request_id}`;label.htmlFor=note.id;note.required=true;note.minLength=12;note.maxLength=500;note.placeholder='Documenta qué se revisó en esta prueba.';save.type='submit';form.append(label,note,save);article.append(form);
  form.addEventListener('submit',e=>{e.preventDefault();if(note.value.trim().length<12){note.setCustomValidity('Escribe al menos 12 caracteres.');note.reportValidity();return;}run(async(owner,version)=>{
   const result=await call('review',c.request_id,note.value.trim());await sameOwner(owner,version);
   if(result?.environment!=='test'||result.status!=='reviewed'||result.requestId!==c.request_id)throw Error();
   await refresh(owner,version);$('message').textContent='Revisión registrada. La orden y el inventario no cambiaron.';
  });});note.addEventListener('input',()=>note.setCustomValidity(''));return article;
 }));
}
async function refresh(owner,version){const data=await call('list');await sameOwner(owner,version);draw(validateReviewCases(data));}
async function run(work){
 if(busy)return;busy=true;const version=epoch;$('message').textContent='';for(const b of document.querySelectorAll('button'))b.disabled=true;
 try{const {data,error}=await supabase.auth.getSession();if(error||!data.session)throw Error('session_changed');await work(data.session.user.id,version);}
 catch(error){if(error.code==='42501'||error.message==='session_changed')lock();else $('message').textContent='No se completó la operación. Actualiza los casos antes de volver a intentarlo.';}
 finally{busy=false;for(const b of document.querySelectorAll('button'))b.disabled=false;}
}
$('refresh').addEventListener('click',()=>run(refresh));
supabase.auth.onAuthStateChange(event=>{if(!['INITIAL_SESSION','TOKEN_REFRESHED'].includes(event))lock();});
try{
 await requireSecureAdmin(supabase);const version=epoch;const {data}=await supabase.auth.getSession();if(!data.session)throw Error();await refresh(data.session.user.id,version);
 $('access').textContent='';$('app').hidden=false;
}catch{lock();}
