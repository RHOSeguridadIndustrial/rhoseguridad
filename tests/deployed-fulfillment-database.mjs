import {PGlite} from '@electric-sql/pglite';
import {readFile,writeFile} from 'node:fs/promises';
import assert from 'node:assert/strict';
const db=new PGlite(), admin='11111111-1111-4111-8111-111111111111';
const schema=await readFile(new URL('./fixtures/qw10-deployed-schema.sql',import.meta.url),'utf8');
const upgrade=await readFile(new URL('../supabase/qw10-test-fulfillment-review.sql',import.meta.url),'utf8');
const q=async(s,p)=>(await db.query(s,p)).rows;
const scalar=async(s,p)=>(await q(s,p))[0];
let n=0;const pass=s=>console.log(`PASS ${++n}: ${s}`);
const reset=()=>db.exec('reset role');
const receipt=(id,overrides={})=>({p_request:id,p_session:`cs_test_${id}`,p_payment:`pi_${id}`,p_amount:100,p_currency:'mxn',p_live:false,p_event:`evt_${id}`,...overrides});
const pay=async(id,overrides={})=>{const p=receipt(id,overrides);return (await scalar('select qw10_test.commit_payment($1,$2,$3,$4,$5,$6,$7) as result',Object.values(p))).result;};
async function make(id,{qty=1,expired=false,active=true,owner=admin}={}){
 await reset();
 await q(`insert into qw10_test.requests(id,session_id,total_cents,livemode,hold_until,owner_id) values($1,$2,100,false,clock_timestamp()+($3::integer*interval '1 hour'),$4)`,[id,`cs_test_${id}`,expired?-1:1,owner]);
 await q('insert into qw10_test.lines values($1,$2,$3)',[id,`sku-${id}`,qty]);
 await q('update qw10_test.stock set active=$2 where sku=$1',[`sku-${id}`,active]);
 await db.exec('set role service_role');
}
try{
 await db.exec(schema);
 await q('insert into auth.users values($1)',[admin]);
 for(const id of ['legacy','good','late','short','inactive','rollback','foreign','reserve','reuse','multi']) await q('insert into qw10_test.stock values($1,5,true)',[`sku-${id}`]);
 await make('legacy');await pay('legacy');await reset();
 const legacy=await q("select * from qw10_test.receipts where request_id='legacy'");
 await db.exec(upgrade);
 assert.deepEqual(await q("select * from qw10_test.receipts where request_id='legacy'"),legacy);
 assert.equal((await scalar('select count(*)::int n from qw10_test.fulfillment_events')).n,0);
 await db.exec('set role service_role');assert.equal((await pay('legacy')).repeated,true);await reset();
 pass('schema upgrade preserves historical receipts and retries, without inventing past actor evidence');
 for(const sql of ["update qw10_test.stock set quantity=0", "insert into qw10_test.movements values('legacy','sku-legacy',1)","insert into qw10_test.receipts values('cs_test_bad','pi_bad','bad',100,'paid','evt_bad',clock_timestamp())"]) {
  await db.exec('set role service_role');await assert.rejects(db.exec(sql),e=>e.code==='42501');await reset();
 }
 assert.equal((await scalar("select pg_has_role('service_role','qw10_fulfillment','MEMBER') member")).member,false);
 pass('backend cannot directly discount stock, insert receipts/movements, or assume executor role');
 await db.exec('set role service_role');
 const webQuote={currency:'mxn',totalCents:100,lines:[{sku:'sku-multi',quantity:2}]};
 const web=(await scalar('select public.qw10_test_reserve($1,$2,$3::jsonb) result',[admin,'lock-helper-web-001',JSON.stringify(webQuote)])).result;
 const special=(await scalar('select public.qw10_test_special_order($1,$2,$3,$4) result',[admin,'lock-helper-special-001','sku-multi',5])).result;
 assert.equal(special.reserved,3);assert.equal(special.additional,2);await reset();
 assert.equal((await scalar("select quantity from qw10_test.stock where sku='sku-multi'")).quantity,5);
 await db.exec('set role authenticated');await assert.rejects(q('select qw10_test.lock_stock(array[$1])',['sku-multi']),e=>e.code==='42501');await reset();
 pass('stock lock helper preserves web/special reservation writers without granting backend direct stock updates');
 for(const role of ['anon','authenticated']){
  await db.exec('set role '+role);await assert.rejects(pay('legacy'),e=>e.code==='42501');await reset();
 }
 pass('anonymous and customer roles cannot invoke payment fulfillment');
 await make('good');
 for(const override of [{p_amount:101},{p_currency:'usd'},{p_session:'cs_test_wrong'},{p_live:true},{p_event:'not-event'},{p_payment:'not-payment'}]) await assert.rejects(pay('good',override));
 assert.equal((await scalar("select count(*)::int n from qw10_test.receipts where request_id='good'")).n,0);
 const paid=await pay('good');assert.equal(paid.status,'paid');await reset();
 assert.equal((await scalar("select quantity from qw10_test.stock where sku='sku-good'")).quantity,4);
 const event=await scalar("select * from qw10_test.fulfillment_events where request_id='good'");
 assert.equal(event.actor_kind,'system');assert.equal(event.actor_name,'stripe-test-orders');assert.equal(event.source_event,'evt_good');
 pass('valid bound payment atomically creates order, movement, system actor and stock discount; mismatches reject');
 await db.exec('set role service_role');
 assert.equal((await pay('good',{p_event:'evt_redelivery'})).repeated,true);
 await assert.rejects(pay('good',{p_payment:'pi_conflict'}),/retry conflict/);await reset();
 assert.equal((await scalar("select count(*)::int n from qw10_test.movements where request_id='good'")).n,1);
 assert.equal((await scalar("select count(*)::int n from qw10_test.fulfillment_events where request_id='good'")).n,1);
 pass('second success notification is idempotent; conflicting payment identity is rejected');
 for(const [id,opts,reason] of [['late',{expired:true},'reservation_expired'],['inactive',{active:false},'stock_unavailable'],['short',{qty:6},'stock_unavailable']]){
  await make(id,opts);assert.equal((await pay(id)).status,'reconciliation_required');await reset();
  assert.equal((await scalar('select reason from qw10_test.fulfillment_events where request_id=$1',[id])).reason,reason);
  assert.equal((await scalar('select quantity from qw10_test.stock where sku=$1',[`sku-${id}`])).quantity,5);
  assert.equal((await scalar('select count(*)::int n from qw10_test.purchase_orders where request_id=$1',[id])).n,0);
 }
 pass('late, inactive or insufficient stock records a review reason, keeps receipt, and does not fulfill');
 await make('reserve',{qty:2});await reset();
 await db.exec("insert into qw10_test.quote_holds values('special-test','sku-reserve',4,clock_timestamp()+interval '1 hour',true)");
 await db.exec('set role service_role');assert.equal((await pay('reserve')).status,'reconciliation_required');await reset();
 pass('special-order reservations share the same stock protection');
 await make('reuse');await assert.rejects(pay('reuse',{p_event:'evt_good'}),e=>e.code==='23505');await reset();
 assert.equal((await scalar("select quantity from qw10_test.stock where sku='sku-reuse'")).quantity,5);
 assert.equal((await scalar("select count(*)::int n from qw10_test.receipts where request_id='reuse'")).n,0);
 pass('a source event cannot be reused for a different checkout');
 await make('rollback');await reset();
 await db.exec("create function qw10_test.fail_evidence() returns trigger language plpgsql as $$begin raise exception 'evidence unavailable';end$$; create trigger fail_evidence before insert on qw10_test.fulfillment_events for each row execute function qw10_test.fail_evidence();");
 await db.exec('set role service_role');await assert.rejects(pay('rollback'),/evidence unavailable/);await reset();
 assert.equal((await scalar("select count(*)::int n from qw10_test.receipts where request_id='rollback'")).n,0);
 assert.equal((await scalar("select quantity from qw10_test.stock where sku='sku-rollback'")).quantity,5);
 await db.exec('drop trigger fail_evidence on qw10_test.fulfillment_events');
 pass('audit failure rolls back receipt, order and inventory together');
 await make('foreign',{owner:'22222222-2222-4222-8222-222222222222',expired:true});await pay('foreign');await reset();
 await db.exec(`set role authenticated;select set_config('test.uid','${admin}',false);select set_config('test.aal','aal1',false);`);
 await assert.rejects(q("select public.qw10_test_review('list')"),e=>e.code==='42501');
 await db.exec("select set_config('test.aal','aal2',false)");
 const cases=(await scalar("select public.qw10_test_review('list') as result")).result;
 assert.equal(cases.environment,'test');assert.equal(cases.cases.length,4);assert.ok(!cases.cases.some(c=>c.request_id==='foreign'));
 await assert.rejects(q("select public.qw10_test_review('review','foreign','Verified external case')"),/unavailable/);
 pass('review requires current administrator MFA and cannot read or change another owner case');
 const note='Prueba revisada: sin salida de mercancía.';
 const review=()=>q("select public.qw10_test_review('review','late',$1) as result",[note]);
 await review();await review();
 await assert.rejects(q("select public.qw10_test_review('review','late','Different immutable note')"),/already recorded/);
 await assert.rejects(q("select public.qw10_test_review('review','good','Review a successful order')"),/unavailable/);await reset();
 assert.equal((await scalar("select count(*)::int n from qw10_test.reconciliation_reviews where request_id='late'")).n,1);
 assert.equal((await scalar("select count(*)::int n from qw10_test.purchase_orders where request_id='late'")).n,0);
 pass('review is append-only and idempotent; it never confirms a payment, delivers, refunds or changes stock');
 for(const role of ['anon','authenticated','service_role']){
  await db.exec('set role '+role);
  await assert.rejects(db.exec('update qw10_test.fulfillment_events set actor_name=actor_name'),e=>e.code==='42501');
  await assert.rejects(db.exec('delete from qw10_test.reconciliation_reviews'),e=>e.code==='42501');await reset();
 }
 pass('automatic and human evidence cannot be altered or deleted by client/backend roles');
 const evidence=await q('select * from qw10_test.fulfillment_events order by request_id');
 const reviews=await q('select * from qw10_test.reconciliation_reviews order by request_id');
 await db.exec(await readFile(new URL('../supabase/qw10-test-fulfillment-review-rollback.sql',import.meta.url),'utf8'));
 assert.deepEqual(await q('select * from qw10_test.fulfillment_events order by request_id'),evidence);
 assert.deepEqual(await q('select * from qw10_test.reconciliation_reviews order by request_id'),reviews);
 await db.exec('set role service_role');assert.equal((await pay('good')).repeated,true);await reset();
 pass('rollback restores previous consumer without deleting automatic or human evidence');
 if(process.argv.includes('--export-fixture'))await writeFile('/tmp/qw10-deployed-upgraded.sql',schema+'\n'+upgrade);
 console.log(`RESULT: ${n} deployed-schema checks passed (isolated database; synthetic records).`);
}finally{await db.close();}
