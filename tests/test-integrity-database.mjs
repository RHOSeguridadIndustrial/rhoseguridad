import {PGlite} from '@electric-sql/pglite';
import {readFile} from 'node:fs/promises';
import assert from 'node:assert/strict';
import {validateIntegrity} from '../test-integrity-model.js';
const db=new PGlite(),owner='11111111-1111-4111-8111-111111111111',foreign='22222222-2222-4222-8222-222222222222';
const q=async(s,p)=>(await db.query(s,p)).rows;
const one=async(s,p)=>(await q(s,p))[0];
let n=0;const pass=s=>console.log(`PASS ${++n}: ${s}`);
const reset=()=>db.exec('reset role');
async function auth(uid=owner,aal='aal2'){
 await db.exec('set role authenticated');await q("select set_config('test.uid',$1,false),set_config('test.aal',$2,false)",[uid,aal]);
}
const report=async()=>validateIntegrity((await one('select public.qw10_test_integrity() as data')).data);
async function make(id,{state='paid',who=owner,legacy=false,method='card',qty=2,order=state==='paid',movement=state==='paid'}={}){
 await reset();await q('insert into qw10_test.stock values($1,10,true)',['sku-'+id]);
 await q(`insert into qw10_test.requests(id,session_id,total_cents,livemode,hold_until,hold_active,owner_id,quote)
 values($1,$2,100,false,now()+interval '1 hour',$3,$4,$5)`,[id,method==='card'?'cs_test_'+id:null,state===null,who,{totalCents:100,paymentMethod:method}]);
 await q('insert into qw10_test.lines values($1,$2,$3)',[id,'sku-'+id,qty]);
 if(state){
  await q('insert into qw10_test.receipts(session_id,payment_intent_id,request_id,amount_cents,state,first_event_id) values($1,$2,$3,100,$4,$5)',['cs_test_'+id,'pi_'+id,id,state,'evt_'+id]);
  if(!legacy)await q('insert into qw10_test.fulfillment_events(request_id,source_event,outcome,reason) values($1,$2,$3,$4)',[id,'evt_'+id,state,state==='paid'?null:'reservation_expired']);
 }
 if(order)await q('insert into qw10_test.purchase_orders(request_id,session_id) values($1,$2)',[id,'cs_test_'+id]);
 if(movement)await q('insert into qw10_test.movements values($1,$2,$3)',[id,'sku-'+id,qty]);
}
async function snapshot(){
 await reset();const out={};
 for(const {tablename} of await q("select tablename from pg_tables where schemaname='qw10_test' order by tablename"))out[tablename]=await q(`select to_jsonb(t) as row from qw10_test.${tablename} t order by to_jsonb(t)::text`);
 return out;
}
try{
 await db.exec(await readFile(new URL('./fixtures/qw10-deployed-schema.sql',import.meta.url),'utf8'));
 await db.exec(await readFile(new URL('../supabase/qw10-test-fulfillment-review.sql',import.meta.url),'utf8'));
 await q('insert into auth.users values($1),($2)',[owner,foreign]);
 const old=await q("select p.oid,pg_get_functiondef(p.oid) as definition from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname in ('private','qw10_test','public') order by p.oid");
 await db.exec(await readFile(new URL('../supabase/qw10-test-integrity.sql',import.meta.url),'utf8'));
 for(const x of old)assert.equal((await one('select pg_get_functiondef($1) as definition',[x.oid])).definition,x.definition);
 assert.equal((await one("select prosecdef from pg_proc where oid='public.qw10_test_integrity()'::regprocedure")).prosecdef,false);
 assert.equal((await one("select provolatile from pg_proc where oid='private.qw10_test_integrity()'::regprocedure")).provolatile,'s');
 pass('additive read-only report leaves all payment/reservation/auth functions unchanged');
 for(const role of ['anon','service_role']){await db.exec('set role '+role);await assert.rejects(report(),e=>e.code==='42501');await reset();}
 for(const [uid,aal] of [['','aal2'],[owner,'aal1'],[foreign,'aal2']]){await auth(uid,aal);await assert.rejects(report(),e=>e.code==='42501');await reset();}
 await auth();assert.equal((await report()).totals.requests,0);await reset();
 pass('anonymous, service, missing identity, customer and administrator without MFA cannot read');
 await make('good');await make('legacy',{legacy:true});await make('foreign',{who:foreign});
 await make('transfer',{state:null,method:'transfer'});await make('unpaid',{state:null});
 await make('review',{state:'reconciliation_required'});
 await q('insert into qw10_test.reconciliation_reviews(request_id,note,reviewed_by) values($1,$2,$3)',['review','Nota de revisión sin resolución de pago.',owner]);
 await q("insert into qw10_test.preparation_events values('good','prepare',$1,'2026-10-24T20:00:00Z'),('good','dispatch',$1,'2026-10-24T20:01:00Z')",[owner]);
 const before=await snapshot();await auth();await db.exec('begin read only');const clean=await report();await db.exec('commit');
 assert.deepEqual(clean.totals,{requests:5,receipts:3,orders:2,paid:2,receiptAmountCents:300,paidAmountCents:200,review:1,reviewAmountCents:100,reviewNotes:1,unpaid:2,transfersWithoutReceipt:1,dispatched:1,inconsistent:0,legacyEvidence:1});
 assert.ok(!clean.requests.some(r=>r.requestId==='foreign'));assert.equal(clean.requests.find(r=>r.requestId==='review').state,'reconciliation_required');
 assert.deepEqual(await snapshot(),before);pass('read-only snapshot is owner scoped, counts unpaid transfers, and never treats review notes as settlement');
 await make('bad_amount');await q("update qw10_test.receipts set amount_cents=99 where request_id='bad_amount'");
 await make('missing_order',{order:false,movement:false});
 await make('bad_session');await q("update qw10_test.purchase_orders set session_id='cs_test_review' where request_id='bad_session'");
 await make('bad_movement');await q("update qw10_test.movements set quantity=1 where request_id='bad_movement'");
 await make('extra_movement');await q("insert into qw10_test.movements values('extra_movement','sku-good',1)");
 await make('bad_hold');await q("update qw10_test.requests set hold_active=true where id='bad_hold'");
 await make('bad_quote');await q("update qw10_test.requests set quote='{\"totalCents\":999}' where id='bad_quote'");
 await make('bad_event');await q("update qw10_test.fulfillment_events set source_event='evt_different' where request_id='bad_event'");
 await auth();let data=await report();
 for(const [id,code] of [['bad_amount','receipt_amount'],['missing_order','paid_without_order'],['bad_session','order_session'],['bad_movement','movement_mismatch'],['extra_movement','movement_mismatch'],['bad_hold','paid_hold_active'],['bad_quote','quote_total'],['bad_event','event_mismatch']])assert.ok(data.requests.find(r=>r.requestId===id).issues.includes(code),id);
 assert.equal(data.totals.inconsistent,8);await reset();pass('detects amount, session, missing order, exact line/stock movement, active hold, quote and audit mismatches');
 await make('unpaid_output',{state:null});await q("insert into qw10_test.preparation_events values('unpaid_output','dispatch',$1,now())",[owner]);
 await make('wrong_sequence');await q("insert into qw10_test.preparation_events values('wrong_sequence','prepare',$1,'2026-10-24T21:00:00Z'),('wrong_sequence','dispatch',$1,'2026-10-24T20:00:00Z')",[owner]);
 await make('review_output',{state:'reconciliation_required',order:true,movement:true});
 await auth();data=await report();
 assert.deepEqual(data.requests.find(r=>r.requestId==='unpaid_output').issues,['unpaid_preparation','dispatch_sequence']);
 assert.ok(data.requests.find(r=>r.requestId==='wrong_sequence').issues.includes('dispatch_sequence'));
 assert.ok(data.requests.find(r=>r.requestId==='review_output').issues.includes('order_without_paid_receipt'));
 assert.ok(data.requests.find(r=>r.requestId==='review_output').issues.includes('unpaid_movement'));await reset();
 pass('detects preparation without payment, out-of-order dispatch and fulfillment of a review case');
 for(let i=0;i<105;i++)await make('bulk_'+i,{state:null});
 await auth();data=await report();assert.equal(data.detailsLimited,true);assert.equal(data.requests.length,100);
 assert.equal(data.totals.requests,121);assert.equal(data.totals.inconsistent,11);
 assert.equal(data.requests.filter(r=>r.issues.length).length,11);await reset();
 pass('full-scope totals remain accurate above the detail limit and all differences are prioritized');
 for(const role of ['anon','authenticated','service_role']){
  await db.exec('set role '+role);
  if(role!=='service_role')await assert.rejects(q('select * from qw10_test.receipts'),e=>e.code==='42501');
  await assert.rejects(q('update qw10_test.stock set quantity=0'),e=>e.code==='42501');await reset();
 }
 const retained=await snapshot();await db.exec(await readFile(new URL('../supabase/qw10-test-integrity-rollback.sql',import.meta.url),'utf8'));
 assert.deepEqual(await snapshot(),retained);pass('no table access or write grants added; rollback preserves every evidence record');
}finally{await db.close();}
