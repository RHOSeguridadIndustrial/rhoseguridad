import {quoteCheckout} from './checkout-quote.js';
// Preparation only: reserve() must atomically persist an immutable quote, owner,
// retry key, hold and expiration in qw10_test; it must reject changed payloads
// under the same retry key. Never give this adapter production stock access.
function canonical(value) {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value==='object') return Object.fromEntries(Object.keys(value).sort().map(k=>[k,canonical(value[k])]));
  return value;
}
// Backend persistence contract only; never accept a client-supplied saved quote.
function checkoutIdentity(input) {
 if(!Array.isArray(input?.items)||input.items.length<1||input.items.length>100) throw Error('Invalid items');
 const counts=new Map();
 for(const item of input.items) {
  if(!/^[a-z0-9][a-z0-9-]{1,119}$/.test(item?.sku||'')||!Number.isSafeInteger(item.quantity)||item.quantity<1) throw Error('Invalid items');
  const n=(counts.get(item.sku)||0)+item.quantity;if(n>1000000) throw Error('Invalid quantity');counts.set(item.sku,n);
 }
 if(!input.address||typeof input.address!=='object'||Array.isArray(input.address)) throw Error('Invalid address');
 const method=input.paymentMethod ?? 'card';
 if(!['card','transfer'].includes(method)) throw Error('Invalid payment method');
 return JSON.stringify(canonical({...(method==='transfer'?{paymentMethod:method}:{}),items:[...counts].sort(([a],[b])=>a.localeCompare(b)).map(([sku,quantity])=>({sku,quantity})),address:input.address}));
}
function validateSavedQuote(quote,input) {
 if(quote?.currency!=='mxn'||!Array.isArray(quote.lines)||!quote.lines.length) throw Error('Invalid saved quote');
 let sum=0;
 for(const l of quote.lines) {
  if(!Number.isSafeInteger(l.quantity)||l.quantity<1||!Number.isSafeInteger(l.unitPriceCents)||l.unitPriceCents<=0||l.lineTotalCents!==l.quantity*l.unitPriceCents) throw Error('Invalid saved quote');
  sum+=l.lineTotalCents;
 }
 if(!Number.isSafeInteger(sum)||sum!==quote.subtotalCents||!Number.isSafeInteger(quote.shippingCents)||quote.shippingCents<0||!Number.isSafeInteger(quote.totalCents)||quote.totalCents!==sum+quote.shippingCents) throw Error('Invalid saved quote');
 if(checkoutIdentity({items:quote.lines,address:input.address,paymentMethod:input.paymentMethod})!==checkoutIdentity(input)) throw Error('Saved cart mismatch');
}
export async function createTestCheckout(input, {ownerId, retryKey, stripe,
  reserve, bindSession, loadVariant, validateCoverage, loadReservation, registered=false, now=()=>Date.now()}) {
  if (typeof ownerId!=='string'||!ownerId ||
      !/^[a-zA-Z0-9_-]{16,100}$/.test(retryKey||'')) throw Error('Invalid checkout identity');
  const identity=checkoutIdentity(input);
  const saved=loadReservation ? await loadReservation({ownerId,retryKey}) : null;
  if(saved && (saved.ownerId!==ownerId||saved.retryKey!==retryKey||saved.checkoutIdentity!==identity)) throw Error('Retry changed');
  let quote=saved?.quote || await quoteCheckout(input,{loadVariant,validateCoverage,registered});
  if(saved) validateSavedQuote(quote,input);
  // Authenticated owner comes from the server, never input.ownerId.
  const request=saved || await reserve({ownerId,retryKey,quote,checkoutIdentity:identity,livemode:false});
  // A concurrent first attempt can commit the frozen quote between lookup and
  // reserve. Adopt only a backend result bound to this exact owner and input.
  if(loadReservation && request) {
    if(request.ownerId!==ownerId || request.retryKey!==retryKey || request.checkoutIdentity!==identity) throw Error('Retry changed');
    validateSavedQuote(request.quote,input);
    quote=request.quote;
  }
  if (!request || request.livemode!==false || !/^[a-zA-Z0-9_-]{1,100}$/.test(request.id||'') ||
      request.quote?.totalCents!==quote.totalCents ||
      JSON.stringify(canonical(request.quote))!==JSON.stringify(canonical(quote)) ||
      !Number.isSafeInteger(request.expiresAt) || request.expiresAt*1000<=now()) throw Error('Invalid test reservation');
  const summary={currency:quote.currency,lines:quote.lines,subtotalCents:quote.subtotalCents,
    shippingCents:quote.shippingCents,mode:quote.mode,coupon:quote.coupon ?? null,expiresAt:request.expiresAt};
  if((input.paymentMethod ?? 'card')==='transfer') {
    if(quote.paymentMethod!=='transfer') throw Error('Payment method mismatch');
    return {environment:'test',paymentMethod:'transfer',requestId:request.id,reference:`TEST-${request.id}`,status:'awaiting_test_transfer',totalCents:quote.totalCents,...summary};
  }
  const params={mode:'payment',adaptive_pricing:{enabled:false},
    client_reference_id:request.id,metadata:{rho_request_id:request.id,environment:'test'},
    // One server-priced total includes shipping. Product detail stays in request.
    line_items:[{price_data:{currency:'mxn',unit_amount:quote.totalCents,
      product_data:{name:'PRUEBA RHO — carrito simulado sin entrega'}},quantity:1}],
    expires_at:request.expiresAt,success_url:'https://rhosegind.com/confirmacion-prueba.html?session_id={CHECKOUT_SESSION_ID}',
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
  return {environment:'test',paymentMethod:'card',sessionId:session.id,url:session.url,totalCents:quote.totalCents,...summary};
}

