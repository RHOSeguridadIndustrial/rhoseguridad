// Receives only an event authenticated by the Stripe SDK over the raw body.
// The event carries livemode; the Refund object has no livemode field.
export const refundEvents=new Set(['refund.created','refund.updated','refund.failed']);
const states=new Set(['pending','requires_action','succeeded','failed','canceled']);
export async function recordRefund(event,{commitRefund}) {
 const r=event?.data?.object;
 if(event?.livemode!==false||!refundEvents.has(event.type)||!/^evt_[A-Za-z0-9_]{1,250}$/.test(event.id||'')||
  !Number.isSafeInteger(event.created)||event.created<1577836800||event.created>Math.floor(Date.now()/1000)+300||
  r?.object!=='refund'||!/^re_[A-Za-z0-9_]{1,250}$/.test(r.id||'')||
  !/^pi_[A-Za-z0-9_]{1,250}$/.test(r.payment_intent||'')||
  !Number.isSafeInteger(r.amount)||r.amount<=0||!/^[a-z]{3}$/.test(r.currency||'')||
  !states.has(r.status)||(event.type==='refund.failed'&&r.status!=='failed')||typeof commitRefund!=='function')throw Error('Invalid refund evidence');
 return commitRefund({eventId:event.id,refundId:r.id,paymentIntentId:r.payment_intent,amountCents:r.amount,
  currency:r.currency,status:r.status,eventType:event.type,eventCreated:event.created,livemode:false});
}
