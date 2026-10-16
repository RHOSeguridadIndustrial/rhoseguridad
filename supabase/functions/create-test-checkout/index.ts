import Stripe from 'npm:stripe@22.6.0';
import {createClient} from 'npm:@supabase/supabase-js@2.112.4';
import {requireAdminSession} from '../_shared/admin-auth.js';
import {testCheckoutHandler} from './handler.js';
const url=Deno.env.get('SUPABASE_URL')!;
const service=createClient(url,Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,{auth:{persistSession:false,autoRefreshToken:false}});
const key=Deno.env.get('STRIPE_TEST_RESTRICTED_KEY')||'';
const rpc=async(name:string,args:any)=>{
 const {data,error}=await service.rpc(name,args);if(error) throw Error('Test database error');return data;
};
Deno.serve(testCheckoutHandler({configured:/^rk_test_/.test(key),
 stripe:/^rk_test_/.test(key)?new Stripe(key,{apiVersion:'2026-08-26.dahlia',httpClient:Stripe.createFetchHttpClient()}):null,
 authorize:async(jwt:string)=>{
  if(!await requireAdminSession(jwt)) return null;
  const {data,error}=await service.auth.getUser(jwt);return error?null:data.user?.id;
 },
 quoteDeps:{loadVariant:(sku:string)=>rpc('qw10_test_variant',{p_sku:sku}),
  validateCoverage:async(address:any)=>address?.postalCode==='02000'},
 reserve:({ownerId,retryKey,quote}:any)=>rpc('qw10_test_reserve',{p_owner:ownerId,p_retry:retryKey,p_quote:quote}),
 bindSession:({requestId,ownerId,sessionId}:any)=>rpc('qw10_test_bind',{p_request:requestId,p_owner:ownerId,p_session:sessionId})
}));
