const byId = id => document.getElementById(id);
const status = byId('status'), account = byId('account');
let supabase;
function clearAccount() {
  account.hidden = true;
  ['greeting','fullName','email','company','phone'].forEach(id => byId(id).textContent = '');
}
async function init() {
  try {
    ({ supabase } = await import('./supabase-client.js?v=20260913-loyalty'));
    const { data: { user }, error } = await supabase.auth.getUser();
    if (error?.name === 'AuthSessionMissingError' || error?.status === 401) { location.replace('login.html'); return; }
    if (error) throw error;
    if (!user) { location.replace('login.html'); return; }
    const { data: profile, error: profileError } = await supabase.from('profiles')
      .select('full_name,company_name').eq('id', user.id).maybeSingle();
    const metadata = user.user_metadata || {};
    const name = profile?.full_name || metadata.full_name || '';
    byId('greeting').textContent = name ? 'Bienvenido, ' + name : 'Bienvenido a tu cuenta';
    byId('fullName').textContent = name || 'Sin registrar';
    byId('email').textContent = user.email || 'Sin registrar';
    byId('company').textContent = profile?.company_name || metadata.company_name || 'Sin registrar';
    byId('phone').textContent = metadata.phone || 'Sin registrar';
    byId('profileNote').hidden = !profileError;
    status.textContent = '';
    account.hidden = false;
    supabase.auth.onAuthStateChange((event, session) => {
      if (event === 'SIGNED_OUT' || !session) { clearAccount(); location.replace('login.html'); }
    });
  } catch {
    clearAccount();
    status.textContent = 'No pudimos verificar tu sesión. Vuelve a iniciar sesión o continúa cotizando.';
    byId('recovery').hidden = false;
  }
}
byId('logout').addEventListener('click', async () => {
  const button = byId('logout');
  button.disabled = true;
  try {
    const { error } = await supabase.auth.signOut({ scope: 'local' });
    if (error) throw error;
    clearAccount();
    location.replace('login.html');
  } catch {
    status.textContent = 'No fue posible cerrar la sesión. Inténtalo de nuevo.';
    button.disabled = false;
  }
});
window.addEventListener('pageshow', event => { if (event.persisted) location.reload(); });
init();
