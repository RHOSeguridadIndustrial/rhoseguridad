import Stripe from 'npm:stripe@22.6.0';
import {paymentRuntime} from '../_shared/payment-runtime.js';
const base=Deno.env.get('SUPABASE_URL');
const key=Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
async function rpc(name:string,params:Record<string,unknown>) {
  const response=await fetch(`${base}/rest/v1/rpc/${name}`,{method:'POST',
    headers:{apikey:key!,Authorization:`Bearer ${key}`,'Content-Type':'application/json'},
    body:JSON.stringify(params)});
  if(!response.ok) throw Error('Test order database unavailable');
  return await response.json();
}
Deno.serve(paymentRuntime({Stripe,
  apiKey:Deno.env.get('STRIPE_TEST_RESTRICTED_KEY'),
  signingSecret:Deno.env.get('STRIPE_TEST_ORDERS_SIGNING_SECRET'),
  enabled:Boolean(base&&key),cryptoProvider:Stripe.createSubtleCryptoProvider(),
  loadRequest:(sessionId:string)=>rpc('qw10_test_load_request',{p_session:sessionId}),
  commitPaid:(p:any)=>rpc('qw10_test_commit_payment',{
    p_request:p.requestId,p_session:p.sessionId,p_payment:p.paymentIntentId,
    p_amount:p.amountCents,p_currency:p.currency,p_event:p.eventId}),
  commitRefund:(p:any)=>rpc('qw10_test_record_refund',{
    p_event:p.eventId,p_refund:p.refundId,p_payment:p.paymentIntentId,p_amount:p.amountCents,
    p_currency:p.currency,p_status:p.status,p_type:p.eventType,p_created:p.eventCreated,p_live:p.livemode})
}));
