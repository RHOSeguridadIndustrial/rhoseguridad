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
