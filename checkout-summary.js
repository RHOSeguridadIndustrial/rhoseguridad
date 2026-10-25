// Display only: prices and eligibility must come from the authenticated server.
// Reject inconsistent/stale responses before exposing a payment link.
export function checkoutSummary(data, items) {
 const invalid=()=>{throw Error('Invalid checkout summary');};
 if(data?.environment!=='test'||data.currency!=='mxn'||!Array.isArray(data.lines)||
   data.lines.length<1||data.lines.length>100||!Array.isArray(items)||!items.length)invalid();
 const expected=new Map();
 for(const item of items){
  if(typeof item?.sku!=='string'||!Number.isSafeInteger(item.quantity)||item.quantity<1)invalid();
  const quantity=(expected.get(item.sku)||0)+item.quantity;
  if(!Number.isSafeInteger(quantity))invalid();expected.set(item.sku,quantity);
 }
 let subtotal=0;const seen=new Set();
 const lines=data.lines.map(line=>{
  if(!line||typeof line.name!=='string'||!line.name.trim()||seen.has(line.sku)||
    !Number.isSafeInteger(line.quantity)||line.quantity<1||expected.get(line.sku)!==line.quantity||
    !Number.isSafeInteger(line.unitPriceCents)||line.unitPriceCents<=0||
    !Number.isSafeInteger(line.lineTotalCents)||line.lineTotalCents!==line.quantity*line.unitPriceCents)invalid();
  seen.add(line.sku);subtotal+=line.lineTotalCents;
  if(!Number.isSafeInteger(subtotal))invalid();
  return {sku:line.sku,name:line.name,quantity:line.quantity,unitPriceCents:line.unitPriceCents,lineTotalCents:line.lineTotalCents};
 });
 if(seen.size!==expected.size||data.subtotalCents!==subtotal||
   !Number.isSafeInteger(data.shippingCents)||data.shippingCents<0||
   !Number.isSafeInteger(data.totalCents)||data.totalCents!==subtotal+data.shippingCents||
   !['standard','express'].includes(data.mode)||
   !Number.isSafeInteger(data.expiresAt)||data.expiresAt<=0||
   !Number.isFinite(new Date(data.expiresAt*1000).getTime()))invalid();
 if(data.coupon!=null && (typeof data.coupon.applied!=='boolean'||
   (data.coupon.applied && (data.coupon.registered!==true||data.shippingCents!==0))))invalid();
 return {lines,subtotalCents:subtotal,shippingCents:data.shippingCents,totalCents:data.totalCents,
  mode:data.mode,couponApplied:data.coupon?.applied??null,expiresAt:data.expiresAt};
}
