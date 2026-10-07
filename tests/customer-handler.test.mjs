import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHandler } from '../supabase/functions/admin-manage-customer/handler.js';
const actor={id:'11111111-1111-4111-8111-111111111111',role:'admin',deactivated_at:null};
const target={id:'22222222-2222-4222-8222-222222222222',role:'customer',email:'demo@example.test',updated_at:'2026-10-07T20:00:00+00:00',deactivated_at:null};
const valid={action:'edit',customer_id:target.id,expected_updated_at:target.updated_at,full_name:'Cliente Demo',company_name:'Empresa Demo',phone:'5555555555',email:'demo@example.test'};
function setup(options={}){
  let writes=[];
  const service={
    auth:{getUser:async()=>options.unauthorized?{error:{},data:{}}:{data:{user:actor}},admin:{
      getUserById:async()=>({data:{user:{app_metadata:{provider:'email'},user_metadata:{untouched:true}}}}),
      updateUserById:async(id,changes)=>{writes.push({id,changes});return options.updateError?{error:options.updateError}:{data:{user:{id}}};}
    }},
    from(){return {select(){return this;},eq(_,id){this.id=id;return this;},async maybeSingle(){return {data:this.id===actor.id?{...actor,...options.actor}:{...target,...options.target}};}};}
  };
  const handler=createHandler(service,async()=>!options.insecure);
  return {writes,run:(body=valid,headers={Authorization:'Bearer valid'},method='POST')=>handler(new Request('https://example.test',{method,headers:{'Content-Type':'application/json',...headers},body:method==='POST'?JSON.stringify(body):undefined}))};
}
test('missing/invalid authentication rejected without writes',async()=>{
  let s=setup();assert.equal((await s.run(valid,{})).status,401);assert.equal(s.writes.length,0);
  s=setup({unauthorized:true});assert.equal((await s.run()).status,401);assert.equal(s.writes.length,0);
});
test('non-admin and inactive admin rejected',async()=>{for(const actor of [{role:'customer'},{deactivated_at:'2026-10-07'}]){const s=setup({actor});assert.equal((await s.run()).status,403);assert.equal(s.writes.length,0);}});
test('own account and other admin targets protected',async()=>{let s=setup();assert.equal((await s.run({...valid,customer_id:actor.id})).status,403);s=setup({target:{role:'admin'}});assert.equal((await s.run()).status,403);assert.equal(s.writes.length,0);});
test('stale revision rejected',async()=>{const s=setup();assert.equal((await s.run({...valid,expected_updated_at:'2026-10-06T00:00:00Z'})).status,409);assert.equal(s.writes.length,0);});
test('invalid input rejected',async()=>{for(const body of [null,[],{...valid,full_name:'  '},{...valid,email:'invalid'},{...valid,phone:'<script>'}]){const s=setup();assert.equal((await s.run(body)).status,400);assert.equal(s.writes.length,0);}});
test('login email change requires explicit confirmation',async()=>{const s=setup();assert.equal((await s.run({...valid,email:'new@example.test'})).status,400);assert.equal(s.writes.length,0);});
test('valid edit preserves existing metadata and records authenticated actor',async()=>{const s=setup();assert.equal((await s.run({...valid,email:'new@example.test',confirm_email_change:true,role:'admin'})).status,200);assert.equal(s.writes[0].changes.email,'new@example.test');assert.equal(s.writes[0].changes.app_metadata.provider,'email');assert.equal(s.writes[0].changes.user_metadata.untouched,true);assert.equal(s.writes[0].changes.app_metadata.rho_customer_admin_operation.actor_id,actor.id);assert.equal(s.writes[0].changes.role,undefined);});
test('duplicate email surfaces actionable error',async()=>{const s=setup({updateError:{code:'email_exists'}});const r=await s.run();assert.equal(r.status,409);assert.match((await r.json()).error,/otra cuenta/);});
test('deactivation requires confirmation and reason; bans via Auth',async()=>{const s=setup(),body={...valid,action:'deactivate'};assert.equal((await s.run(body)).status,400);assert.equal((await s.run({...body,confirm:true,reason:'x'})).status,400);assert.equal((await s.run({...body,confirm:true,reason:'Cuenta de prueba'})).status,200);assert.equal(s.writes[0].changes.ban_duration,'876000h');});
test('reactivation clears ban only for inactive customers',async()=>{let s=setup();assert.equal((await s.run({...valid,action:'reactivate',confirm:true})).status,409);s=setup({target:{deactivated_at:'2026-10-07'}});assert.equal((await s.run({...valid,action:'reactivate',confirm:true})).status,200);assert.equal(s.writes[0].changes.ban_duration,'none');});
test('untrusted origin rejected and no mutations on preflight',async()=>{const s=setup();assert.equal((await s.run(valid,{Authorization:'Bearer valid',Origin:'https://other.example'})).status,403);assert.equal((await s.run(null,{Origin:'https://rhosegind.com'},'OPTIONS')).status,200);assert.equal(s.writes.length,0);});

test('missing MFA or expired session rejects mutations',async()=>{const s=setup({insecure:true});assert.equal((await s.run()).status,403);assert.equal(s.writes.length,0);});
