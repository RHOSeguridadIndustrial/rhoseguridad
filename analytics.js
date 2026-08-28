import { supabase } from './supabase-client.js';

function getSessionId(){
  const key='rho_visit_session_id';
  try{
    let id=sessionStorage.getItem(key);
    if(!id){
      id=crypto.randomUUID?.()||`${Date.now()}-${Math.random().toString(36).slice(2)}`;
      sessionStorage.setItem(key,id);
    }
    return id;
  }catch{
    return crypto.randomUUID?.()||`${Date.now()}-${Math.random().toString(36).slice(2)}`;
  }
}

function shouldRecordVisit(path){
  // Una visita por página y sesión del navegador. Las recargas no inflan el conteo.
  const key=`rho_visit_recorded:${path}`;
  try{
    if(sessionStorage.getItem(key)==='1') return false;
    sessionStorage.setItem(key,'1');
    return true;
  }catch{
    return true;
  }
}

const visitPath=`${location.pathname}${location.search}`;

if(shouldRecordVisit(visitPath)){
  try{
    const {data:{session}}=await supabase.auth.getSession();
    const {error}=await supabase.from('site_visits').insert({
      user_id:session?.user?.id||null,
      session_id:getSessionId(),
      path:visitPath,
      referrer:document.referrer||null,
      user_agent:navigator.userAgent
    });
    if(error) throw error;
  }catch(error){
    // Permite reintentar si Supabase falló y la visita realmente no se guardó.
    try{ sessionStorage.removeItem(`rho_visit_recorded:${visitPath}`); }catch{}
    console.debug('RHO analytics unavailable',error);
  }
}
