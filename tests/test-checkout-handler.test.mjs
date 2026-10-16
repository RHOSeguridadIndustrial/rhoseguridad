import {test} from 'node:test';
import assert from 'node:assert/strict';
import {testCheckoutHandler} from '../supabase/functions/create-test-checkout/handler.js';
const make=(options={})=>testCheckoutHandler({configured:true,authorize:async()=>null,...options});
const request=(body={},headers={})=>new Request('https://local.test',{method:'POST',body:JSON.stringify(body),headers});
test('unsigned and non-admin requests cannot reserve or access Stripe',async()=>{
 assert.equal((await make()(request())).status,401);
 assert.equal((await make()(request({}, {authorization:'Bearer invalid'}))).status,401);
});
test('cross-origin and disabled checkout fail before authentication',async()=>{
 const authorize=async()=>{throw Error('must not execute')};
 assert.equal((await make({authorize})(request({}, {origin:'https://evil.example'}))).status,403);
 assert.equal((await make({configured:false,authorize})(request())).status,503);
});
test('real environment and unsupported postal rejected before checkout creation',async()=>{
 const h=make({authorize:async()=>'owner'});
 for(const body of [{environment:'live',address:{postalCode:'02000'}},{environment:'test',address:{postalCode:'99999'}}])
  assert.equal((await h(request(body,{authorization:'Bearer fixture'}))).status,400);
});
