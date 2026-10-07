import { createClient } from 'npm:@supabase/supabase-js@2.112.4';
import { createHandler } from './handler.js';

const service = createClient(
  Deno.env.get('SUPABASE_URL')!,
  Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
  { auth: { persistSession: false, autoRefreshToken: false } },
);
Deno.serve(createHandler(service));
