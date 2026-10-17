import {supabase} from './supabase-client.js?v=20260913-loyalty';
const $=id=>document.getElementById(id);
let busy=false,attempt=null;
$('special-form').addEventListener('submit',async event=>{
 event.preventDefault();if(busy)return;
 const sku=$('special-sku').value.trim(),quantity=Number($('special-quantity').value);
 if(!/^[a-z0-9][a-z0-9-]{1,119}$/.test(sku)||!Number.isSafeInteger(quantity)||quantity<1||quantity>1000000)return;
 busy=true;$('special-save').disabled=true;$('special-result').hidden=true;
 try{
  const {data:{session},error}=await supabase.auth.getSession();if(error||!session)throw Error();
  // Preserve identity across uncertain responses; changing the payload requires a fresh attempt.
  if(attempt&&(attempt.sku!==sku||attempt.quantity!==quantity||attempt.owner!==session.user.id)){
   $('special-status').textContent='Recarga la página para iniciar otra solicitud. La reserva anterior podría haberse registrado.';return;
  }
  attempt ||= {sku,quantity,owner:session.user.id,retryKey:crypto.randomUUID()};
  const {data,error:failure}=await supabase.functions.invoke('test-special-order',{headers:{Authorization:`Bearer ${session.access_token}`},body:{environment:'test',sku,quantity,retryKey:attempt.retryKey}});
  const current=await supabase.auth.getSession();
  if(failure||current.data.session?.user.id!==attempt.owner||data?.environment!=='test'||data.sku!==sku||data.requested!==quantity||![data.reserved,data.additional].every(x=>Number.isSafeInteger(x)&&x>=0)||data.reserved+data.additional!==quantity)throw Error();
  $('special-reference').textContent=data.reference;$('special-requested').textContent=data.requested;$('special-reserved').textContent=data.reserved;$('special-additional').textContent=data.additional;
  $('special-result').hidden=false;$('special-status').textContent='Solicitud de prueba registrada';
 }catch{$('special-status').textContent='No se pudo confirmar el registro. Verifica la sesión de administrador con autenticador. Reintenta con los mismos datos para evitar duplicados.';}
 finally{busy=false;$('special-save').disabled=false;}
});
supabase.auth.onAuthStateChange(event=>{if(!['INITIAL_SESSION','TOKEN_REFRESHED'].includes(event))$('special-result').hidden=true;});
