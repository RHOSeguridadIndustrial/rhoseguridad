import { createClient } from 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.112.4/+esm';

const SUPABASE_URL = 'https://mtpqpxcmngrsivntbgcc.supabase.co';
const SUPABASE_PUBLISHABLE_KEY = 'sb_publishable_5Dan5EdjEHyfPDG30opQ8Q_d-Kkp72_';

export const supabase = createClient(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY);
