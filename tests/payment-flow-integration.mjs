import {readFile} from 'node:fs/promises';
import assert from 'node:assert/strict';
import {paymentRuntime} from '../supabase/functions/_shared/payment-runtime.js';
const {PGlite}=await import(process.env.PGLITE_MODULE || '@electric-sql/pglite');
const {default:Stripe}=await import(process.env.STRIPE_TEST_MODULE || 'stripe');
// Isolated fixtures only. No credentials, network calls, or production stock.
const db=new PGlite();
const secret='whsec_integration_fixture';
const signer=new Stripe('sk_test_fixture');
const session={id:'cs_test_flow',livemode:false,mode:'payment',payment_status:'paid',
  payment_intent:'pi_flow',amount_total:29100,currency:'mxn',
  metadata:{rho_request_id:'flow'},client_reference_id:'flow'};
let reads=0;
class Client {
  constructor(){this.webhooks=signer.webhooks;this.checkout={sessions:{retrieve:async()=>{
    reads++;return {...session};
  }}};}
}
try {
  await db.exec(await readFile(new URL('../supabase/payment-confirmation-prototype.sql',import.meta.url),'utf8'));
  await db.exec(`insert into qw10_test.requests values
    ('flow','cs_test_flow',29100,false,clock_timestamp()+interval '30 minutes',true);
    insert into qw10_test.stock values('cone',1,true);
    insert into qw10_test.lines values('flow','cone',1)`);
  const handler=paymentRuntime({Stripe:Client,apiKey:'rk_test_fixture',signingSecret:secret,enabled:true,
    loadRequest:async sessionId=>{
      const {rows}=await db.query('select id,session_id,total_cents,livemode from qw10_test.requests where session_id=$1',[sessionId]);
      const r=rows[0];return r && {id:r.id,sessionId:r.session_id,totalCents:Number(r.total_cents),livemode:r.livemode};
    },
    commitPaid:async p=>(await db.query('select qw10_test.commit_payment($1,$2,$3,$4,$5,$6,$7) result',
      [p.requestId,p.sessionId,p.paymentIntentId,p.amountCents,p.currency,p.livemode,p.eventId])).rows[0].result
  });
  const notify=async(id,type='checkout.session.completed',tamper=false)=>{
    const payload=JSON.stringify({id,livemode:false,type,data:{object:{object:'checkout.session',id:session.id}}});
    return handler(new Request('https://local.test/webhook',{method:'POST',body:payload+(tamper?' ':''),
      headers:{'stripe-signature':signer.webhooks.generateTestHeaderString({payload,secret})}}));
  };
  assert.equal((await notify('evt_tampered',undefined,true)).status,400);
  assert.equal(reads,0);
  for(const [id,type] of [['evt_paid','checkout.session.completed'],['evt_repeat','checkout.session.completed'],
    ['evt_async','checkout.session.async_payment_succeeded']]) {
    assert.equal((await notify(id,type)).status,200);
  }
  assert.deepEqual((await db.query(`select
    (select count(*)::int from qw10_test.receipts) receipts,
    (select count(*)::int from qw10_test.purchase_orders) orders,
    (select count(*)::int from qw10_test.movements) movements,
    (select quantity from qw10_test.stock where sku='cone') stock`)).rows[0],
    {receipts:1,orders:1,movements:1,stock:0});
  console.log('PASS signed webhook → session validation → SQL receipt/order → stock deduction; repeated and async events do not duplicate fulfillment.');
  console.log('LIMIT: local Stripe retrieval fixture and isolated PGlite; no deployed webhook or production inventory adapter tested.');
} finally {await db.close();}
