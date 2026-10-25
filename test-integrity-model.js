export const integrityIssues=Object.freeze({
 receipt_amount:'El importe del recibo no coincide con la solicitud.',
 receipt_session:'La sesión del recibo no coincide con la solicitud.',
 paid_without_order:'Hay un recibo pagado sin orden.',
 order_without_paid_receipt:'Hay una orden sin recibo pagado.',
 order_session:'La sesión de la orden no coincide con su recibo.',
 movement_mismatch:'Los movimientos no corresponden exactamente a los artículos pagados.',
 unpaid_movement:'Hay movimientos sin recibo pagado.',
 unpaid_preparation:'Hay preparación o salida sin una orden pagada.',
 dispatch_sequence:'La salida no tiene una preparación previa válida.',
 paid_hold_active:'La reserva sigue activa después de registrar el recibo.',
 event_mismatch:'El evento de auditoría no coincide con el recibo.',
 quote_total:'La cotización guardada no coincide con el total de la solicitud.'
});
const counts=['requests','receipts','orders','paid','review','reviewNotes','unpaid','transfersWithoutReceipt','dispatched','inconsistent','legacyEvidence'];
const amounts=['receiptAmountCents','paidAmountCents','reviewAmountCents'];
export function validateIntegrity(data){
 const bad=()=>{throw Error('Invalid integrity report');};
 if(data?.environment!=='test'||data.scope!=='own_requests'||!Number.isFinite(Date.parse(data.checkedAt))||
  !Array.isArray(data.requests)||data.requests.length>100||typeof data.detailsLimited!=='boolean'||!data.totals)bad();
 const t=data.totals;
 if(counts.some(k=>!Number.isSafeInteger(t[k])||t[k]<0)||amounts.some(k=>!Number.isSafeInteger(t[k]))||
  t.requests!==t.paid+t.review+t.unpaid||t.receipts!==t.paid+t.review||
  t.receiptAmountCents!==t.paidAmountCents+t.reviewAmountCents||
  t.orders>t.requests||t.reviewNotes>t.review||t.transfersWithoutReceipt>t.unpaid||
  t.dispatched>t.requests||t.inconsistent>t.requests||t.legacyEvidence>t.receipts||
  data.detailsLimited!==(t.requests>100)||data.requests.length!==Math.min(100,t.requests))bad();
 const ids=new Set();
 for(const r of data.requests){
  if(!/^[A-Za-z0-9_-]{1,100}$/.test(r?.requestId||'')||ids.has(r.requestId)||
   !['card','transfer','unknown'].includes(r.method)||!['paid','reconciliation_required','awaiting_payment'].includes(r.state)||
   !Number.isSafeInteger(r.amountCents)||r.amountCents<=0||
   (r.receiptAmountCents!==null&&!Number.isSafeInteger(r.receiptAmountCents))||
   (r.orderId!==null&&(!Number.isSafeInteger(r.orderId)||r.orderId<1))||
   (r.receiptAt!==null&&!Number.isFinite(Date.parse(r.receiptAt)))||
   (r.state==='awaiting_payment'?(r.receiptAmountCents!==null||r.receiptAt!==null):(r.receiptAmountCents===null||r.receiptAt===null))||
   !['none','pending','prepared','dispatched'].includes(r.preparation)||typeof r.reviewed!=='boolean'||typeof r.legacyEvidence!=='boolean'||
   !Array.isArray(r.issues)||r.issues.some(i=>!Object.hasOwn(integrityIssues,i))||new Set(r.issues).size!==r.issues.length)bad();
  ids.add(r.requestId);
 }
 // For a complete detail list, independently reject contradictory aggregate replies.
 if(!data.detailsLimited){
  const sum=(fn)=>data.requests.reduce((n,r)=>n+fn(r),0);
  const computed={requests:data.requests.length,receipts:sum(r=>Number(r.state!=='awaiting_payment')),
   orders:sum(r=>Number(r.orderId!==null)),paid:sum(r=>Number(r.state==='paid')),
   review:sum(r=>Number(r.state==='reconciliation_required')),unpaid:sum(r=>Number(r.state==='awaiting_payment')),
   reviewNotes:sum(r=>Number(r.state==='reconciliation_required'&&r.reviewed)),
   transfersWithoutReceipt:sum(r=>Number(r.method==='transfer'&&r.state==='awaiting_payment')),
   dispatched:sum(r=>Number(r.preparation==='dispatched')),inconsistent:sum(r=>Number(r.issues.length>0)),
   legacyEvidence:sum(r=>Number(r.legacyEvidence)),receiptAmountCents:sum(r=>r.receiptAmountCents??0),
   paidAmountCents:sum(r=>r.state==='paid'?r.receiptAmountCents:0),reviewAmountCents:sum(r=>r.state==='reconciliation_required'?r.receiptAmountCents:0)};
  if(Object.keys(computed).some(k=>computed[k]!==t[k]))bad();
 }
 return data;
}
