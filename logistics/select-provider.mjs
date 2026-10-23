// Pure decision engine. Inputs must be loaded/verified by a trusted order service.
// A recommendation never purchases a label or books a pickup.
const cents = value => Number.isSafeInteger(value) && value >= 0;
const instant = value => Number.isSafeInteger(value) && value > 0;
const text = value => typeof value === 'string' && value.trim().length > 0;
const sum = values => values.every(cents) && cents(values.reduce((a,b)=>a+b,0))
  ? values.reduce((a,b)=>a+b,0) : null;
export function distanceBand(km) {
  if (!Number.isFinite(km) || km < 3 || km > 80) return null;
  return km <= 10 ? '3-10' : km <= 30 ? '10-30' : km <= 50 ? '30-50' : '50-80';
}
export function selectProvider(order, quotes, policy = {}, now = Date.now()) {
  const review = (reason, extra = {}) => ({status:'review_required', reason, ...extra});
  if (!order || !instant(now) || !Array.isArray(quotes) || !text(order.id) ||
      !text(order.shipmentRevision) || !['test','live'].includes(order.environment) ||
      order.currency !== 'MXN' || !cents(order.subtotalCents) || order.subtotalCents === 0 ||
      !cents(order.customerShippingCents) || !cents(order.packagingCents) ||
      !instant(order.readyAt) || !instant(order.deliveryDeadline)) return review('invalid_order');
  if (order.paymentState !== 'paid') return review('payment_not_confirmed');
  if (order.cancelled === true || order.refunded === true) return review('order_not_active');
  if (order.existingShipmentId) return {status:'already_assigned', shipmentId:order.existingShipmentId};
  if (order.packageReady !== true) return {status:'waiting_for_preparation'};
  if (order.destinationRegion !== 'MX-CMX') return review('outside_rho_coverage');
  const band = distanceBand(order.distanceKm);
  if (!band) return review('distance_out_of_range');
  if (order.deliveryDeadline <= now || order.readyAt > order.deliveryDeadline) return review('deadline_unavailable');
  const subsidyBps = policy.subsidyBps ?? 800;
  if (!Number.isInteger(subsidyBps) || subsidyBps < 0 || subsidyBps > 10000 ||
      !Number.isSafeInteger(order.subtotalCents * subsidyBps)) return review('invalid_budget_policy');
  const budgetCents = sum([order.customerShippingCents, Math.floor(order.subtotalCents * subsidyBps / 10000)]);
  if (budgetCents === null) return review('invalid_budget_policy');
  // The minimum remaining contribution is a business decision, never guessed.
  if (!cents(order.grossContributionCents) || !cents(policy.minimumRemainingContributionCents))
    return review('margin_configuration_required', {budgetCents, distanceBand:band});
  const availableCents = sum([order.grossContributionCents, order.customerShippingCents]);
  if (availableCents === null) return review('invalid_margin');
  const rejected = [], eligible = [], ids = new Set();
  for (const q of quotes) {
    let reason;
    const key = q && text(q.providerId) && text(q.id) ? JSON.stringify([q.providerId,q.id]) : null;
    if (!q || !key || ids.has(key)) reason = 'invalid_or_duplicate_quote';
    else if (q.orderId !== order.id || q.shipmentRevision !== order.shipmentRevision ||
             q.environment !== order.environment || q.currency !== 'MXN') reason = 'quote_mismatch';
    else if (!instant(q.quotedAt) || !instant(q.expiresAt) || q.quotedAt > now ||
             q.expiresAt <= now || q.expiresAt <= q.quotedAt) reason = 'quote_expired_or_invalid';
    else if (q.coverageConfirmed !== true || q.packageAccepted !== true || q.singlePackagePickup !== true)
      reason = 'service_not_eligible';
    else if (q.pickupAvailable !== true || !instant(q.pickupAt) || !instant(q.deliveryAt) ||
             q.pickupAt < Math.max(now,order.readyAt) || q.deliveryAt < q.pickupAt ||
             q.deliveryAt > order.deliveryDeadline) reason = 'deadline_or_pickup_not_met';
    else if (q.approvedForAutomaticSelection !== true || !Number.isInteger(q.completedDeliveries) ||
             q.completedDeliveries < 1 || !Number.isInteger(q.onTimeDeliveries) ||
             q.onTimeDeliveries < 0 || q.onTimeDeliveries > q.completedDeliveries)
      reason = 'provider_evaluation_required';
    else if (q.allChargesIncluded !== true || q.requiredProtectionIncluded !== true || !cents(q.totalCents))
      reason = 'incomplete_cost';
    if (key) ids.add(key);
    const totalCents = reason ? null : sum([q.totalCents, order.packagingCents]);
    if (!reason && totalCents === null) reason = 'invalid_cost';
    if (!reason && totalCents > budgetCents) reason = 'over_budget';
    if (!reason && availableCents - totalCents < policy.minimumRemainingContributionCents) reason = 'insufficient_margin';
    if (reason) {rejected.push({quoteId:q?.id ?? null,providerId:q?.providerId ?? null,reason});continue;}
    eligible.push({providerId:q.providerId,quoteId:q.id,totalCents,
      carrierCostCents:q.totalCents,deliveryAt:q.deliveryAt,pickupAt:q.pickupAt,
      onTimeRate:q.onTimeDeliveries/q.completedDeliveries,
      remainingContributionCents:availableCents-totalCents});
  }
  eligible.sort((a,b)=>a.totalCents-b.totalCents || b.onTimeRate-a.onTimeRate ||
    a.deliveryAt-b.deliveryAt || a.providerId.localeCompare(b.providerId) || a.quoteId.localeCompare(b.quoteId));
  const common = {budgetCents,distanceBand:band,rejected,eligibleCount:eligible.length};
  if (!eligible.length) return review('no_eligible_provider',common);
  return {status:'recommended',reason:'lowest_total_cost_meeting_requirements',
    orderId:order.id,shipmentRevision:order.shipmentRevision,environment:order.environment,
    selected:eligible[0],...common};
}
