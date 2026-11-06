import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {retiredCardVerification} from '../supabase/functions/verify-card-payment/handler.js';
test('legacy verifier cannot expose customer details or update any supplied payment',async()=>{
 for(const method of ['GET','POST','PUT']){
  const response=retiredCardVerification(new Request('https://fixture.invalid',{method,...(method==='POST'?{body:JSON.stringify({session_id:'cs_live_fixture'})}:{})}));
  assert.equal(response.status,410);assert.deepEqual(await response.json(),{error:'legacy_payment_verification_retired'});
 }
 const source=readFileSync('supabase/functions/verify-card-payment/handler.js','utf8')+readFileSync('supabase/functions/verify-card-payment/index.ts','utf8');
 assert.ok(!/Deno\.env|fetch\(|createClient|\.rpc\(|\.from\(/.test(source));
});
test('retired endpoint handles allowed preflight and rejects foreign browser origins',()=>{
 assert.equal(retiredCardVerification(new Request('https://fixture.invalid',{method:'OPTIONS',headers:{origin:'https://rhosegind.com'}})).status,204);
 assert.equal(retiredCardVerification(new Request('https://fixture.invalid',{method:'POST',headers:{origin:'https://evil.invalid'}})).status,403);
});
