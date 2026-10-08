import {supabase} from './supabase-client.js?v=20261007-security';
import {requireSecureAdmin} from './admin-security-guard.js?v=20261007-1';

const $=id=>document.getElementById(id);
const labels={active:'Activa',paused:'Pausada',off:'Apagada'};
const descriptions={
  active:'La campaña puede investigar y solicitar cotizaciones dentro del horario de contacto.',
  paused:'La actividad está en pausa. Puede retomarla cuando lo decida.',
  off:'La campaña está apagada. Su historial y configuración se conservan.'
};
const dateFormat=new Intl.DateTimeFormat('es-MX',{timeZone:'America/Mexico_City',dateStyle:'medium',timeStyle:'short'});
const date=value=>value?dateFormat.format(new Date(value)):'Sin registro';
let state=null,busy=false,timer=null;
const controls=[...document.querySelectorAll('[data-mode]')];

function feedback(text,error=false){$('message').textContent=text;$('message').classList.toggle('error',error);}
function buttons(){controls.forEach(b=>{b.disabled=busy||!state||b.dataset.mode===state.mode;});$('refresh').disabled=busy;}
function render(data){
  if(!data||!labels[data.mode]||!Number.isSafeInteger(data.revision))throw new Error('Invalid campaign state');
  state=data;
  $('mode').textContent=labels[state.mode];$('mode').dataset.mode=state.mode;
  $('mode-description').textContent=descriptions[state.mode];
  $('changed-at').textContent=date(state.changed_at);$('checked-at').textContent=date(state.last_checked_at);
  const recent=state.last_checked_at&&new Date(state.server_now)-new Date(state.last_checked_at)<90*60*1000;
  $('acknowledgment').textContent=!state.last_checked_at?'Pendiente de la primera comprobación programada.':
    !recent?'Sin comprobación reciente. Verifique la tarea en ChatGPT si continúa así.':
    state.last_checked_revision!==state.revision?'Cambio guardado; pendiente de comprobación por la campaña.':'El proceso ya comprobó este estado.';
  $('contact-window').textContent=state.contact_window_open?'Dentro del horario de contacto':'Fuera del horario de contacto';
  const rows=(state.events||[]).map(event=>{
    const tr=document.createElement('tr');
    for(const text of [date(event.created_at),event.previous_mode?`${labels[event.previous_mode]||'—'} → ${labels[event.mode]||'—'}`:'Configuración inicial · Pausada',event.by_admin?'Administrador':'Configuración inicial']){
      const td=document.createElement('td');td.textContent=text;tr.append(td);
    }return tr;
  });
  $('history').replaceChildren(...rows);buttons();
}
async function load(silent=false){
  if(busy)return;busy=true;buttons();
  try{
    const {data,error}=await supabase.rpc('admin_procurement_get');if(error)throw error;
    render(data);if(!silent)feedback('Estado actualizado.');
  }catch{
    state=null;$('mode').textContent='Sin conexión';delete $('mode').dataset.mode;
    $('mode-description').textContent='No se pudo comprobar el estado. Actualice antes de realizar un cambio.';
    feedback('No pudimos consultar la campaña. Compruebe su conexión o vuelva a iniciar sesión.',true);
  }finally{busy=false;buttons();}
}
async function change(mode){
  if(busy||!state||mode===state.mode)return;
  busy=true;buttons();feedback('Guardando cambio…');
  try{
    const {data,error}=await supabase.rpc('admin_procurement_set',{p_mode:mode,p_expected_revision:state.revision});
    if(error)throw error;
    render(data);feedback(`Campaña ${labels[mode].toLowerCase()}. Cambio guardado.`);
  }catch(error){
    // Never show optimistic success. A timeout can happen after the server saves.
    state=null;$('mode').textContent='Por verificar';delete $('mode').dataset.mode;
    $('mode-description').textContent='Actualice el estado para comprobar qué cambio quedó guardado.';
    feedback(error?.code==='40001'?'Otro cambio se guardó primero. Actualice el estado antes de intentarlo de nuevo.':'No se pudo confirmar el cambio. Actualice el estado antes de volver a intentar.',true);
  }finally{busy=false;buttons();}
}
for(const button of controls)button.addEventListener('click',()=>change(button.dataset.mode));
$('refresh').addEventListener('click',()=>load());
$('logout').addEventListener('click',async()=>{clearInterval(timer);await supabase.auth.signOut({scope:'global'});location.replace('login.html');});

try{
  await requireSecureAdmin(supabase);
  $('access').hidden=true;$('app').hidden=false;$('logout').hidden=false;
  await load(true);
  timer=setInterval(()=>{if(document.visibilityState==='visible')load(true);},60000);
}catch{
  $('access').textContent='Inicie sesión y verifique su identidad para administrar la campaña.';
}
