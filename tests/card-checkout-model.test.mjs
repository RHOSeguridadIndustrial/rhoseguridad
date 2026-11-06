import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {cardContact,cardInput,cardFingerprint,cardSummary,cardLink,cardStatus} from '../card-checkout-model.js';
import {customerReturnTarget} from '../checkout-return.js';
import {adminReturnTarget,adminVerificationUrl} from '../admin-return.js';
import {quote,address,contact,owner} from './card-database-fixture.mjs';
const input={items:[{sku:'fixture-sku',quantity:2}],address,contact};
const summary={environment:'live',...quote()};
test('recipient normalization rejects incomplete contact and changes retry identity',()=>{
 assert.deepEqual(cardContact({name:'  Nombre  Apellido  ',phone:'+52 (55) 1234-5678'}),{name:'Nombre Apellido',phone:'+525512345678'});
 for(const value of [null,{name:'A',phone:'5555555555'},{name:'Nombre',phone:'123'},{name:'<script>',phone:'5555555555'}])assert.throws(()=>cardContact(value));
 assert.notEqual(cardFingerprint(input),cardFingerprint({...input,contact:{...contact,name:'Otro receptor'}}));
 assert.throws(()=>cardInput({...input,items:[{sku:'fixture-sku',quantity:101}]}));
});
test('displayed price must match server lines and the customer cart',()=>{
 assert.equal(cardSummary(summary,input.items).totalCents,10564);
 for(const change of [{environment:'test'},{totalCents:1},{currency:'usd'},{shippingCents:-1},{lines:[{...summary.lines[0],quantity:3}]}])assert.throws(()=>cardSummary({...summary,...change},input.items));
});
test('only exact live Stripe links matching the accepted total can be opened',()=>{
 const data={...summary,sessionId:'cs_live_fixture',requestId:owner,url:'https://checkout.stripe.com/c/pay/cs_live_fixture',expiresAt:Math.floor(Date.now()/1000)+3600};
 assert.equal(cardLink(data,{items:input.items,totalCents:10564}),data.url);
 for(const change of [{url:'https://checkout.stripe.com.attacker.invalid/c/pay/cs_live_fixture'},{url:'https://checkout.stripe.com/c/pay/cs_live_other'},{sessionId:'cs_test_fixture'},{expiresAt:1},{totalCents:1}])assert.throws(()=>cardLink({...data,...change},{items:input.items,totalCents:10564}));
});
test('read-only status distinguishes paid, unconfirmed and reconciliation outcomes',()=>{
 const value={requestId:owner,orderId:owner,totalCents:10564,currency:'mxn',state:'paid',paymentStatus:'paid'};
 assert.equal(cardStatus(value).state,'paid');assert.equal(cardStatus(null),null);
 assert.equal(cardStatus({...value,state:'reconciliation_required',orderId:null}).state,'reconciliation_required');
 for(const change of [{state:'prepared'},{orderId:null},{paymentStatus:'unconfirmed'},{totalCents:'10564'}])assert.throws(()=>cardStatus({...value,...change}));
});
test('login and administrator MFA allow only canonical internal checkout returns',()=>{
 for(const target of ['checkout-tarjeta.html','pago-exitoso.html?session_id=cs_live_fixture']){
  const search='?next='+encodeURIComponent(target);
  assert.equal(customerReturnTarget(search),target);assert.equal(adminReturnTarget(search),target);
  assert.equal(adminVerificationUrl(search),'admin-seguridad.html?next='+encodeURIComponent(target));
 }
 for(const target of ['//evil.invalid','https://evil.invalid','pago-exitoso.html?session_id=cs_test_fixture','pago-exitoso.html?session_id=cs_live_fixture&next=https://evil.invalid','checkout-tarjeta.html#evil','../checkout-tarjeta.html']){
  assert.equal(customerReturnTarget('?next='+encodeURIComponent(target)),'cuenta.html');
  assert.equal(adminReturnTarget('?next='+encodeURIComponent(target)),'admin.html');
 }
 assert.equal(adminReturnTarget('?next=checkout-prueba.html'),'checkout-prueba.html');
});
test('login CSP permits the exact modified inline module and success page has no write/clear path',()=>{
 const html=readFileSync('login.html','utf8'),script=html.match(/<script type="module">([\s\S]*?)<\/script>/)[1];
 assert.ok(html.includes('sha256-'+createHash('sha256').update(script).digest('base64')));
 const page=readFileSync('pago-exitoso.html','utf8')+readFileSync('pago-exitoso.js','utf8');
 assert.ok(!/verify-card-payment|clearCart|\.functions\.invoke/.test(page));
 assert.match(page,/card_checkout_status/);
});
