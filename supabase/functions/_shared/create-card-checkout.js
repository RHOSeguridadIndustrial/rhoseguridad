// Server-only production preparation. This module is not a deployed endpoint.
// Persistence callbacks MUST use the operational database under shared SKU locks;
// never wire them to qw10_test. See docs/qw10-live-checkout-contract.md.
import {normalizeDeliveryAddress} from './delivery-address.js';
import {shippingCoupon} from './shipping-coupon.js';

const canonical = value => Array.isArray(value) ? value.map(canonical) :
  value && typeof value === 'object' ? Object.fromEntries(Object.keys(value).sort().map(k => [k,canonical(value[k])])) : value;
const same = (a,b) => JSON.stringify(canonical(a)) === JSON.stringify(canonical(b));
const validId = value => typeof value === 'string' && /^[a-zA-Z0-9_-]{16,100}$/.test(value);

function cartInput(input) {
  if (!input || input.paymentMethod !== 'card' || !Array.isArray(input.items) ||
      input.items.length < 1 || input.items.length > 100) throw Error('Invalid card cart');
  const quantities = new Map();
  for (const line of input.items) {
    if (!/^[a-z0-9][a-z0-9-]{1,119}$/.test(line?.sku || '') ||
        !Number.isSafeInteger(line.quantity) || line.quantity < 1) throw Error('Invalid card item');
    const quantity = (quantities.get(line.sku) || 0) + line.quantity;
    // Operational order_items currently permits at most 100 units per SKU.
    if (!Number.isSafeInteger(quantity) || quantity > 100) throw Error('Invalid card quantity');
    quantities.set(line.sku,quantity);
  }
  const address = normalizeDeliveryAddress(input.address);
  if (!address) throw Error('Invalid card delivery');
  return {paymentMethod:'card',address,items:[...quantities].sort(([a],[b])=>a.localeCompare(b))
    .map(([sku,quantity])=>({sku,quantity}))};
}

function validateQuote(quote, cart) {
  if (quote?.currency !== 'mxn' || quote.paymentMethod !== 'card' ||
      !Array.isArray(quote.lines) || quote.lines.length !== cart.items.length ||
      quote.delivery?.status !== 'postal_match' || quote.delivery.assurance !== 'postal_catalog_only' ||
      !/^[a-f0-9]{64}$/.test(quote.delivery.catalogSha256 || '')) throw Error('Invalid card quote');
  const delivery = quote.delivery.address;
  if (!same(cart.address,Object.fromEntries(Object.keys(cart.address).map(k=>[k,delivery?.[k]]))))
    throw Error('Card delivery mismatch');
  let subtotal = 0;
  for (const [i,line] of [...quote.lines].sort((a,b)=>a.sku.localeCompare(b.sku)).entries()) {
    if (line.sku !== cart.items[i].sku || line.quantity !== cart.items[i].quantity ||
        typeof line.name !== 'string' || !line.name.trim() ||
        !Number.isSafeInteger(line.unitPriceCents) || line.unitPriceCents <= 0 ||
        !Number.isSafeInteger(line.lineTotalCents) || line.lineTotalCents !== line.quantity * line.unitPriceCents)
      throw Error('Card quote lines mismatch');
    subtotal += line.lineTotalCents;
  }
  const shipping = shippingCoupon({subtotalCents:subtotal,registered:true,paymentMethod:'card',coverage:'cdmx'});
  if (!Number.isSafeInteger(subtotal) || subtotal !== quote.subtotalCents || shipping.status === 'pending' ||
      quote.shippingCents !== shipping.shippingCents || quote.totalCents !== shipping.totalCents ||
      !Number.isSafeInteger(quote.totalCents) || quote.mode !== shipping.mode)
    throw Error('Card quote total mismatch');
}

