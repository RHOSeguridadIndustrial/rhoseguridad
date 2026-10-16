import {readFile} from 'node:fs/promises';
import assert from 'node:assert/strict';
const {PGlite}=await import(process.env.PGLITE_MODULE);
const db=new PGlite();
try {
 await db.exec('create role anon; create role authenticated; create role service_role;');
 await db.exec(await readFile(new URL('../supabase/payment-confirmation-prototype.sql',import.meta.url),'utf8'));
 await db.exec(await readFile(new URL('../supabase/qw10-test-reservation-adapter.sql',import.meta.url),'utf8'));
 await db.exec("insert into qw10_test.stock values ('cone',1,true)");
 const quote={currency:'mxn',totalCents:29100,lines:[{sku:'cone',quantity:1}]};
 const reserve=async(owner,key,q=quote)=>(await db.query('select public.qw10_test_reserve($1,$2,$3) r',[owner,key,JSON.stringify(q)])).rows[0].r;
 const a=await reserve('owner','retry_fixture_12345');
 const b=await reserve('owner','retry_fixture_12345');assert.equal(a.id,b.id);
 await assert.rejects(reserve('owner','retry_fixture_12345',{...quote,totalCents:1}));
 await assert.rejects(reserve('other','retry_fixture_67890'));
 await assert.rejects(db.query('select public.qw10_test_bind($1,$2,$3)',[a.id,'wrong','cs_test_reserve']));
 await db.query('select public.qw10_test_bind($1,$2,$3)',[a.id,'owner','cs_test_reserve']);
 await db.query('select public.qw10_test_bind($1,$2,$3)',[a.id,'owner','cs_test_reserve']);
 await assert.rejects(db.query('select public.qw10_test_bind($1,$2,$3)',[a.id,'owner','cs_test_different']));
 const r=(await db.query("select qw10_test.commit_payment($1,'cs_test_reserve','pi_reserve',29100,'mxn',false,'evt_reserve') r",[a.id])).rows[0].r;
 assert.equal(r.status,'paid');
 assert.equal((await db.query('select count(*)::int n from qw10_test.purchase_orders')).rows[0].n,1);
 console.log('PASS real SQL reserve→retry identity→stock exclusion→owner binding→single order; isolated PGlite only.');
} finally {await db.close();}
