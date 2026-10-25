import {PGlite} from '@electric-sql/pglite';
import {readFile} from 'node:fs/promises';
import assert from 'node:assert/strict';
const db=new PGlite(),owner='11111111-1111-4111-8111-111111111111',foreign='22222222-2222-4222-8222-222222222222';
const q=async(s,p)=>(await db.query(s,p)).rows,one=async(s,p)=>(await q(s,p))[0];
let count=0;const pass=s=>console.log(`PASS ${++count}: ${s}`);
async function auth(uid=owner,aal='aal2'){await db.exec('set role authenticated');await q("select set_config('test.uid',$1,false),set_config('test.aal',$2,false)",[uid,aal]);}
const reset=()=>db.exec('reset role');
const call=async(action,request=null,reference=null,amount=null)=>(await one('select public.qw10_test_transfer($1,$2,$3,$4) as data',[action,request,reference,amount])).data;
async function make(id,{who=owner,method='transfer',qty=1,expired=false,second=false}={}){
 await reset();await q('insert into qw10_test.stock values($1,4,true)',['sku-'+id]);
 const lines=[{sku:'sku-'+id,name:'Synthetic item',quantity:qty,unitPriceCents:100,lineTotalCents:qty*100}];
 if(second){await q('insert into qw10_test.stock values($1,2,true)',['sku-'+id+'-b']);lines.push({sku:'sku-'+id+'-b',name:'Synthetic second',quantity:1,unitPriceCents:100,lineTotalCents:100});}
 const total=lines.reduce((n,l)=>n+l.lineTotalCents,0),quote={currency:'mxn',paymentMethod:method,totalCents:total,lines};
 await q(`insert into qw10_test.requests(id,total_cents,livemode,hold_until,hold_active,owner_id,quote,expires_at)
 values($1,$2,false,now()+interval '1 hour',true,$3,$4,extract(epoch from now())::bigint+$5)`,[id,total,who,quote,expired?-10:1800]);
 for(const l of lines)await q('insert into qw10_test.lines values($1,$2,$3)',[id,l.sku,l.quantity]);
 return total;
}
async function snapshot(){await reset();const out={};for(const {tablename} of await q("select tablename from pg_tables where schemaname='qw10_test' order by tablename"))out[tablename]=await q(`select to_jsonb(t) row from qw10_test.${tablename} t order by to_jsonb(t)::text`);return out;}
try{
 assert.equal(await readFile('supabase/migrations/20261025034544_qw10_test_transfer_confirmation.sql','utf8'),await readFile('supabase/qw10-test-transfer-confirmation.sql','utf8'));
 for(const p of ['tests/fixtures/qw10-deployed-schema.sql','supabase/qw10-test-fulfillment-review.sql','supabase/qw10-test-integrity.sql'])await db.exec(await readFile(p,'utf8'));
 await q('insert into auth.users values($1),($2)',[owner,foreign]);
 await db.exec("create table public.inventory_items(quantity integer);insert into public.inventory_items values(50)");
 const old=await q("select p.oid,pg_get_functiondef(p.oid) definition from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname in ('private','qw10_test','public')");
 await db.exec(await readFile('supabase/qw10-test-transfer-confirmation.sql','utf8'));
 await db.exec('revoke usage on schema auth from qw10_transfer_executor');
 await db.exec(await readFile('supabase/qw10-test-transfer-identity.sql','utf8'));
 assert.equal((await one("select has_schema_privilege('qw10_transfer_executor','auth','usage') allowed")).allowed,false);
 for(const f of old)assert.equal((await one('select pg_get_functiondef($1) definition',[f.oid])).definition,f.definition);
 assert.equal((await one("select prosecdef from pg_proc where oid='public.qw10_test_transfer(text,text,text,bigint)'::regprocedure")).prosecdef,false);
 pass('existing card, reservation, MFA and review functions remain unchanged; public wrapper is invoker');
 for(const role of ['anon','service_role']){await db.exec('set role '+role);await assert.rejects(call('list'),e=>e.code==='42501');await reset();}
 for(const [uid,aal] of [['','aal2'],[owner,'aal1'],[foreign,'aal2']]){await auth(uid,aal);await assert.rejects(call('list'),e=>e.code==='42501');await reset();}
 await make('own');await make('foreign',{who:foreign});await make('card',{method:'card'});
 await auth();assert.deepEqual((await call('list')).transfers.map(r=>r.requestId),['own']);
 for(const id of ['foreign','card','missing'])await assert.rejects(call('confirm',id,'BANKTEST-NOTVALID1',100),/Transfer unavailable/);
 await assert.rejects(call('confirm','own','BANKTEST-NOTVALID1',99),/Confirmation mismatch/);
 await assert.rejects(call('confirm','own','REALBANK123',100),/Confirmation mismatch/);
 await assert.rejects(call('dispatch','own'),/Confirmed transfer order required/);
 pass('MFA and ownership required; card requests, wrong amount/reference and unpaid preparation rejected');
 let result=await call('confirm','own','BANKTEST-ORIGINAL1',100);assert.equal(result.transfer.state,'paid');assert.equal(result.transfer.orderId,1);
 const before=await snapshot();await auth();assert.equal((await call('confirm','own','BANKTEST-ORIGINAL1',100)).repeated,true);
 await assert.rejects(call('confirm','own','BANKTEST-CHANGED11',100),/retry conflict/);assert.deepEqual(await snapshot(),before);
 const receipt=await one("select * from qw10_test.receipts where request_id='own'");assert.equal(receipt.payment_intent_id,null);assert.match(receipt.session_id,/^tr_test_[a-f0-9]{32}$/);
 assert.equal((await one("select actor_name from qw10_test.fulfillment_events where request_id='own'")).actor_name,'admin-transfer-pruebas');
 assert.equal((await one("select quantity from qw10_test.stock where sku='sku-own'")).quantity,3);
 pass('one explicit transfer receipt, order, movement and audit record; exact retry does not duplicate');
 await auth();await assert.rejects(call('dispatch','own'),/Preparation required/);
 await call('prepare','own');await call('prepare','own');await call('dispatch','own');await call('dispatch','own');await call('prepare','own');
 assert.equal((await call('list')).transfers[0].preparation,'dispatched');await reset();
 assert.equal((await one("select count(*)::int n from qw10_test.preparation_events where request_id='own'")).n,2);
 pass('preparation precedes dispatch; repeats are idempotent and never move state backwards');
 await make('late',{expired:true});await auth();result=await call('confirm','late','BANKTEST-LATE0001',100);assert.equal(result.transfer.state,'reconciliation_required');assert.equal(result.transfer.orderId,null);
 await assert.rejects(call('prepare','late'),/Confirmed transfer order required/);await reset();assert.equal((await one("select quantity from qw10_test.stock where sku='sku-late'")).quantity,4);
 await make('multi',{qty:2,second:true});await q("insert into qw10_test.quote_holds values('competing','sku-multi-b',2,now()+interval '1 hour',true)");
 await auth();result=await call('confirm','multi','BANKTEST-MULTI001',300);assert.equal(result.transfer.state,'reconciliation_required');await reset();assert.deepEqual(await q("select quantity from qw10_test.stock where sku like 'sku-multi%' order by sku"),[{quantity:4},{quantity:2}]);
 pass('expired transfer and competing shared stock go to review without partial consumption');
 await make('reuse');let clean=await snapshot();await auth();await assert.rejects(call('confirm','reuse','BANKTEST-ORIGINAL1',100),e=>e.code==='23505');assert.deepEqual(await snapshot(),clean);
 await db.exec("create function qw10_test.fail_transfer() returns trigger language plpgsql as $$begin raise exception 'synthetic failure';end$$;create trigger synthetic_failure before insert on qw10_test.movements for each row execute function qw10_test.fail_transfer()");
 await auth();await assert.rejects(call('confirm','reuse','BANKTEST-RECOVER1',100),/synthetic failure/);assert.deepEqual(await snapshot(),clean);
 await db.exec('drop trigger synthetic_failure on qw10_test.movements;drop function qw10_test.fail_transfer()');await auth();assert.equal((await call('confirm','reuse','BANKTEST-RECOVER1',100)).transfer.state,'paid');
 pass('reference cannot settle another request; a failed movement rolls all evidence and stock back');
 await reset();await q("update qw10_test.requests set session_id='cs_test_card_compat' where id='card'");await db.exec('set role service_role');
 assert.equal((await one("select public.qw10_test_commit_payment('card','cs_test_card_compat','pi_card_compat',100,'mxn','evt_card_compat') data")).data.status,'paid');
 await q("select public.qw10_test_prepare($1,'cs_test_card_compat','prepare')",[owner]);await reset();
 assert.equal((await one("select actor_name from qw10_test.fulfillment_events where request_id='card'")).actor_name,'stripe-test-orders');
 await auth();
 pass('existing signed-card database adapter and preparation remain compatible with the extended receipt schema');
 const integrity=(await one('select public.qw10_test_integrity() data')).data;assert.equal(integrity.totals.inconsistent,0);assert.equal(integrity.totals.legacyEvidence,0);
 await reset();assert.equal((await one('select sum(quantity)::int n from public.inventory_items')).n,50);
 for(const role of ['anon','authenticated','service_role']){await db.exec('set role '+role);await assert.rejects(q('insert into qw10_test.transfer_confirmations default values'),e=>e.code==='42501');await reset();}
 await db.exec('set role qw10_transfer_executor');await assert.rejects(q('select * from public.inventory_items'),e=>e.code==='42501');await assert.rejects(q('delete from qw10_test.receipts'),e=>e.code==='42501');await reset();
 pass('existing integrity report reconciles transfers; executor cannot read real stock or delete evidence');
 clean=await snapshot();await db.exec(await readFile('supabase/qw10-test-transfer-confirmation-rollback.sql','utf8'));assert.deepEqual(await snapshot(),clean);
 pass('rollback disables transfer operations while preserving complete evidence');
}finally{await db.close();}
