import test from 'node:test';
import assert from 'node:assert/strict';
import {selectProvider, distanceBand} from '../logistics/select-provider.mjs';
const now = Date.parse('2026-10-22T18:00:00Z'), hour = 3600000;
const order = (changes={}) => ({id:'synthetic-order',shipmentRevision:'revision-1',environment:'test',
 package:{weightKg:1,lengthCm:20,widthCm:10,heightCm:10},
 currency:'MXN',subtotalCents:150000,customerShippingCents:0,packagingCents:1000,
 grossContributionCents:45000,paymentState:'paid',packageReady:true,
 destinationRegion:'MX-CMX',distanceKm:40,readyAt:now,deliveryDeadline:now+24*hour,...changes});
const rules={verified:true,weightMethod:'max_actual_volumetric',volumetricDivisor:5000,roundingKg:1,maxActualKg:30,maxBillableKg:30,maxLongestCm:100,maxMiddleCm:80,maxShortestCm:60};
const quote = (changes={}) => ({id:'q1',providerId:'synthetic-a',orderId:'synthetic-order',
 shipmentRevision:'revision-1',environment:'test',currency:'MXN',quotedAt:now-1000,
 expiresAt:now+hour,coverageConfirmed:true,packageAccepted:true,singlePackagePickup:true,
 pickupAvailable:true,pickupAt:now+hour,deliveryAt:now+8*hour,approvedForAutomaticSelection:true,
 completedDeliveries:100,onTimeDeliveries:97,allChargesIncluded:true,
 packageRules:rules,quotedBillableKg:1,requiredProtectionIncluded:true,totalCents:9000,...changes});
