export async function requireAdminSession(jwt) {
  try {
    const {createClient}=await import('npm:@supabase/supabase-js@2.112.4');
    const client=createClient(Deno.env.get('SUPABASE_URL'),Deno.env.get('SUPABASE_ANON_KEY')||Deno.env.get('SUPABASE_SERVICE_ROLE_KEY'),{
      global:{headers:{Authorization:'Bearer '+jwt}},auth:{persistSession:false,autoRefreshToken:false}
    });
    const {data,error}=await client.rpc('admin_session_authorized');
    return !error&&data===true;
  }catch{return false;}
}
