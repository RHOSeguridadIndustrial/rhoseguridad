import {supabase} from './supabase-client.js?v=20261007-inventory';
import {requireSecureAdmin} from './admin-security-guard.js?v=20261007-1';
import {transferAmount,transferRecord,transferList} from './test-transfer-model.js?v=20261024-1';
const $=id=>document.getElementById(id),el=(tag,text)=>{const e=document.createElement(tag);e.textContent=text;return e;};
const money=n=>new Intl.NumberFormat('es-MX',{style:'currency',currency:'MXN'}).format(n/100);
const date=n=>new Date(n*1000).toLocaleString('es-MX',{timeZone:'America/Mexico_City'});
let epoch=0,busy=false,observedOwner;
function clear(){ $('transfers').replaceChildren();$('limit').hidden=true; }
function lock(){epoch++;clear();$('app').hidden=true;$('login-help').hidden=false;$('access').textContent='Inicia sesión como administrador y completa el autenticador.';$('message').textContent='';}
async function sameOwner(owner,version){const {data,error}=await supabase.auth.getSession();if(error||version!==epoch||data.session?.user.id!==owner)throw Error('session_changed');}
async function rpc(action,request=null,reference=null,amount=null){const {data,error}=await supabase.rpc('qw10_test_transfer',{p_action:action,p_request:request,p_reference:reference,p_amount:amount});if(error)throw error;return data;}
function draw(data){
 clear();$('limit').hidden=!data.limited;
 if(!data.transfers.length){$('transfers').append(el('p','Todavía no hay transferencias de prueba. Prepara una desde Compra de prueba.'));return;}
 const selected=new URLSearchParams(location.search).get('request');
 const rows=[...data.transfers].sort((a,b)=>Number(b.requestId===selected)-Number(a.requestId===selected));
 for(const r of rows){
  const article=el('article','');article.id='transfer-'+r.requestId;
  const names={awaiting_confirmation:'Sin confirmación simulada',paid:'Confirmación simulada registrada',reconciliation_required:'Confirmación simulada en revisión'};
  article.append(el('h2',`${money(r.totalCents)} · Transferencia simulada`),el('p','Referencia de preparación: TEST-'+r.requestId));
  const list=el('ul','');for(const l of r.items)list.append(el('li',`${l.quantity} × ${l.name} · ${money(l.lineTotalCents)}`));article.append(list);
  const state=el('p',names[r.state]);state.className='status';article.append(state);
  if(r.state==='awaiting_confirmation'){
   const expiry=el('p',r.expired?'La reserva está vencida o inactiva. Una confirmación simulada quedará en revisión, sin orden ni descuento de existencias.':`Vigente hasta ${date(r.expiresAt)} (CDMX). El servidor volverá a comprobar la reserva.`);expiry.className='expiry';article.append(expiry);
   const form=el('form',''),amountLabel=el('label','Importe simulado · MXN'),amount=el('input','');amount.type='text';amount.inputMode='decimal';amount.required=true;amount.placeholder='123.70';amount.autocomplete='off';amountLabel.append(amount);
   const refLabel=el('label','Referencia ficticia'),reference=el('input','');reference.type='text';reference.required=true;reference.value='BANKTEST-'+crypto.randomUUID().replaceAll('-','').toUpperCase();reference.maxLength=73;reference.pattern='BANKTEST-[A-Z0-9-]{8,64}';refLabel.append(reference);
   const ackLabel=el('label',''),ack=el('input','');ack.type='checkbox';ack.required=true;ackLabel.className='ack';ackLabel.append(ack,el('span','Confirmo que esta es una simulación sin movimiento bancario.'));
   const submit=el('button','Registrar confirmación simulada');submit.type='submit';form.append(amountLabel,refLabel,ackLabel,submit);article.append(form);
   amount.addEventListener('input',()=>amount.setCustomValidity(''));
   form.addEventListener('submit',e=>{e.preventDefault();let cents;try{cents=transferAmount(amount.value);if(cents!==r.totalCents)throw Error();}catch{amount.setCustomValidity('El importe debe coincidir exactamente con el total de esta prueba.');amount.reportValidity();return;}
    if(!ack.checked)return;run(async(owner,version)=>{const response=await rpc('confirm',r.requestId,reference.value,cents);await sameOwner(owner,version);validateAction(response,r.requestId);await refresh(owner,version);$('message').textContent=response.transfer.state==='paid'?'Confirmación simulada registrada. La orden de prueba está lista para preparar.':'Confirmación simulada en revisión. No se generó una orden ni se descontaron existencias.';});
   });
  }else{
   article.append(el('p','Referencia de confirmación: '+r.receiptReference));
   if(r.state==='reconciliation_required')article.append(el('p','La confirmación permanece en revisión. No autoriza preparar ni despachar.'));
   else{
    const stages={pending:'Preparación pendiente',prepared:'Preparación registrada',dispatched:'Salida registrada'};
    article.append(el('p',`Orden de prueba #${r.orderId} · ${stages[r.preparation]}`));
    const actions=el('div','');actions.className='actions';
    if(r.preparation!=='dispatched'){
     const action=r.preparation==='pending'?'prepare':'dispatch',button=el('button',action==='prepare'?'Marcar preparado · prueba':'Registrar salida · prueba');button.type='button';
     button.addEventListener('click',()=>run(async(owner,version)=>{const response=await rpc(action,r.requestId);await sameOwner(owner,version);validateAction(response,r.requestId);await refresh(owner,version);$('message').textContent=action==='prepare'?'Preparación de prueba registrada.':'Salida de prueba registrada. No se programó una entrega real.';}));actions.append(button);
    }article.append(actions);
   }
  }
  $('transfers').append(article);
 }
}
function validateAction(d,id){if(d?.environment!=='test'||d.transfer?.requestId!==id)throw Error();transferRecord(d.transfer);}
async function refresh(owner,version){const data=await rpc('list');await sameOwner(owner,version);draw(transferList(data));}
async function run(work){
 if(busy)return;busy=true;const version=epoch;$('message').textContent='Comprobando…';for(const b of document.querySelectorAll('button,input'))b.disabled=true;
 try{const {data,error}=await supabase.auth.getSession();if(error||!data.session)throw Error('session_changed');await work(data.session.user.id,version);if($('message').textContent==='Comprobando…')$('message').textContent='';}
 catch(error){if(version!==epoch)return;if(error.code==='42501'||error.message==='session_changed')lock();else {$('message').textContent='No se pudo confirmar el resultado. Conserva la misma referencia al reintentar o actualiza para consultar el estado.';}}
 finally{busy=false;for(const b of document.querySelectorAll('button,input'))b.disabled=false;}
}
$('refresh').addEventListener('click',()=>run(async(owner,version)=>{clear();await refresh(owner,version);}));
supabase.auth.onAuthStateChange((event,session)=>{const owner=session?.user?.id||null,changed=observedOwner!==undefined&&owner!==observedOwner;observedOwner=owner;if(!owner||changed||!['INITIAL_SESSION','SIGNED_IN','TOKEN_REFRESHED'].includes(event))lock();});
try{const version=epoch;await requireSecureAdmin(supabase);if(version===epoch){$('access').textContent='';$('login-help').hidden=true;$('app').hidden=false;await run(refresh);}}catch{lock();}
