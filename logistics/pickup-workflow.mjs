// Server-side state machine. Caller must authenticate events, lock the job and
// persist the returned state atomically. This module performs no carrier calls.
export const RHO_ORIGIN = Object.freeze({street:'Av. 16 de Septiembre',number:'197',
 neighborhood:'Santa Inés',municipality:'Azcapotzalco',postalCode:'02140',region:'MX-CMX',country:'MX'});
const nonempty = x => typeof x === 'string' && x.trim().length > 0;
export function shipmentDataIssues(data) {
 const issues=[];
 const d=data?.destination;
 if(!d || !['street','number','neighborhood','municipality','recipient','phone'].every(k=>nonempty(d[k])) ||
    !/^\d{5}$/.test(d.postalCode||'')) issues.push('incomplete_destination');
 if(d?.region!=='MX-CMX' || d?.country!=='MX') issues.push('outside_rho_coverage');
 const p=data?.package;
 if(!p || !['weightKg','lengthCm','widthCm','heightCm'].every(k=>Number.isFinite(p[k])&&p[k]>0))
   issues.push('package_measurements_required');
 const r=data?.route;
 if(!r || r.verified!==true || !nonempty(r.source) || !Number.isFinite(r.distanceKm) || r.distanceKm<3 || r.distanceKm>80)
   issues.push('verified_route_required');
 return issues;
}
export function newPickupJob({orderId,revision,environment}) {
 if(![orderId,revision].every(nonempty)||!['test','live'].includes(environment)) throw Error('Invalid job identity');
 return {key:JSON.stringify([environment,orderId,revision]),orderId,revision,environment,
   status:'waiting_payment',seenEvents:[],labelId:null,pickupId:null};
}
// Events must be derived from trusted payment/order/carrier records, never from
// browser booleans. One database unique key per environment/order/revision.
export function advancePickup(job,event) {
 if(!job || !nonempty(event?.id) || event.orderId!==job.orderId || event.revision!==job.revision || event.environment!==job.environment)
   throw Error('Event identity mismatch');
 if(job.seenEvents.includes(event.id)) return job;
 const next={...job,seenEvents:[...job.seenEvents,event.id]};
 const requireState=(...states)=>{if(!states.includes(job.status)) throw Error('Invalid pickup transition');};
 switch(event.type) {
 case 'payment_confirmed':
   requireState('waiting_payment');next.status='waiting_preparation';break;
 case 'package_prepared': {
   requireState('waiting_preparation','review_required');
   if(job.labelId || job.operationKey) throw Error('Existing carrier operation requires reconciliation');
   const issues=shipmentDataIssues(event.shipment);
   next.status=issues.length?'review_required':'ready_to_quote';next.issues=issues;break;
 }
 case 'quote_selected': {
   requireState('ready_to_quote');const d=event.decision;
   if(d?.status!=='recommended'||d.orderId!==job.orderId||d.shipmentRevision!==job.revision||d.environment!==job.environment||
      !nonempty(d.selected?.providerId)||!nonempty(d.selected?.quoteId)) throw Error('Invalid selection');
   next.selection=structuredClone(d.selected);next.status='ready_to_book';break;
 }
 case 'booking_started':
   requireState('ready_to_book');
   // Persist this state BEFORE sending a request. A crash must not resend it.
   next.operationKey=JSON.stringify([job.key,'label']);next.status='booking_pending';break;
 case 'label_confirmed':
   requireState('booking_pending','booking_unknown');
   if(!nonempty(event.labelId)||event.providerId!==job.selection.providerId) throw Error('Invalid label');
   next.labelId=event.labelId;next.status='ready_to_request_pickup';break;
 case 'booking_uncertain':
   requireState('booking_pending');next.status='booking_unknown';break;
 case 'pickup_started':
   requireState('ready_to_request_pickup');
   next.operationKey=JSON.stringify([job.key,'pickup',job.labelId]);next.status='pickup_pending';break;
 case 'pickup_uncertain':
   requireState('pickup_pending');next.status='pickup_unknown';break;
 case 'pickup_confirmed':
   requireState('pickup_pending','pickup_unknown');
   if(!nonempty(event.pickupId)||event.labelId!==job.labelId||event.providerId!==job.selection.providerId) throw Error('Invalid pickup');
   next.pickupId=event.pickupId;next.status='pickup_scheduled';break;
 case 'order_cancelled':
   if(job.status==='cancelled') break;
   next.status=job.operationKey?'cancellation_review':'cancelled';break;
 default: throw Error('Unknown pickup event');
 }
 return next;
}
