import {PGlite} from '@electric-sql/pglite';
import {readFile} from 'node:fs/promises';
import assert from 'node:assert/strict';
const db=new PGlite();const q=async(s,p)=>(await db.query(s,p)).rows;
let n=0;const pass=s=>console.log(`PASS ${++n}: ${s}`);
const worker=async(sql,p)=>{await db.exec('set role lab_worker');try{return await q(sql,p);}finally{await db.exec('reset role');}};
const reserve=async(ref,qty)=>(await worker("select consumption_lab.reserve($1,'lab-a',$2) result",[ref,qty]))[0].result;
const consume=async(ref,event)=>(await worker('select consumption_lab.consume($1,$2) result',[ref,event]))[0].result;
async function paid(id,quantity,expired=false){await q("insert into consumption_lab.requests values($1,'owner',$2,100,'mxn',clock_timestamp()+$3::interval)",[id,'cs_test_'+id,expired?'-1 second':'30 minutes']);await q("insert into consumption_lab.lines values($1,'lab-a',$2)",[id,quantity]);await q("insert into consumption_lab.receipts values($1,$2,'owner',$3,$4,100,'mxn','paid',false)",['evt_'+id,id,'cs_test_'+id,'pi_'+id]);}
const state=async()=>({stock:(await q("select quantity from public.inventory_items where sku='lab-a'"))[0].quantity,orders:(await q('select count(*)::int n from consumption_lab.orders'))[0].n,system:(await q("select count(*)::int n from public.inventory_history where actor_kind='system'"))[0].n});
try{
 await db.exec(await readFile('/tmp/qw10-integrated-fixture.sql','utf8'));
 await db.exec(await readFile(new URL('./fixtures/qw10-shared-lifecycle.sql',import.meta.url),'utf8'));
 await db.exec("select set_config('test.uid','',false)");
 assert.deepEqual(await reserve('web',2),{status:'reserved',reserved:2,additional:0});
 assert.deepEqual(await reserve('special',3),{status:'quote',reserved:0,additional:3});
 assert.deepEqual(await reserve('special',3),{status:'quote',reserved:0,additional:3});
 pass('web hold and original manual hold share availability; quote-only retry is idempotent');
 const holdBefore=await q("select * from consumption_lab.holds where reference='web'");
 assert.deepEqual(await reserve('web',2),{status:'reserved',reserved:2,additional:0});assert.deepEqual(await q("select * from consumption_lab.holds where reference='web'"),holdBefore);
 await assert.rejects(reserve('web',3),/Conflicting reservation retry/);
 pass('hold retry neither duplicates nor extends deadline and changed quantity is rejected');
 await db.exec("select set_config('test.uid','11111111-1111-4111-8111-111111111111',false);set role authenticated");
 await assert.rejects(q("select public.inventory_adjust('lab-a','issue',1,1,'pieza',true,'Invades web hold',2)"),/Hay piezas reservadas/);
 await db.exec("reset role;select set_config('test.uid','',false)");
 pass('original manual adjustment protects web-held pieces');
 await paid('web',2);assert.equal(await consume('web','evt_web'),'consumed');assert.deepEqual(await state(),{stock:3,orders:1,system:1});
 assert.equal((await q("select active from consumption_lab.holds where reference='web'"))[0].active,false);
 pass('own web hold is released atomically and manual reserved floor is preserved');
 assert.equal(await consume('web','evt_web'),'already_consumed');assert.deepEqual(await state(),{stock:3,orders:1,system:1});pass('paid receipt replay does not consume twice');
 // Expired active flags are not reservations. Read state is server-time based.
 await db.exec("update private.inventory_reservations set expires_at=clock_timestamp()-interval '1 second'");
 assert.deepEqual(await reserve('partial-special',5),{status:'reserved',reserved:3,additional:2});
 pass('expired manual hold no longer counts; special demand splits available stock and excess');
 await db.exec("update consumption_lab.holds set expires_at=clock_timestamp()-interval '1 second' where reference='partial-special'");
 assert.deepEqual(await reserve('partial-special',5),{status:'expired',reserved:3,additional:2});
 assert.equal((await q("select active from consumption_lab.holds where reference='partial-special'"))[0].active,true);
 assert.equal((await q("select private.inventory_reserved('lab-a')::int held"))[0].held,0);
 pass('expired active special hold is ignored and retry does not renew it');
 await paid('late',1,true);const before=await state();assert.equal(await consume('late','evt_late'),'needs_reconciliation');assert.deepEqual(await state(),before);
 assert.equal((await q("select reason from consumption_lab.reconciliation where request_id='late'"))[0].reason,'reservation_expired');
 assert.equal(await consume('late','evt_late'),'needs_reconciliation');assert.equal((await q('select count(*)::int n from consumption_lab.reconciliation'))[0].n,1);
 pass('late paid receipt retained for reconciliation without fulfillment or duplicate case');
 await paid('missing',1);assert.equal(await consume('missing','evt_missing'),'needs_reconciliation');assert.deepEqual(await state(),before);
 assert.equal((await q("select reason from consumption_lab.reconciliation where request_id='missing'"))[0].reason,'reservation_missing_or_expired');
 pass('paid receipt without valid own reservation cannot silently consume available stock');
 console.log(`RESULT: ${n} lifecycle groups passed; isolated synthetic fixture only.`);
}finally{await db.close();}
