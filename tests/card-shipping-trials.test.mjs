import {test} from 'node:test';
import assert from 'node:assert/strict';
import {PGlite} from '@electric-sql/pglite';
import {fixtureSql,seedSql,owner,other,quote,identity} from './card-database-fixture.mjs';
test('three owner-scoped shipping trials: retries, fourth use, ownership, rollback, paid amount and inventory',async()=>{
 const db=new PGlite();
 const one=async(sql,args=[])=>Object.values((await db.query(sql,args)).rows[0])[0];
 const role=async name=>db.exec('reset role;set role '+name);
 const reserve=(q,key=crypto.randomUUID(),who=owner)=>one('select public.card_checkout_reserve($1,$2,$3,$4)',[who,key,JSON.stringify(q),identity(q)]);
 try{
 await db.exec(fixtureSql()+seedSql());
 await db.query('update private.card_checkout_configuration set enabled=true,pinned_sha256=$1',['a'.repeat(64)]);
 const id=await one("insert into private.card_shipping_trials(owner_id,max_uses,reason) values($1,3,'Synthetic fixture') returning id",[owner]);
 const q={...quote(1),shippingTrialId:id,shippingCents:0,totalCents:332};
 await role('service_role');
 assert.equal((await one('select public.card_checkout_shipping_trial($1)',[owner])).remaining,3);
 assert.equal(await one('select public.card_checkout_shipping_trial($1)',[other]),null);
 await assert.rejects(reserve(q,crypto.randomUUID(),other),/card_shipping_trial_unavailable/);
 await assert.rejects(reserve({...q,totalCents:1}),/card_total_changed/);
 assert.equal((await one('select public.card_checkout_shipping_trial($1)',[owner])).remaining,3);
 const key=crypto.randomUUID(),first=await reserve(q,key);
 for(let i=0;i<4;i++)assert.deepEqual(await reserve(q,key),first);
 assert.equal((await one('select public.card_checkout_shipping_trial($1)',[owner])).remaining,2);
 await reserve(q);await reserve(q);
 assert.equal(await one('select public.card_checkout_shipping_trial($1)',[owner]),null);
 await assert.rejects(reserve(q),/card_shipping_trial_unavailable/);
 assert.deepEqual(await reserve(q,key),first);
 assert.equal((await reserve(quote(1))).quote.shippingCents,9900);
 assert.equal((await reserve(quote(1),crypto.randomUUID(),other)).quote.shippingCents,9900);
 const session='cs_live_trialfixture';
 await db.query('select public.card_checkout_bind($1,$2,$3)',[first.id,owner,session]);
 const pay=amount=>one('select public.card_checkout_commit($1,$2,$3,$4,$5,$6)',[first.id,session,'pi_trialfixture',amount,'mxn','evt_trialfixture']);
 await assert.rejects(pay(10232),/card_payment_mismatch/);
 await pay(332);await pay(332);
 await role('postgres');
 assert.equal(Number(await one('select count(*) from public.orders')),1);
 assert.equal(Number(await one('select amount_total from public.orders')),3.32);
 assert.equal(await one("select quantity from public.inventory_items where sku='fixture-sku'"),9);
 assert.equal(Number(await one('select count(*) from private.card_shipping_trial_uses')),3);
 for(const name of ['anon','authenticated']){
 await role(name);
 await assert.rejects(one('select public.card_checkout_shipping_trial($1)',[owner]),/permission denied/);
 await assert.rejects(one('select count(*) from private.card_shipping_trials'),/permission denied/);
 }
 }finally{await db.close();}
});
