import { supabase } from './supabase-client.js?v=20260913-registration';

const form = document.getElementById('registerForm');
const status = document.getElementById('status');
const button = form.querySelector('button[type="submit"]');

form.addEventListener('submit', async (event) => {
  event.preventDefault();
  if (button.disabled) return;
  button.disabled = true;
  status.className = 'note';
  status.textContent = 'Solicitando el registro…';
  try {
    const values = new FormData(form);
    const email = String(values.get('email') || '').trim().toLowerCase();
    const password = String(values.get('password') || '');
    const fullName = `${String(values.get('nombre') || '').trim()} ${String(values.get('apellidos') || '').trim()}`.trim();
    const { data, error } = await supabase.auth.signUp({
      email, password,
      options: {
        emailRedirectTo: 'https://rhosegind.com/',
        data: {
          full_name: fullName,
          company_name: String(values.get('empresa') || '').trim(),
          phone: String(values.get('telefono') || '').trim(),
          customer_type: String(values.get('tipo') || ''),
        },
      },
    });
    if (error) {
      if (error.code === 'weak_password') throw new Error('Elige una contraseña más segura e inténtalo nuevamente.');
      if (error.status === 429) throw new Error('Espera unos minutos antes de solicitar otro registro.');
      throw new Error('No pudimos completar la solicitud. Revisa tu conexión o solicita ayuda a RHO.');
    }
    if (!data?.user) throw new Error('No pudimos confirmar la solicitud. Inténtalo de nuevo.');
    // No administrative confirmation, client-generated nonce or automatic password login.
    // Do not disclose whether the email already belongs to an account.
    if (data.session) {
      await supabase.auth.signOut({ scope: 'local' });
    }
    form.reset();
    form.hidden = true;
    status.className = 'note ok';
    status.textContent = 'Revisa tu correo y abre el enlace de confirmación para activar tu cuenta. Si ya tienes una cuenta, inicia sesión. Revisa también la carpeta de correo no deseado.';
    document.getElementById('contactOptions').hidden = false;
  } catch (error) {
    status.className = 'note error';
    status.textContent = error.message || 'No pudimos completar la solicitud. Inténtalo de nuevo.';
  } finally {
    button.disabled = false;
  }
});
