import test from 'node:test';
import assert from 'node:assert/strict';
import {validateIntegrity} from '../test-integrity-model.js';
export const sample=()=>({environment:'test',scope:'own_requests',checkedAt:'2026-10-25T02:00:00Z',detailsLimited:false,
 totals:{requests:1,receipts:1,orders:0,paid:0,receiptAmountCents:12370,paidAmountCents:0,review:1,reviewAmountCents:12370,reviewNotes:1,unpaid:0,transfersWithoutReceipt:0,dispatched:0,inconsistent:0,legacyEvidence:0},
 requests:[{requestId:'fixture-review',method:'card',amountCents:12370,receiptAmountCents:12370,state:'reconciliation_required',orderId:null,receiptAt:'2026-10-24T20:00:00Z',reviewed:true,preparation:'none',issues:[],legacyEvidence:false}]});
test('retains review status even when an administrator note exists',()=>{
 const report=validateIntegrity(sample());assert.equal(report.totals.review,1);assert.equal(report.requests[0].state,'reconciliation_required');
});
test('rejects partial, wrong-environment or contradictory reports instead of showing success',()=>{
 for(const mutate of [d=>d.environment='live',d=>d.scope='all',d=>d.checkedAt='bad',d=>delete d.totals,
  d=>d.requests=[],d=>d.totals.inconsistent=1,d=>d.totals.paid=1,d=>d.detailsLimited=true,
  d=>d.requests[0].issues=['unknown'],d=>d.requests[0].requestId='<script>',d=>d.requests[0].receiptAmountCents=1,
  d=>d.requests[0].receiptAt=null,d=>d.totals.receiptAmountCents=Number.MAX_SAFE_INTEGER+1]){
  const d=sample();mutate(d);assert.throws(()=>validateIntegrity(d));
 }
});
test('negative receipt amounts can be reported as differences without hiding the incident',()=>{
 const d=sample();d.requests[0].receiptAmountCents=-1;d.requests[0].issues=['receipt_amount'];d.totals.inconsistent=1;
 d.totals.receiptAmountCents=-1;d.totals.reviewAmountCents=-1;assert.equal(validateIntegrity(d).totals.inconsistent,1);
});
