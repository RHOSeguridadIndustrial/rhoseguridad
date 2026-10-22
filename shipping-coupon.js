// Preview only. The order service must independently verify identity, coverage,
// catalog prices, availability and payment method before any payment is created.
export function shippingCoupon({subtotalCents, registered = false, paymentMethod = '', coverage = 'unknown', specialOrder = false}) {
  const pending = reason => ({status:'pending', reason, shippingCents:null, totalCents:null});
  if (!Number.isSafeInteger(subtotalCents) || subtotalCents <= 0) return pending('invalid');
  if (specialOrder) return pending('special');
  if (coverage !== 'cdmx') return pending('coverage');
  if (!['card','transfer'].includes(paymentMethod)) return pending('payment');
  if (subtotalCents < 29900) return {status:'paid', mode:'standard', shippingCents:9900, totalCents:subtotalCents+9900};
  if (registered !== true) return pending('registration');
  return {status:'eligible', mode:subtotalCents > 120000 ? 'express' : 'standard', shippingCents:0, totalCents:subtotalCents};
}
