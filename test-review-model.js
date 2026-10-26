export const reviewReasons=Object.freeze({reservation_expired:'La reserva venció antes de confirmar el pago.',reservation_inactive:'La reserva ya no estaba activa.',empty_request:'La solicitud no tenía artículos para preparar.',stock_unavailable:'Las existencias disponibles no cubrían la solicitud.',legacy_review_required:'El registro anterior requiere revisión manual.'});
export function validateReviewCases(data){
 if(data?.environment!=='test'||!Array.isArray(data.cases)||data.cases.length>100)throw Error('Invalid review list');
 const ids=new Set();
 for(const c of data.cases){
  if(typeof c.request_id!=='string'||!/^[A-Za-z0-9_-]{1,100}$/.test(c.request_id)||ids.has(c.request_id)||
   typeof c.session_id!=='string'||!/^(cs_test_[A-Za-z0-9_]{1,250}|tr_test_[a-f0-9]{32})$/.test(c.session_id)||
   !Number.isSafeInteger(c.amount_cents)||c.amount_cents<=0||
   !Object.hasOwn(reviewReasons,c.reason)||typeof c.reviewed!=='boolean'||!Number.isFinite(Date.parse(c.recorded_at))||
   !Array.isArray(c.items)||c.items.length>100||c.items.some(i=>!/^[a-z0-9][a-z0-9-]{1,119}$/.test(i.sku)||!Number.isSafeInteger(i.quantity)||i.quantity<1)||
   (c.reviewed&&(typeof c.note!=='string'||c.note.length>500||!Number.isFinite(Date.parse(c.reviewed_at)))))throw Error('Invalid review case');
  if(c.resolution!==undefined){
   const r=c.resolution;
   if(!r||!['refunded','unresolved'].includes(r.state)||typeof r.limited!=='boolean'||!Array.isArray(r.refunds)||r.refunds.length>100)throw Error('Invalid resolution');
   const refunds=new Set();
   for(const f of r.refunds){
    if(!/^re_[A-Za-z0-9_]{1,250}$/.test(f.refund_id||'')||refunds.has(f.refund_id)||!/^evt_[A-Za-z0-9_]{1,250}$/.test(f.event_id||'')||
     !Number.isSafeInteger(f.amount_cents)||f.amount_cents<=0||!/^[a-z]{3}$/.test(f.currency||'')||!['pending','requires_action','succeeded','failed','canceled'].includes(f.status)||
     !Number.isSafeInteger(f.event_created)||f.event_created<1577836800||!Number.isFinite(Date.parse(f.recorded_at)))throw Error('Invalid refund');
    refunds.add(f.refund_id);
   }
   if(r.state==='refunded'&&(r.limited||r.refunds.length!==1||r.refunds[0].status!=='succeeded'||r.refunds[0].currency!=='mxn'||r.refunds[0].amount_cents!==c.amount_cents))throw Error('Invalid refund resolution');
  }
  ids.add(c.request_id);
 }
 return data.cases;
}
