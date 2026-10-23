// Called only after Stripe SDK signature verification of the raw request body.
// commitPaid must atomically lock the checkout request, validate the reservation,
// and enforce UNIQUE(session_id) + UNIQUE(payment_intent_id) in PostgreSQL.
const successEvents = new Set(['checkout.session.completed', 'checkout.session.async_payment_succeeded']);

export async function confirmPayment(event, {retrieveSession, loadRequest, commitPaid, livemode = false}) {
  if (!event || event.livemode !== livemode) throw new Error('Payment environment mismatch');
  if (!successEvents.has(event.type)) return {status: 'ignored'};
  const eventSession = event.data?.object;
  if (eventSession?.object !== 'checkout.session' || !/^cs_[A-Za-z0-9_]+$/.test(eventSession.id || '')) {
    throw new Error('Invalid checkout session');
  }
  // Fetch authoritative current state instead of trusting a stale notification.
  const session = await retrieveSession(eventSession.id);
  if (session.id !== eventSession.id || session.livemode !== livemode || session.mode !== 'payment') {
    throw new Error('Invalid checkout state');
  }
  if (session.payment_status !== 'paid') return {status: 'pending'};
  if (typeof session.payment_intent !== 'string' || !session.payment_intent.startsWith('pi_')) {
    throw new Error('Missing payment identity');
  }
  const request = await loadRequest(session.id);
  if (!request || request.sessionId !== session.id || request.livemode !== livemode ||
      request.id !== session.metadata?.rho_request_id || request.id !== session.client_reference_id) {
    throw new Error('Checkout request mismatch');
  }
  if (!Number.isSafeInteger(request.totalCents) || request.totalCents <= 0 ||
      session.amount_total !== request.totalCents || session.currency !== 'mxn') {
    throw new Error('Payment total mismatch');
  }
  // A late payment must be recorded for reconciliation, never silently fulfilled.
  // Database adapter rechecks hold/deadline under lock; no browser clock decision.
  return await commitPaid({eventId:event.id, sessionId:session.id,
    paymentIntentId:session.payment_intent, requestId:request.id,
    amountCents:session.amount_total, currency:session.currency, livemode});
}

export function automaticShipping(subtotalCents) {
  if (!Number.isSafeInteger(subtotalCents) || subtotalCents < 0) throw new Error('Invalid subtotal');
  const shippingCents = subtotalCents >= 29900 ? 0 : 9900;
  const totalCents = subtotalCents + shippingCents;
  if (!Number.isSafeInteger(totalCents)) throw new Error('Invalid total');
  return {mode:subtotalCents > 120000 ? 'express' : 'standard', shippingCents,totalCents};
}
