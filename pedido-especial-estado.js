import {supabase} from './supabase-client.js?v=20260913-loyalty';
const $=id=>document.getElementById(id);
let busy=false;
$('special-query-form').addEventListener('submit',async event=>{
 event.preventDefault();if(busy)return;
 const reference=$('special-query-reference').value.trim();if(!/^test-special-[a-f0-9-]{36}$/.test(reference))return;
 busy=true;$('special-query').disabled=true;$('special-query-help').hidden=true;
 $('special-query-status').textContent='Consultando estado de la reserva…';
 try{
  const {data:{session},error}=await supabase.auth.getSession();if(error||!session)throw Error('session_required');
  const {data,error:failure}=await supabase.functions.invoke('test-special-order-status',{headers:{Authorization:`Bearer ${session.access_token}`},body:{environment:'test',reference}});
  if(failure)throw Error(failure.context?.status===401?'session_required':failure.context?.status===404?'not_found':'unavailable');
  const current=await supabase.auth.getSession();
  const labels={active:'Reserva de prueba vigente',expired:'Reserva de prueba vencida: ya no aparta existencias',quote_only:'Solicitud sin piezas reservadas: requiere cotización',inactive:'Reserva de prueba no vigente'};
  if(current.data.session?.user.id!==session.user.id||data?.environment!=='test'||data.reference!==reference||!Object.hasOwn(labels,data.state)||!Number.isFinite(Date.parse(data.checkedAt))||!Number.isFinite(Date.parse(data.expiresAt)))throw Error('unavailable');
  const format=value=>new Intl.DateTimeFormat('es-MX',{dateStyle:'medium',timeStyle:'medium',timeZone:'America/Mexico_City'}).format(new Date(value));
  $('special-query-status').textContent=`${labels[data.state]}. Vencimiento: ${format(data.expiresAt)} CDMX. Consultado: ${format(data.checkedAt)} CDMX.`;
 }catch(error){
  $('special-query-help').hidden=error.message!=='session_required';
  $('special-query-status').textContent=error.message==='session_required'?'Verifica tu sesión de administrador con autenticador.':error.message==='not_found'?'No se encontró esa reserva en tu cuenta.':'No se pudo consultar el estado. Intenta de nuevo.';
 }finally{busy=false;$('special-query').disabled=false;}
});
supabase.auth.onAuthStateChange(event=>{if(!['INITIAL_SESSION','TOKEN_REFRESHED'].includes(event))$('special-query-status').textContent='Consulta de nuevo para verificar el estado de la reserva.';});
