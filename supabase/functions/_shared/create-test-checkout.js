import {quoteCheckout} from './checkout-quote.js';
// Preparation only: reserve() must atomically persist an immutable quote, owner,
// retry key, hold and expiration in qw10_test; it must reject changed payloads
// under the same retry key. Never give this adapter production stock access.
function canonical(value) {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value==='object') return Object.fromEntries(Object.keys(value).sort().map(k=>[k,canonical(value[k])]));
  return value;
}
export async function createTestCheckout(input, {ownerId, retryKey, stripe,
  reserve, bindSession, loadVariant, validateCoverage}) {
  if (typeof ownerId!=='string'||!ownerId ||
      !/^[a-zA-Z0-9_-]{16,100}$/.test(retryKey||'')) throw Error('Invalid checkout identity');
  const quote=await quoteCheckout(input,{loadVariant,validateCoverage});
  // Authenticated owner comes from the server, never input.ownerId.
  const request=await reserve({ownerId,retryKey,quote,livemode:false});
  if (!request || request.livemode!==false || !/^[a-zA-Z0-9_-]{1,100}$/.test(request.id||'') ||
      request.quote?.totalCents!==quote.totalCents ||
      JSON.stringify(canonical(request.quote))!==JSON.stringify(canonical(quote)) ||
      !Number.isSafeInteger(request.expiresAt)) throw Error('Invalid test reservation');
  const params={mode:'payment',adaptive_pricing:{enabled:false},
    client_reference_id:request.id,metadata:{rho_request_id:request.id,environment:'test'},
    // One server-priced total includes shipping. Product detail stays in request.
    line_items:[{price_data:{currency:'mxn',unit_amount:quote.totalCents,
      product_data:{name:'PRUEBA RHO — carrito simulado sin entrega'}},quantity:1}],
    expires_at:request.expiresAt,success_url:'https://rhosegind.com',
    cancel_url:'https://rhosegind.com',locale:'es-419',
    integration_identifier:'rho_cart_test_qwertyui'};
  // Retry with the same immutable payload/key if the network outcome is unknown.
  // Do not release the hold on a timeout: a Stripe session might already exist.
  const session=await stripe.checkout.sessions.create(params,{idempotencyKey:`rho-test-${request.id}`});
  let url;
  try { url=new URL(session.url); } catch { throw Error('Invalid test checkout URL'); }
  if(session.livemode!==false || !/^cs_test_[a-zA-Z0-9_]+$/.test(session.id||'') ||
      session.amount_total!==quote.totalCents || session.currency!=='mxn' ||
      session.client_reference_id!==request.id || session.metadata?.rho_request_id!==request.id ||
      url.origin!=='https://checkout.stripe.com' || url.username || url.password ||
      url.pathname!==`/c/pay/${session.id}`) throw Error('Invalid test checkout');
  // This must be an atomic compare-and-set against this owner's request.
  await bindSession({requestId:request.id,ownerId,sessionId:session.id,livemode:false});
  return {environment:'test',sessionId:session.id,url:session.url,totalCents:quote.totalCents};
}
