import {readFile} from 'node:fs/promises';import assert from 'node:assert/strict';
const {PGlite}=await import(process.env.PGLITE_MODULE);const db=new PGlite();
try{
 await db.exec('create role anon;create role authenticated;create role service_role;');
 for(const f of ['qw10-isolated-test-order-store.sql','qw10-test-reservation-adapter.sql','qw10-special-orders-draft.sql','qw10-special-order-status.sql'])await db.exec(await readFile(new URL('../supabase/'+f,import.meta.url),'utf8'));
 await db.exec("insert into qw10_test.stock values('test-orange',1,true),('test-green',1,true),('test-zero',0,true)");
 const call=async(key,sku,qty,owner='owner')=>(await db.query('select public.qw10_test_special_order($1,$2,$3,$4) result',[owner,key,sku,qty])).rows[0].result;
 const a=await call('test_special_retry_01','test-orange',3);assert.equal(a.reserved,1);assert.equal(a.additional,2);
 assert.equal((await call('test_special_retry_01','test-orange',3)).reference,a.reference);
 await assert.rejects(()=>call('test_special_retry_01','test-green',3));
 await assert.rejects(()=>call('test_special_retry_01','test-orange',2));
 const status=async(owner,ref)=>(await db.query('select public.qw10_test_special_order_status($1,$2) result',[owner,ref])).rows[0].result;
 assert.equal((await status('owner',a.reference)).state,'active');
 assert.equal(await status('other-owner',a.reference),null);
 const before=JSON.stringify((await db.query('select * from qw10_test.quote_holds order by reference')).rows);
 await status('owner',a.reference);
 assert.equal(JSON.stringify((await db.query('select * from qw10_test.quote_holds order by reference')).rows),before);
 const b=await call('test_special_retry_01','test-orange',3,'other-owner');assert.notEqual(a.reference,b.reference);assert.equal(b.reserved,0);assert.equal(b.additional,3);
 const zero=await call('test_special_retry_02','test-zero',5);assert.equal(zero.reserved,0);assert.equal(zero.additional,5);
 const green=await call('test_special_retry_03','test-green',1);assert.equal(green.reserved,1);assert.equal(green.additional,0);
 await assert.rejects(()=>call('test_special_retry_04','unknown',1));await assert.rejects(()=>call('test_special_retry_04','test-green',0));
 assert.equal((await db.query('select sum(quantity)::int n from qw10_test.stock')).rows[0].n,2);
 assert.equal((await db.query('select count(*)::int n from qw10_test.quote_holds')).rows[0].n,2);
 for(const role of ['anon','authenticated']){await db.exec('set role '+role);await assert.rejects(()=>call('test_special_retry_05','test-green',1));await db.exec('reset role');}
 await db.exec("update qw10_test.special_requests set expires_at=clock_timestamp()-interval '1 second' where id='"+a.reference+"'; update qw10_test.quote_holds set expires_at=clock_timestamp()-interval '1 second' where reference='"+a.reference+"'");
 assert.equal((await status('owner',a.reference)).state,'expired');
 assert.equal((await db.query('select active from qw10_test.quote_holds where reference=$1',[a.reference])).rows[0].active,true);
 assert.equal((await status('other-owner',b.reference)).state,'quote_only');
 for(const role of ['anon','authenticated']){await db.exec('set role '+role);await assert.rejects(()=>status('owner',a.reference));await db.exec('reset role');}
 console.log('PASS partial reservation, excess separation, retry identity, owner isolation, exact variant, zero stock, invalid input, no stock deduction, client denial');
}finally{await db.close()}
