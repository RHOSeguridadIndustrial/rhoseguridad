import {cardContact} from './supabase/functions/_shared/card-contact.js';
import {normalizeDeliveryAddress} from './supabase/functions/_shared/delivery-address.js';
export {cardContact};
const fail=()=>{throw Error('Invalid card response');};
export function cardSelection(items){
 const quantities=new Map();
 if(!Array.isArray(items)||!items.length||items.length>100)fail();
 for(const item of items){
  if(!/^[a-z0-9][a-z0-9-]{1,119}$/.test(item?.sku||'')||!Number.isSafeInteger(item.quantity)||item.quantity<1)fail();
  const quantity=(quantities.get(item.sku)||0)+item.quantity;if(quantity>100)fail();quantities.set(item.sku,quantity);
 }
 return [...quantities].sort(([a],[b])=>a.localeCompare(b)).map(([sku,quantity])=>({sku,quantity}));
}
export function cardInput(value){
 const address=normalizeDeliveryAddress(value?.address);if(!address)fail();
 return {paymentMethod:'card',items:cardSelection(value.items),address,contact:cardContact(value.contact)};
}
export function cardFingerprint(value){return JSON.stringify(cardInput(value));}
export function cardSummary(data,items){
 if(data?.environment!=='live'||data.currency!=='mxn'||data.paymentMethod!=='card'||!Array.isArray(data.lines))fail();
 const expected=cardSelection(items);if(data.lines.length!==expected.length)fail();
 const lines=[...data.lines].sort((a,b)=>String(a?.sku).localeCompare(String(b?.sku)));let subtotal=0;
 for(const [i,line] of lines.entries()){
  if(line?.sku!==expected[i].sku||line.quantity!==expected[i].quantity||typeof line.name!=='string'||!line.name.trim()||
   !Number.isSafeInteger(line.unitPriceCents)||line.unitPriceCents<=0||!Number.isSafeInteger(line.lineTotalCents)||
   line.lineTotalCents!==line.quantity*line.unitPriceCents)fail();
  subtotal+=line.lineTotalCents;
 }
 if(!Number.isSafeInteger(subtotal)||data.subtotalCents!==subtotal||!Number.isSafeInteger(data.shippingCents)||data.shippingCents<0||
  !Number.isSafeInteger(data.totalCents)||data.totalCents!==subtotal+data.shippingCents||!['standard','express'].includes(data.mode))fail();
 return {...data,lines};
}
export function cardDelivery(data,address){
 const d=data?.delivery,a=d?.address;
 if(d?.status!=='postal_match'||d.assurance!=='postal_catalog_only'||!/^[a-f0-9]{64}$/.test(d.catalogSha256||'')||
  typeof a?.municipality!=='string'||!a.municipality||typeof a?.settlement!=='string'||!a.settlement)fail();
 for(const [key,value] of Object.entries(address))if(a[key]!==value)fail();
 return `${a.street} ${a.exterior}${a.interior?' · Interior '+a.interior:''}, ${a.settlement}, ${a.municipality}, CP ${a.postalCode}`;
}
export function cardLink(data,expected){
 cardSummary(data,expected.items);
 const url=new URL(data.url);
 if(data.totalCents!==expected.totalCents||!/^cs_live_[A-Za-z0-9_]{1,240}$/.test(data.sessionId||'')||
  !/^[a-f0-9-]{36}$/.test(data.requestId||'')||url.origin!=='https://checkout.stripe.com'||url.username||url.password||
  url.pathname!==`/c/pay/${data.sessionId}`||!Number.isSafeInteger(data.expiresAt)||data.expiresAt*1000<=Date.now())fail();
 return url.href;
}
export function cardStatus(data){
 if(!data)return null;
 if(!/^[a-f0-9-]{36}$/.test(data.requestId||'')||data.currency!=='mxn'||!Number.isSafeInteger(data.totalCents)||data.totalCents<=0||
  !['prepared','expired','paid','reconciliation_required'].includes(data.state)||
  data.paymentStatus!==(['paid','reconciliation_required'].includes(data.state)?'paid':'unconfirmed'))fail();
 if(data.state==='paid'&&!/^[a-f0-9-]{36}$/.test(data.orderId||''))fail();
 return data;
}