// An authenticated, active registered customer is a precondition of the adapter.
// expectedTotalCents is the amount accepted in the UI; it is NEVER the price source.
export async function createCardCheckout(input, {enabled = false, ownerId, retryKey, stripe,
  quoteBuilder, loadReservation, reserve, bindSession, now = ()=>Date.now()}) {
  if (enabled !== true) throw Error('Card checkout disabled');
  if (!validId(ownerId) || !validId(retryKey) ||
      [quoteBuilder,loadReservation,reserve,bindSession].some(fn=>typeof fn !== 'function') ||
      typeof stripe?.checkout?.sessions?.create !== 'function') throw Error('Card checkout not configured');
  if (!Number.isSafeInteger(input?.expectedTotalCents) || input.expectedTotalCents <= 0)
    throw Error('Card total acceptance required');
  const cart = cartInput(input);
  const identity = JSON.stringify(canonical(cart));
  const checkRequest = request => {
    if (!request || request.environment !== 'live' || request.livemode !== true ||
        request.integrationVersion !== 'card-checkout-v1' || !validId(request.id) ||
        request.ownerId !== ownerId || request.retryKey !== retryKey || request.checkoutIdentity !== identity ||
        !Number.isSafeInteger(request.expiresAt) || request.expiresAt * 1000 <= now())
      throw Error('Invalid live reservation');
    validateQuote(request.quote,cart);
    if (request.quote.totalCents !== input.expectedTotalCents) throw Error('Card total changed');
  };
  let request = await loadReservation({ownerId,retryKey});
  if (request) checkRequest(request);
  else {
    const quote = await quoteBuilder(cart);
    validateQuote(quote,cart);
    if (quote.totalCents !== input.expectedTotalCents) throw Error('Card total changed');
    // reserve rechecks price/stock under lock; retries return the frozen snapshot.
    request = await reserve({ownerId,retryKey,quote,checkoutIdentity:identity,
      environment:'live',livemode:true,integrationVersion:'card-checkout-v1'});
    checkRequest(request);
    if (!same(quote,request.quote)) throw Error('Card quote changed during reservation');
  }
  const quote = request.quote;
  const params = {mode:'payment',ui_mode:'hosted_page',adaptive_pricing:{enabled:false},
    client_reference_id:request.id,metadata:{rho_request_id:request.id,environment:'live'},
    expires_at:request.expiresAt,billing_address_collection:'auto',phone_number_collection:{enabled:false},
    automatic_tax:{enabled:false},allow_promotion_codes:false,submit_type:'auto',
    line_items:[{price_data:{currency:'mxn',unit_amount:quote.totalCents,
      product_data:{name:'RHO Seguridad Industrial — pedido con envío'}},quantity:1}],
    success_url:'https://rhosegind.com/pago-exitoso.html?session_id={CHECKOUT_SESSION_ID}',
    cancel_url:'https://rhosegind.com/carrito.html?payment=cancelled',
    integration_identifier:'hosted_web_0001',origin_context:'web'};
  // Do not release the hold on a network timeout: a session may already exist.
  const session = await stripe.checkout.sessions.create(params,{idempotencyKey:`rho-live-${request.id}`});
  let url;
  try {url = new URL(session.url);} catch {throw Error('Invalid live checkout URL');}
  if (session.livemode !== true || !/^cs_live_[a-zA-Z0-9_]+$/.test(session.id || '') ||
      session.status !== 'open' || session.mode !== 'payment' || session.payment_status !== 'unpaid' ||
      session.amount_total !== quote.totalCents || session.currency !== 'mxn' ||
      session.client_reference_id !== request.id || session.metadata?.rho_request_id !== request.id ||
      session.metadata?.environment !== 'live' || session.expires_at !== request.expiresAt ||
      url.origin !== 'https://checkout.stripe.com' || url.username || url.password ||
      url.pathname !== `/c/pay/${session.id}`) throw Error('Invalid live checkout');
  // Atomic compare-and-set; only successful persistence permits a redirect.
  await bindSession({requestId:request.id,ownerId,sessionId:session.id,livemode:true});
  return {environment:'live',paymentMethod:'card',requestId:request.id,sessionId:session.id,url:session.url,
    currency:'mxn',lines:quote.lines,subtotalCents:quote.subtotalCents,shippingCents:quote.shippingCents,
    totalCents:quote.totalCents,mode:quote.mode,expiresAt:request.expiresAt};
}
