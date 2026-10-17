import {supabase} from './supabase-client.js?v=20260913-loyalty';
const $=id=>document.getElementById(id);
let busy=false,attempt=null;
$('special-form').addEventListener('submit',async event=>{
 event.preventDefault();if(busy)return;
 const sku=$('special-sku').value.trim(),quantity=Number($('special-quantity').value);
 if(!/^[a-z0-9][a-z0-9-]{1,119}$/.test(sku)||!Number.isSafeInteger(quantity)||quantity<1||quantity>1000000)return;
 busy=true;$('special-save').disabled=true;$('special-result').hidden=true;$('special-session-help').hidden=true;
 try{
  const {data:{session},error}=await supabase.auth.getSession();if(error||!session)throw Error('session_required');
  // Preserve identity across uncertain responses; changing the payload requires a fresh attempt.
  if(attempt&&(attempt.sku!==sku||attempt.quantity!==quantity||attempt.owner!==session.user.id)){
   $('special-status').textContent='Recarga la página para iniciar otra solicitud. La reserva anterior podría haberse registrado.';return;
  }
  attempt ||= {sku,quantity,owner:session.user.id,retryKey:crypto.randomUUID()};
  const {data,error:failure}=await supabase.functions.invoke('test-special-order',{headers:{Authorization:`Bearer ${session.access_token}`},body:{environment:'test',sku,quantity,retryKey:attempt.retryKey}});
  if(failure){if(failure.context?.status===401)throw Error('session_required');throw Error('registration_unconfirmed');}
  const current=await supabase.auth.getSession();
  if(failure||current.data.session?.user.id!==attempt.owner||data?.environment!=='test'||data.sku!==sku||data.requested!==quantity||![data.reserved,data.additional].every(x=>Number.isSafeInteger(x)&&x>=0)||data.reserved+data.additional!==quantity)throw Error();
  $('special-reference').textContent=data.reference;$('special-requested').textContent=data.requested;$('special-reserved').textContent=data.reserved;$('special-additional').textContent=data.additional;
  $('special-result').hidden=false;$('special-status').textContent='Solicitud de prueba registrada';
 }catch(error){
  const needsSession=error.message==='session_required';
  $('special-session-help').hidden=!needsSession;
  $('special-status').textContent=needsSession
   ? 'Verifica tu sesión de administrador con autenticador y reintenta con los mismos datos para evitar duplicados.'
   : 'No se pudo confirmar el registro. Reintenta con los mismos datos para evitar duplicados.';
 }
 finally{busy=false;$('special-save').disabled=false;}
});
supabase.auth.onAuthStateChange(event=>{if(!['INITIAL_SESSION','TOKEN_REFRESHED'].includes(event))$('special-result').hidden=true;});
