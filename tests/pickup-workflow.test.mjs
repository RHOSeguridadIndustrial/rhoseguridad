import test from 'node:test';
import assert from 'node:assert/strict';
import {newPickupJob,advancePickup,shipmentDataIssues,RHO_ORIGIN} from '../logistics/pickup-workflow.mjs';
const identity={orderId:'order-1',revision:'r1',environment:'test'};
const shipment={destination:{...RHO_ORIGIN,recipient:'Prueba',phone:'5555555555'},
 package:{weightKg:1,lengthCm:20,widthCm:15,heightCm:10},route:{verified:true,source:'fixture',distanceKm:10}};
const decision={status:'recommended',orderId:'order-1',shipmentRevision:'r1',environment:'test',
 selected:{providerId:'synthetic',quoteId:'q1',totalCents:1000}};
const event=(type,extra={})=>({...identity,id:type,type,...extra});
function ready(){let j=newPickupJob(identity);for(const e of [event('payment_confirmed'),event('package_prepared',{shipment}),event('quote_selected',{decision})])j=advancePickup(j,e);return j;}
test('paid and prepared order reaches confirmed pickup with distinct keys',()=>{
 let j=ready();j=advancePickup(j,event('booking_started'));const labelKey=j.operationKey;
 j=advancePickup(j,event('label_confirmed',{providerId:'synthetic',labelId:'label-1'}));
 j=advancePickup(j,event('pickup_started'));assert.notEqual(j.operationKey,labelKey);
 j=advancePickup(j,event('pickup_confirmed',{providerId:'synthetic',labelId:'label-1',pickupId:'pickup-1'}));
 assert.equal(j.status,'pickup_scheduled');assert.equal(j.labelId,'label-1');
});
test('duplicate payment is a no-op and unpaid order cannot book',()=>{
 const j=advancePickup(newPickupJob(identity),event('payment_confirmed'));
 assert.equal(advancePickup(j,event('payment_confirmed')),j);
 assert.throws(()=>advancePickup(newPickupJob(identity),event('booking_started')));
});
test('postal code alone cannot estimate route or accept a package',()=>{
 assert.deepEqual(shipmentDataIssues({destination:{postalCode:'02140',region:'MX-CMX',country:'MX'}}),
 ['incomplete_destination','package_measurements_required','verified_route_required']);
 for(const km of [2,81,NaN])assert.ok(shipmentDataIssues({...shipment,route:{verified:true,source:'fixture',distanceKm:km}}).length);
 const j=advancePickup(advancePickup(newPickupJob(identity),event('payment_confirmed')),event('package_prepared',{shipment:{}}));
 assert.equal(j.status,'review_required');assert.throws(()=>advancePickup(j,event('booking_started')));
});
test('uncertain booking requires reconciliation, never a second label',()=>{
 let j=advancePickup(ready(),event('booking_started'));
 j=advancePickup(j,event('booking_uncertain'));
 assert.throws(()=>advancePickup(j,event('booking_started',{id:'retry'})));
 j=advancePickup(j,event('label_confirmed',{providerId:'synthetic',labelId:'recovered'}));
 assert.equal(j.labelId,'recovered');
});
test('lost pickup response cannot buy another label or resend pickup',()=>{
 let j=advancePickup(ready(),event('booking_started'));
 j=advancePickup(j,event('label_confirmed',{providerId:'synthetic',labelId:'label'}));
 j=advancePickup(advancePickup(j,event('pickup_started')),event('pickup_uncertain'));
 assert.throws(()=>advancePickup(j,event('booking_started',{id:'new-label'})));
 assert.throws(()=>advancePickup(j,event('pickup_started',{id:'retry'})));
 assert.throws(()=>advancePickup(j,event('pickup_confirmed',{providerId:'other',labelId:'label',pickupId:'p'})));
});
test('revision/environment mismatch and cancelled jobs cannot book',()=>{
 const j=ready();assert.throws(()=>advancePickup(j,event('booking_started',{environment:'live'})));
 assert.throws(()=>advancePickup(j,event('booking_started',{revision:'r2'})));
 assert.throws(()=>advancePickup(advancePickup(j,event('order_cancelled')),event('booking_started')));
 assert.equal(advancePickup(advancePickup(j,event('booking_started')),event('order_cancelled')).status,'cancellation_review');
});
