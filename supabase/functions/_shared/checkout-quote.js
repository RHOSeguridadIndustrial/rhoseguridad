import {automaticShipping} from './payment-confirmation.js';

// Server-only pricing preparation. This snapshot is NOT a stock reservation.
// The persistence adapter must recheck these variants under shared inventory locks.
export async function quoteCheckout(input,{loadVariant,validateCoverage}) {
  if (!Array.isArray(input?.items) || input.items.length<1 || input.items.length>100)
    throw Error('Invalid items');
  const quantities=new Map();
  for (const item of input.items) {
    if (!item || typeof item.sku!=='string' || !/^[a-z0-9][a-z0-9-]{1,119}$/.test(item.sku) ||
      !Number.isSafeInteger(item.quantity) || item.quantity<1 || item.quantity>1000000)
      throw Error('Invalid variant or quantity');
    const quantity=(quantities.get(item.sku)||0)+item.quantity;
    if (quantity>1000000) throw Error('Invalid quantity');
    quantities.set(item.sku,quantity);
  }
  // Coverage must come from a trusted server-side address/postal-code check.
  if (await validateCoverage(input.address)!==true) throw Error('Outside delivery coverage');
  const lines=[];let subtotalCents=0;
  for (const [sku,quantity] of [...quantities].sort(([a],[b])=>a.localeCompare(b))) {
    const variant=await loadVariant(sku);
    if (!variant || variant.sku!==sku || variant.active!==true ||
      typeof variant.name!=='string' || !variant.name.trim() ||
      !Number.isSafeInteger(variant.priceCents) || variant.priceCents<=0)
      throw Error('Unavailable catalog variant');
    const lineTotalCents=variant.priceCents*quantity;
    subtotalCents+=lineTotalCents;
    if (!Number.isSafeInteger(lineTotalCents) || !Number.isSafeInteger(subtotalCents))
      throw Error('Invalid total');
    lines.push({sku,name:variant.name,quantity,unitPriceCents:variant.priceCents,lineTotalCents});
  }
  return {currency:'mxn',lines,subtotalCents,...automaticShipping(subtotalCents)};
}
