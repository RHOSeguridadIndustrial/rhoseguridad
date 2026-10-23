export const reviewReasons=Object.freeze({reservation_expired:'La reserva venció antes de confirmar el pago.',reservation_inactive:'La reserva ya no estaba activa.',empty_request:'La solicitud no tenía artículos para preparar.',stock_unavailable:'Las existencias disponibles no cubrían la solicitud.',legacy_review_required:'El registro anterior requiere revisión manual.'});
export function validateReviewCases(data){
 if(data?.environment!=='test'||!Array.isArray(data.cases)||data.cases.length>100)throw Error('Invalid review list');
 const ids=new Set();
 for(const c of data.cases){
  if(typeof c.request_id!=='string'||!/^[A-Za-z0-9_-]{1,100}$/.test(c.request_id)||ids.has(c.request_id)||
   typeof c.session_id!=='string'||!/^cs_test_[A-Za-z0-9_]{1,250}$/.test(c.session_id)||
   !Number.isSafeInteger(c.amount_cents)||c.amount_cents<=0||
   !Object.hasOwn(reviewReasons,c.reason)||typeof c.reviewed!=='boolean'||!Number.isFinite(Date.parse(c.recorded_at))||
   !Array.isArray(c.items)||c.items.length>100||c.items.some(i=>!/^[a-z0-9][a-z0-9-]{1,119}$/.test(i.sku)||!Number.isSafeInteger(i.quantity)||i.quantity<1)||
   (c.reviewed&&(typeof c.note!=='string'||c.note.length>500||!Number.isFinite(Date.parse(c.reviewed_at)))))throw Error('Invalid review case');
  ids.add(c.request_id);
 }
 return data.cases;
}
