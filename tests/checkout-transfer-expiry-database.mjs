import {PGlite} from '@electric-sql/pglite';
import {readFile} from 'node:fs/promises';
import assert from 'node:assert/strict';
const db=new PGlite(),owner='11111111-1111-4111-8111-111111111111';
const q=async(sql,args)=>(await db.query(sql,args)).rows;
const sql=await readFile('supabase/qw10-test-transfer-expiry.sql','utf8');
const load=async(id,who=owner)=>q('select public.qw10_test_load_reservation($1,$2) as saved',[who,`retry-fixture-${id}`]);
const counts=()=>q('select (select sum(quantity) from qw10_test.stock) stock,(select count(*) from qw10_test.requests) requests,(select count(*) from qw10_test.receipts) receipts,(select count(*) from qw10_test.purchase_orders) orders,(select count(*) from qw10_test.movements) movements');
let n=0;const pass=s=>console.log(`PASS ${++n}: ${s}`);
async function make(id,changes={}){
 await db.exec('reset role');
 const r={id,session:null,live:false,active:true,hold:-3600,expiry:-3600,method:'transfer',identityMethod:'transfer',...changes};
 const identity=JSON.stringify({paymentMethod:r.identityMethod,items:[{sku:'test-sku',quantity:1}],address:{postalCode:'02000'}});
 await q(`insert into qw10_test.requests(id,session_id,total_cents,livemode,hold_until,hold_active,owner_id,retry_key,quote,expires_at,checkout_identity)
 values($1,$2,100,$3,clock_timestamp()+($4::int*interval '1 second'),$5,$6,$7,$8,case when $9::int is null then null else extract(epoch from clock_timestamp())::bigint+$9::int end,$10)`,
 [id,r.session,r.live,r.hold,r.active,owner,`retry-fixture-${id}`,JSON.stringify({paymentMethod:r.method}),r.expiry,identity]);
 await db.exec('set role service_role');
}
try{
 await db.exec(await readFile('tests/fixtures/qw10-deployed-schema.sql','utf8'));
 await db.exec(await readFile('supabase/qw10-test-fulfillment-review.sql','utf8'));
 await q('insert into auth.users values($1)',[owner]);
 await db.exec("insert into qw10_test.stock values('test-sku',5,true)");
 const acl=(await q("select proacl::text acl from pg_proc where oid='public.qw10_test_load_reservation(text,text)'::regprocedure"))[0];
 await db.exec(sql);
 assert.deepEqual((await q("select proacl::text acl from pg_proc where oid='public.qw10_test_load_reservation(text,text)'::regprocedure"))[0],acl);
 assert.equal((await q("select prosecdef from pg_proc where oid='public.qw10_test_load_reservation(text,text)'::regprocedure"))[0].prosecdef,false);
 pass('existing service-only privileges and SECURITY INVOKER preserved');
 await make('expired');const before=await counts(),saved=await q("select row_to_json(r) as record from qw10_test.requests r where id='expired'");
 await assert.rejects(load('expired'),e=>e.code==='PQT01');
 await assert.rejects(load('expired'),e=>e.code==='PQT01');
 assert.deepEqual(await counts(),before);assert.deepEqual(await q("select row_to_json(r) as record from qw10_test.requests r where id='expired'"),saved);
 assert.equal((await load('expired','22222222-2222-4222-8222-222222222222'))[0].saved,null);
 pass('expired unpaid transfer yields precise code without changes or cross-owner disclosure');
 for(const [id,changes] of [
  ['card',{method:'card',identityMethod:'card'}],['mismatch',{identityMethod:'card'}],
  ['session',{session:'cs_test_bound'}],['inactive',{active:false}],['no-expiry',{expiry:null}]
 ]){await make(id,changes);await assert.rejects(load(id),e=>e.code==='P0001');}
 await assert.rejects(make('live',{live:true}),e=>e.code==='23514');
 pass('card, bound session, inconsistent method, live, inactive and incomplete history remain blocked');
 for(const [id,changes] of [['valid',{hold:3600,expiry:3600}],['hold-future',{hold:3600}],['expiry-future',{expiry:3600}]]){
  await make(id,changes);
  if(id==='valid')assert.equal((await load(id))[0].saved.id,id);
  else await assert.rejects(load(id),e=>e.code==='P0001');
 }
 pass('active retry is unchanged; both reservation deadlines must expire for replacement');
 for(const kind of ['receipt','order','movement']){
  await make(kind,{session:`cs_test_${kind}`});await db.exec('reset role');
  await q("insert into qw10_test.receipts(session_id,payment_intent_id,request_id,amount_cents,state,first_event_id) values($1,$2,$3,100,'paid',$4)",[`cs_test_${kind}`,`pi_${kind}`,kind,`evt_${kind}`]);
  if(kind!=='receipt')await q("insert into qw10_test.purchase_orders(request_id,session_id) values($1,$2)",[kind,`cs_test_${kind}`]);
  if(kind==='movement')await q("insert into qw10_test.movements values($1,'test-sku',1)",[kind]);
  await db.exec('set role service_role');await assert.rejects(load(kind),e=>e.code==='P0001');
 }
 pass('any receipt, order or movement prevents the new-transfer hint');
 for(const role of ['anon','authenticated']){
  await db.exec('reset role; set role '+role);await assert.rejects(load('expired'),e=>e.code==='42501');
 }
 pass('anonymous and customer roles cannot inspect reservation state');
 await db.exec('reset role');
 const {quoteCheckout}=await import('../supabase/functions/_shared/checkout-quote.js');
 const input={paymentMethod:'transfer',items:[{sku:'test-sku',quantity:1}],address:{postalCode:'02000'}};
 const quote=await quoteCheckout(input,{registered:true,validateCoverage:async()=>true,loadVariant:async sku=>({sku,name:'Synthetic',active:true,priceCents:100})});
 await db.exec('set role service_role');
 const fresh=await q('select public.qw10_test_reserve_v2($1,$2,$3,$4) as saved',[owner,'new-transfer-fixture',JSON.stringify(quote),JSON.stringify(input)]);
 const again=await q('select public.qw10_test_reserve_v2($1,$2,$3,$4) as saved',[owner,'new-transfer-fixture',JSON.stringify(quote),JSON.stringify(input)]);
 assert.equal(fresh[0].saved.id,again[0].saved.id);
 assert.deepEqual(await q("select row_to_json(r) as record from qw10_test.requests r where id='expired'"),saved);
 assert.equal((await q("select quantity from qw10_test.stock where sku='test-sku'"))[0].quantity,5);
 pass('new key creates one reservation with current quote; old reference and physical stock stay intact');
}catch(e){console.error(e.message,e.code||'',e.detail||'');process.exitCode=1;}finally{await db.close();}
