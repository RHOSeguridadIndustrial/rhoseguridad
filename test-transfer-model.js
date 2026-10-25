export function transferAmount(value){
 if(typeof value!=='string'||!/^\d{1,12}(\.\d{1,2})?$/.test(value.trim()))throw Error('Invalid amount');
 const [whole,decimal='']=value.trim().split('.'),cents=Number(whole)*100+Number(decimal.padEnd(2,'0'));
 if(!Number.isSafeInteger(cents)||cents<=0)throw Error('Invalid amount');return cents;
}
const id=v=>typeof v==='string'&&/^[A-Za-z0-9_-]{1,100}$/.test(v);
export function transferRecord(r){
 if(!r||!id(r.requestId)||!Number.isSafeInteger(r.totalCents)||r.totalCents<=0||!Number.isSafeInteger(r.expiresAt)||r.expiresAt<=0||typeof r.expired!=='boolean'||
  !['awaiting_confirmation','paid','reconciliation_required'].includes(r.state)||!['none','pending','prepared','dispatched'].includes(r.preparation)||
  (r.orderId!==null&&(!Number.isSafeInteger(r.orderId)||r.orderId<=0)))throw Error('Invalid record');
 if(r.state==='awaiting_confirmation'){
  if(r.receiptReference!==null||r.recordedAt!==null||r.orderId!==null||r.preparation!=='none')throw Error('Invalid pending');
 }else{
  if(!/^BANKTEST-[A-Z0-9-]{8,64}$/.test(r.receiptReference||'')||typeof r.recordedAt!=='string'||!Number.isFinite(Date.parse(r.recordedAt)))throw Error('Invalid receipt');
  if(r.state==='paid'?(r.orderId===null||r.preparation==='none'):(r.orderId!==null||r.preparation!=='none'))throw Error('Invalid outcome');
 }
 if(!Array.isArray(r.items)||r.items.length<1||r.items.length>100)throw Error('Invalid items');
 const seen=new Set();let subtotal=0;
 for(const l of r.items){
  if(!/^[a-z0-9][a-z0-9-]{1,119}$/.test(l?.sku||'')||seen.has(l.sku)||typeof l.name!=='string'||!l.name.trim()||l.name.length>500||
   !Number.isSafeInteger(l.quantity)||l.quantity<1||l.quantity>1000000||!Number.isSafeInteger(l.unitPriceCents)||l.unitPriceCents<=0||!Number.isSafeInteger(l.lineTotalCents)||l.lineTotalCents!==l.quantity*l.unitPriceCents)throw Error('Invalid line');
  seen.add(l.sku);subtotal+=l.lineTotalCents;
 }
 if(!Number.isSafeInteger(subtotal)||subtotal>r.totalCents)throw Error('Invalid total');return r;
}
export function transferList(data){
 if(data?.environment!=='test'||typeof data.limited!=='boolean'||!Array.isArray(data.transfers)||data.transfers.length>100)throw Error('Invalid report');
 const seen=new Set();for(const r of data.transfers){transferRecord(r);if(seen.has(r.requestId))throw Error('Duplicate request');seen.add(r.requestId);}return data;
}
