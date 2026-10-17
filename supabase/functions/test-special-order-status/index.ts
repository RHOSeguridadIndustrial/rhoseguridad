import {createClient} from 'npm:@supabase/supabase-js@2.112.4';
import {requireAdminSession} from '../_shared/admin-auth.js';
import {specialOrderStatusHandler} from './handler.js';
const service=createClient(Deno.env.get('SUPABASE_URL')!,Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,{auth:{persistSession:false,autoRefreshToken:false}});
Deno.serve(specialOrderStatusHandler({
 authorize:async(jwt:string)=>{if(!await requireAdminSession(jwt))return null;const {data,error}=await service.auth.getUser(jwt);return error?null:data.user?.id;},
 load:async(owner:string,reference:string)=>{const {data,error}=await service.rpc('qw10_test_special_order_status',{p_owner:owner,p_reference:reference});if(error)throw Error();return data;}
}));
