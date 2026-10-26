import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
const source=await readFile(new URL('../test-review-model.js',import.meta.url),'utf8');
const {validateReviewCases}=await import('data:text/javascript;base64,'+Buffer.from(source).toString('base64'));
const original=()=>({request_id:'fixture-one',session_id:'cs_test_fixture',amount_cents:100,reason:'reservation_expired',recorded_at:'2026-10-23T20:00:00Z',reviewed:false,note:null,reviewed_at:null,items:[{sku:'fixture-sku',quantity:1}]});
test('empty and valid owner-scoped test cases renderable',()=>{assert.deepEqual(validateReviewCases({environment:'test',cases:[]}),[]);assert.equal(validateReviewCases({environment:'test',cases:[original()]}).length,1);});
test('reject live environment, malformed money, unknown reasons and duplicate records',()=>{
 assert.throws(()=>validateReviewCases({environment:'live',cases:[]}));
 for(const patch of [{amount_cents:1.5},{amount_cents:-1},{session_id:'cs_live_one'},{request_id:'<script>'},{reason:'constructor'},{recorded_at:'invalid'},{reviewed:'yes'},{items:[{sku:'x',quantity:0}]},{reviewed:true,note:null}])assert.throws(()=>validateReviewCases({environment:'test',cases:[{...original(),...patch}]}));
 assert.throws(()=>validateReviewCases({environment:'test',cases:[original(),original()]}));
});
test('review note is displayed as text and may contain literal markup',()=>{const c={...original(),reviewed:true,note:'<b>Prueba revisada</b>',reviewed_at:'2026-10-23T20:01:00Z'};assert.equal(validateReviewCases({environment:'test',cases:[c]})[0].note,c.note);});

test('refund closure requires one full successful MXN proof; a note alone never supplies resolution',()=>{
 const f={refund_id:'re_fixture',event_id:'evt_fixture',amount_cents:100,currency:'mxn',status:'succeeded',event_created:1792800000,recorded_at:'2026-10-25T20:00:00Z'};
 const check=r=>validateReviewCases({environment:'test',cases:[{...original(),resolution:r}]});
 assert.equal(check({state:'refunded',limited:false,refunds:[f]})[0].resolution.state,'refunded');
 for(const patch of [{amount_cents:50},{currency:'usd'},{status:'pending'},{status:'failed'},{event_id:'notverified'},{refund_id:'<script>'},{event_created:'yesterday'}])assert.throws(()=>check({state:'refunded',limited:false,refunds:[{...f,...patch}]}));
 for(const refunds of [[],[f,f]])assert.throws(()=>check({state:'refunded',limited:false,refunds}));
 assert.throws(()=>check({state:'refunded',limited:true,refunds:[f]}));
 assert.equal(check({state:'unresolved',limited:false,refunds:[{...f,status:'failed'}]})[0].resolution.state,'unresolved');
 assert.equal(validateReviewCases({environment:'test',cases:[original()]})[0].resolution,undefined);
});

test('simulated transfers remain unresolved alongside card cases',()=>{const c={...original(),session_id:'tr_test_'+'a'.repeat(32),resolution:{state:'unresolved',limited:false,refunds:[]}};assert.equal(validateReviewCases({environment:'test',cases:[c]})[0].resolution.state,'unresolved');});
