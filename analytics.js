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

try{
  const {data:{session}}=await supabase.auth.getSession();
  await supabase.from('site_visits').insert({
    user_id:session?.user?.id||null,
    session_id:getSessionId(),
    path:`${location.pathname}${location.search}`,
    referrer:document.referrer||null,
    user_agent:navigator.userAgent
  });
}catch(error){
  console.debug('RHO analytics unavailable',error);
}
