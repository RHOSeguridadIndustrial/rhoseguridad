export const freeShippingThresholdCents = 29900;
export const standardShippingCents = 9900;

// Destination coverage must still be validated by the order service.
export function shippingForSubtotal(subtotalCents, mode = 'standard') {
  if (!Number.isSafeInteger(subtotalCents) || subtotalCents < 0)
    return {status:'blocked', shippingCents:null, totalCents:null};
  if (mode === 'express') {
    if (subtotalCents <= 120000)
      return {status:'blocked', shippingCents:null, totalCents:null};
    return {status:'free', shippingCents:0, totalCents:subtotalCents};
  }
  if (mode !== 'standard')
    return {status:'blocked', shippingCents:null, totalCents:null};
  if (subtotalCents >= freeShippingThresholdCents)
    return {status:'free', shippingCents:0, totalCents:subtotalCents};
  const totalCents = subtotalCents + standardShippingCents;
  if (!Number.isSafeInteger(totalCents))
    return {status:'blocked', shippingCents:null, totalCents:null};
  return {status:'standard', shippingCents:standardShippingCents, totalCents};
}
