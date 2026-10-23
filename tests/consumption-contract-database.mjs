import {PGlite} from '@electric-sql/pglite';
import {readFile} from 'node:fs/promises';
import assert from 'node:assert/strict';
const db=new PGlite();let n=0;
const pass=s=>console.log(`PASS ${++n}: ${s}`);
const q=async sql=>(await db.query(sql)).rows;
const call=()=>q("select consumption_lab.consume('r1','e1') result");
const snapshot=async()=>Promise.all(['stock','orders','history','holds'].map(t=>q(`select * from consumption_lab.${t} order by 1,2`)));
try {
 await db.exec(await readFile(new URL('./fixtures/qw10-consumption-lab.sql',import.meta.url),'utf8'));
 await db.exec(`insert into consumption_lab.stock values('a',5),('b',2);
 insert into consumption_lab.requests values('r1','owner1','cs_test_fixture',1000,'mxn');
 insert into consumption_lab.lines values('r1','a',2),('r1','b',1);
 insert into consumption_lab.holds values('r1','a',2,true,clock_timestamp()+interval '1 hour'),('other','a',3,true,clock_timestamp()+interval '1 hour'),('expired','b',2,true,clock_timestamp()-interval '1 hour');
 insert into consumption_lab.receipts values('e1','r1','owner1','cs_test_fixture','pi_fixture',1000,'mxn','paid',false);`);
 for(const [column,value] of [['owner_id',"'other'"],['request_id',"'other'"],['session_id',"'cs_live_wrong'"],['amount','999'],['currency',"'usd'"],['state',"'unpaid'"],['livemode','true'],['payment_id',"''"]]) {
   const before=await snapshot();await db.exec('begin');
   await db.exec(`update consumption_lab.receipts set ${column}=${value} where id='e1'`);
   await assert.rejects(call(),/Receipt binding rejected/);await db.exec('rollback');
   assert.deepEqual(await snapshot(),before);pass(`rejects mismatched ${column} without side effects`);
 }
 // Failure after first SKU write must roll back the entire function statement.
 await db.exec("update consumption_lab.stock set quantity=0 where sku='b'");
 let before=await snapshot();await assert.rejects(call(),/Insufficient unreserved stock/);
 assert.deepEqual(await snapshot(),before);pass('second SKU failure rolls back stock, order, history and holds');
 await db.exec("update consumption_lab.stock set quantity=2 where sku='b'");
 await db.exec(`create function consumption_lab.reject_audit() returns trigger language plpgsql as $$begin raise exception 'Injected audit failure';end$$;
 create trigger reject_audit before insert on consumption_lab.history for each row execute function consumption_lab.reject_audit();`);
 before=await snapshot();await assert.rejects(call(),/Injected audit failure/);assert.deepEqual(await snapshot(),before);
 await db.exec('drop trigger reject_audit on consumption_lab.history');pass('audit failure rolls back complete consumption');
 assert.equal((await call())[0].result,'consumed');
 assert.deepEqual(await q('select * from consumption_lab.stock order by sku'),[{sku:'a',quantity:3},{sku:'b',quantity:1}]);
 assert.equal((await q('select * from consumption_lab.history')).length,2);
 assert.equal((await q("select active from consumption_lab.holds where reference='r1'"))[0].active,false);
 assert.equal((await q("select active from consumption_lab.holds where reference='other'"))[0].active,true);
 pass('consumption preserves other active reservations and ignores expired holds');
 before=await snapshot();assert.equal((await call())[0].result,'already_consumed');assert.deepEqual(await snapshot(),before);
 pass('identical retry makes no second order, stock deduction or audit');
 await db.exec("insert into consumption_lab.receipts select 'e2',request_id,owner_id,session_id,'pi_other',amount,currency,state,livemode from consumption_lab.receipts where id='e1'");
 await assert.rejects(q("select consumption_lab.consume('r1','e2')"),/Conflicting receipt/);
 assert.deepEqual(await snapshot(),before);pass('different receipt cannot reuse consumed request');
 await db.exec('create role authenticated;grant usage on schema consumption_lab to authenticated;set role authenticated');
 await assert.rejects(call(),e=>e.code==='42501');await db.exec('reset role');
 pass('client role cannot call consumption function');
 console.log(`RESULT: ${n} passed. Synthetic in-memory data only; no external writes.`);
} finally {await db.close();}
