import {supabase} from './supabase-client.js?v=20261007-security';
const $=id=>document.getElementById(id),allowed=new Set(['admin.html','admin-precios.html','admin-pedidos.html','admin-inventario.html','admin-lealtad.html','admin-compras.html']);
const requested=new URLSearchParams(location.search).get('next'),next=allowed.has(requested)?requested:'admin.html';
let factorId=null,enrolling=false;
function feedback(text){$('status').textContent=text;}
function clearSecret(){$('qr').removeAttribute('src');$('secret').value='';$('setup').hidden=true;}
async function initialize(){
 try{
 const {data:{user},error}=await supabase.auth.getUser();
 if(error||!user){location.replace('login.html');return;}
 const {data:profile,error:profileError}=await supabase.from('profiles').select('role').eq('id',user.id).single();
 if(profileError||profile?.role!=='admin'){location.replace('index.html');return;}
 const {data:factors,error:factorsError}=await supabase.auth.mfa.listFactors();if(factorsError)throw factorsError;
 const verified=(factors.totp||[]).filter(f=>f.status==='verified');
 const {data:assurance,error:assuranceError}=await supabase.auth.mfa.getAuthenticatorAssuranceLevel();if(assuranceError)throw assuranceError;
 $('content').hidden=false;
 if(verified.length&&assurance.currentLevel==='aal2'){
 const {data:valid,error:touchError}=await supabase.rpc('admin_session_touch');
 if(!touchError&&valid===true){$('intro').textContent='Tu identidad está verificada.';$('ready').hidden=false;$('continue').href=next;return;}
 }
 $('intro').textContent=verified.length?'Escribe el código que aparece en tu autenticador para entrar al panel.':'Vincula tu autenticador para proteger el acceso de administrador.';
 if(verified.length){
 $('factor').replaceChildren(...verified.map(f=>{const o=document.createElement('option');o.value=f.id;o.textContent=f.friendly_name||'Autenticador RHO';return o;}));
 factorId=verified[0].id;$('factorLabel').hidden=verified.length<2;$('verify').hidden=false;
 }else $('enroll').hidden=false;
 }catch{feedback('No pudimos verificar tu acceso. Recarga la página e inténtalo nuevamente.');}
}
async function enroll(){
 $('enroll').disabled=$('backup').disabled=true;feedback('');
 try{
 const saved=sessionStorage.getItem('rho_pending_mfa_factor');
 if(saved){const {data}=await supabase.auth.mfa.listFactors();const pending=(data?.all||[]).find(f=>f.id===saved&&f.status==='unverified');if(pending)await supabase.auth.mfa.unenroll({factorId:saved});}
 const {data,error}=await supabase.auth.mfa.enroll({factorType:'totp',friendlyName:'RHO '+new Date().toISOString().slice(0,19),issuer:'RHO Seguridad Industrial'});if(error)throw error;
 factorId=data.id;enrolling=true;sessionStorage.setItem('rho_pending_mfa_factor',factorId);
 $('qr').src=data.totp.qr_code.startsWith('data:')?data.totp.qr_code:'data:image/svg+xml;charset=utf-8,'+encodeURIComponent(data.totp.qr_code);
 $('secret').value=data.totp.secret;$('setup').hidden=false;$('verify').hidden=false;$('ready').hidden=true;$('enroll').hidden=true;$('factorLabel').hidden=true;
 }catch{feedback('No pudimos vincular el autenticador. Inténtalo otra vez.');}
 finally{$('enroll').disabled=$('backup').disabled=false;}
}
$('factor').addEventListener('change',()=>{factorId=$('factor').value;});
$('enroll').onclick=enroll;$('backup').onclick=enroll;
$('copy').onclick=async()=>{try{await navigator.clipboard.writeText($('secret').value);feedback('Clave copiada. Pégala en tu autenticador.');}catch{feedback('Selecciona la clave para copiarla manualmente.');}};
$('verify').addEventListener('submit',async e=>{
 e.preventDefault();const button=e.currentTarget.querySelector('button');button.disabled=true;feedback('Verificando…');
 try{
 const {error}=await supabase.auth.mfa.challengeAndVerify({factorId,code:$('code').value});if(error)throw error;
 $('code').value='';clearSecret();if(enrolling)sessionStorage.removeItem('rho_pending_mfa_factor');
 const {data:valid,error:touchError}=await supabase.rpc('admin_session_touch');
 if(touchError||valid!==true){await supabase.auth.signOut({scope:'global'});location.replace('login.html?reason=renew');return;}
 location.replace(next);
 }catch{feedback('El código no es válido o expiró. Captura el código actual de tu autenticador.');}
 finally{button.disabled=false;}
});
$('others').onclick=async()=>{const {error}=await supabase.auth.signOut({scope:'others'});feedback(error?'No pudimos cerrar las otras sesiones.':'Las otras sesiones fueron cerradas.');};
$('logout').onclick=async()=>{clearSecret();await supabase.auth.signOut({scope:'global'});location.replace('login.html');};
window.addEventListener('pagehide',clearSecret);
initialize();