const policy={subsidyBps:800,minimumRemainingContributionCents:20000};
const run=(o=order(),q=[quote()],p=policy)=>selectProvider(o,q,p,now);
test('lowest full cost wins even when another arrives faster',()=>{
 const r=run(order(),[quote({deliveryAt:now+3*hour}),quote({id:'q2',providerId:'synthetic-b',totalCents:8000})]);
 assert.equal(r.selected.providerId,'synthetic-b');assert.equal(r.selected.totalCents,9000);
 assert.equal(r.budgetCents,12000);
});
test('late cheap quote loses to on-time quote',()=>{
 assert.equal(run(order(),[quote(),quote({id:'q2',totalCents:1000,deliveryAt:now+25*hour})]).selected.quoteId,'q1');
});
test('ties prefer reliability then earlier arrival independent of input order',()=>{
 const a=quote(),b=quote({id:'q2',providerId:'synthetic-b',onTimeDeliveries:99});
 assert.equal(run(order(),[a,b]).selected.quoteId,'q2');assert.equal(run(order(),[b,a]).selected.quoteId,'q2');
 assert.equal(run(order(),[a,quote({id:'q3',deliveryAt:now+4*hour})]).selected.quoteId,'q3');
});
test('distance boundaries and CDMX scope',()=>{
 for(const [km,band] of [[3,'3-10'],[10,'3-10'],[10.1,'10-30'],[30,'10-30'],[50,'30-50'],[80,'50-80']])
  assert.equal(distanceBand(km),band);
 for(const km of [2.99,80.01,NaN,Infinity])assert.equal(run(order({distanceKm:km})).reason,'distance_out_of_range');
 assert.equal(run(order({destinationRegion:'MX-MEX'})).reason,'outside_rho_coverage');
});
test('explicit subsidy cap examples are bounded by remaining margin',()=>{
 for(const [sale,shipping,budget] of [[200,99,115],[500,0,40],[1000,0,80],[1500,0,120],[3000,0,240]])
  assert.equal(run(order({subtotalCents:sale*100,customerShippingCents:shipping*100}),[]).budgetCents,budget*100);
 assert.equal(run(order({subtotalCents:50000})).rejected[0].reason,'over_budget');
 assert.equal(run(order({grossContributionCents:25000})).rejected[0].reason,'over_budget');
 assert.equal(run(order(),[quote()],{}).reason,'margin_configuration_required');
});
test('unpaid, unprepared, cancelled and already shipped never recommend',()=>{
 assert.equal(run(order({paymentState:'pending'})).reason,'payment_not_confirmed');
 assert.equal(run(order({packageReady:false})).status,'waiting_for_preparation');
 assert.equal(run(order({cancelled:true})).reason,'order_not_active');
 assert.equal(run(order({refunded:true})).reason,'order_not_active');
 assert.equal(run(order({existingShipmentId:'s1'})).status,'already_assigned');
});
test('invalid or unsuitable quotes cannot authorize selection',()=>{
 const cases=[{expiresAt:now},{quotedAt:now+1},{environment:'live'},{currency:'USD'},
 {shipmentRevision:'old'},{orderId:'other'},{coverageConfirmed:false},{packageAccepted:false},
 {singlePackagePickup:false},{pickupAvailable:false},{pickupAt:now-1},{deliveryAt:now},
 {approvedForAutomaticSelection:false},{completedDeliveries:0},{onTimeDeliveries:101},
 {totalCents:-1},{totalCents:1.5},{allChargesIncluded:false},{requiredProtectionIncluded:false}];
 for(const change of cases)assert.equal(run(order(),[quote(change)]).status,'review_required',JSON.stringify(change));
});
test('pickup must follow readiness; expired promise is never extended',()=>{
 assert.equal(run(order({readyAt:now+2*hour})).status,'review_required');
 assert.equal(run(order({deliveryDeadline:now})).reason,'deadline_unavailable');
});
test('invalid order amounts and unsafe arithmetic fail closed',()=>{
 for(const value of [NaN,-1,1.1,Number.MAX_SAFE_INTEGER])
  assert.equal(run(order({subtotalCents:value})).status,'review_required');
 assert.equal(run(order(),[quote()],{...policy,subsidyBps:10001}).reason,'invalid_budget_policy');
});
test('empty quotes require review and recommendation has no side effects',()=>{
 assert.equal(run(order(),[]).reason,'no_eligible_provider');
 const o=Object.freeze(order()),q=Object.freeze(quote());
 assert.equal(run(o,Object.freeze([q])).status,'recommended');
});
test('margin budget replaces implicit subsidy and keeps minimum contribution',()=>{
 const p={minimumRemainingContributionCents:20000};
 const r=run(order({subtotalCents:50000,grossContributionCents:35000}),[quote()],p);
 assert.equal(r.status,'recommended');assert.equal(r.budgetCents,15000);
 assert.equal(r.selected.remainingContributionCents,25000);
 assert.equal(run(order({grossContributionCents:19999}),[quote()],p).reason,'insufficient_margin');
 assert.equal(run(order(),[quote()],{}).reason,'margin_configuration_required');
});
test('volume and provider-specific rules exclude underquoted or oversized services',()=>{
 const o=order({package:{weightKg:1,lengthCm:40,widthCm:30,heightCm:20}});
 assert.equal(run(o,[quote()]).rejected[0].reason,'quoted_weight_insufficient');
 assert.equal(run(o,[quote({quotedBillableKg:5})]).selected.billableKg,5);
 assert.equal(run(o,[quote({quotedBillableKg:6,packageRules:{...rules,volumetricDivisor:4000}})]).selected.billableKg,6);
 assert.equal(run(o,[quote({packageRules:{...rules,maxLongestCm:35}})]).rejected[0].reason,'package_exceeds_service_limits');
 assert.equal(run(o,[quote({packageRules:{...rules,volumetricDivisor:undefined}})]).rejected[0].reason,'volumetric_divisor_required');
 assert.equal(run(o,[quote({packageRules:{...rules,weightMethod:'actual'}})]).selected.billableKg,1);
 assert.equal(run(order({package:undefined})).rejected[0].reason,'package_measurements_required');
});
