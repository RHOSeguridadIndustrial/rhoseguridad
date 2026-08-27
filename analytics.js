import { supabase } from './supabase-client.js';

const { data: { session } } = await supabase.auth.getSession();
if (session?.user) {
  await supabase.from('site_visits').insert({
    user_id: session.user.id,
    session_id: session.access_token.slice(-24),
    path: `${location.pathname}${location.search}`,
    referrer: document.referrer || null,
    user_agent: navigator.userAgent
  });
}
