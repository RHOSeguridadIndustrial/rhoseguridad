const idleMs=15*60*1000;
export async function requireSecureAdmin(supabase) {
  if(window.top!==window.self){document.body.replaceChildren();throw new Error('Abre el panel directamente');}
  const {data:{user},error}=await supabase.auth.getUser();
  if(error||!user){location.replace('login.html');throw new Error('Inicia sesión');}
  const {data:profile,error:profileError}=await supabase.from('profiles').select('role').eq('id',user.id).single();
  if(profileError||profile?.role!=='admin'){location.replace('index.html');throw new Error('Acceso reservado');}
  const {data:assurance,error:mfaError}=await supabase.auth.mfa.getAuthenticatorAssuranceLevel();
  const verifyUrl='admin-seguridad.html?next='+encodeURIComponent(location.pathname.split('/').pop());
  if(mfaError||assurance?.currentLevel!=='aal2'){location.replace(verifyUrl);throw new Error('Verificación requerida');}
  const {data:allowed,error:accessError}=await supabase.rpc('admin_session_touch');
  if(accessError||allowed!==true){location.replace(verifyUrl);throw new Error('Verifica nuevamente tu sesión');}
  const key='rho_admin_activity_'+user.id;
  const read=()=>{try{return Number(localStorage.getItem(key))||0;}catch{return last;}};
  let last=Date.now(),busy=false,stopped=false;
  const activity=()=>{last=Date.now();try{localStorage.setItem(key,String(last));}catch{}};
  activity();
  async function end(){
    if(stopped)return;stopped=true;
    document.body.replaceChildren();
    try{await supabase.auth.signOut({scope:'global'});}finally{location.replace('login.html?reason=expired');}
  }
  for(const event of ['pointerdown','keydown','scroll','touchstart'])window.addEventListener(event,activity,{passive:true});
  const timer=setInterval(async()=>{
    if(stopped||busy)return;
    if(Date.now()-Math.max(last,read())>=idleMs){await end();return;}
    if(document.visibilityState!=='visible'||Date.now()-Math.max(last,read())>60000)return;
    busy=true;
    try{const {data,error}=await supabase.rpc('admin_session_touch');if(error||data!==true)await end();}finally{busy=false;}
  },60000);
  document.addEventListener('visibilitychange',()=>{if(document.visibilityState==='visible'&&Date.now()-Math.max(last,read())>=idleMs)end();});
  supabase.auth.onAuthStateChange((event,session)=>{if(event==='SIGNED_OUT'||!session){stopped=true;clearInterval(timer);document.body.replaceChildren();location.replace('login.html');}});
  window.addEventListener('pageshow',event=>{if(event.persisted)location.reload();});
  return user;
}
