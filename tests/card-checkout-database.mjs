import {PGlite} from '@electric-sql/pglite';
import Stripe from 'stripe';
import {writeFileSync} from 'node:fs';
import assert from 'node:assert/strict';
import {fixtureSql,seedSql,owner,other,admin,sid,address,quote,identity,sqlService} from './card-database-fixture.mjs';
import {createCardCheckout} from '../supabase/functions/_shared/create-card-checkout.js';
import {cardCheckoutRpc} from '../supabase/functions/_shared/card-checkout-rpc.js';
import {cardPaymentRuntime} from '../supabase/functions/_shared/card-payment-runtime.js';

const db=new PGlite();let passed=0;
const pass=message=>console.log(`PASS ${++passed}: ${message}`);
const rows=async(sql,params=[])=>(await db.query(sql,params)).rows;
const scalar=async(sql,params=[])=>Object.values((await rows(sql,params))[0])[0];
async function role(name='service_role',uid='',session=''){
 await db.exec('reset role');await db.query("select set_config('test.uid',$1,false),set_config('test.sid',$2,false),set_config('test.aal','aal2',false)",[uid,session]);
 await db.exec(`set role ${name}`);
}
const reserve=async(q=quote(),key=crypto.randomUUID(),who=owner,id=identity(q))=>scalar('select public.card_checkout_reserve($1,$2,$3,$4)',[who,key,JSON.stringify(q),id]);
const bind=async(r,session='cs_live_'+r.id.replaceAll('-',''))=>{
 await db.query('select public.card_checkout_bind($1,$2,$3)',[r.id,r.ownerId,session]);return session;
};
const pay=async(r,{session=r.sessionId,payment='pi_'+r.id.replaceAll('-',''),amount=r.totalCents,currency='mxn',event='evt_'+r.id.replaceAll('-','')}={})=>
 scalar('select public.card_checkout_commit($1,$2,$3,$4,$5,$6)',[r.id,session,payment,amount,currency,event]);
async function state(){
 await role('postgres');const result=await scalar(`select jsonb_build_object('orders',(select count(*) from public.orders),
 'items',(select count(*) from public.order_items),'receipts',(select count(*) from private.card_payment_receipts),
 'stock',(select quantity from public.inventory_items where sku='fixture-sku'),
 'audit',(select count(*) from public.inventory_history where card_receipt_id is not null),
 'contexts',(select count(*) from private.card_inventory_write_context))`);await role();return result;
}
try{
 const schema=fixtureSql();await db.exec(schema);await db.exec(seedSql());
 if(process.argv.includes('--export-fixture'))writeFileSync('/tmp/rho-card-operational-fixture.sql',schema+seedSql());
 await role();await assert.rejects(reserve(),/card_checkout_disabled/);
 assert.equal((await state()).stock,10);pass('migration defaults disabled and preserves existing stock/history');
 await role('postgres');await db.query("update private.card_checkout_configuration set enabled=true,pinned_sha256=$1",['a'.repeat(64)]);await role();

 const key=crypto.randomUUID(),first=await reserve(quote(),key);
 assert.equal(first.quote.shippingCents,9900);assert.equal(first.totalCents,10564);assert.equal(first.environment,'live');
 assert.equal((await state()).orders,0);
 assert.deepEqual(await reserve(quote(),key),first);
 await assert.rejects(reserve(quote(3),key),/card_retry_changed/);
 await role('postgres');await db.exec('update public.products set price=4');await role();
 assert.deepEqual(await scalar('select public.card_checkout_load($1,$2)',[owner,key]),first);
 await assert.rejects(reserve(),/card_price_changed/);
 await role('postgres');await db.exec('update public.products set price=3.32');await role();
 pass('reservation persists frozen price, owner, shipping, expiry and retry identity');

 for(const bad of [{...quote(),shippingCents:0,totalCents:664},{...quote(),totalCents:1},quote(101),
   {...quote(),delivery:{...quote().delivery,catalogSha256:'b'.repeat(64)}},
   {...quote(),lines:[...quote().lines,...quote().lines]}])await assert.rejects(reserve(bad));
 await assert.rejects(reserve(quote(),crypto.randomUUID(),owner,identity(quote(3))),/card_cart_mismatch/);
 pass('database rechecks price, delivery digest, quantities and totals independently of the API');

 await role('authenticated',admin,admin);
 await assert.rejects(db.query("select public.inventory_adjust('fixture-sku','issue',9,1,'pieza',true,'Invades card hold',2)"),/reservad/);
 const manual=await scalar("select public.inventory_reservation('create','RHO-00000001',$1)",[JSON.stringify([{sku:'fixture-sku',quantity:8}])]);
 assert.equal(manual.action,'reserved');await role();await assert.rejects(reserve(quote(1)),/card_availability_changed/);
 await role('authenticated',admin,admin);await db.query("select public.inventory_reservation('cancel','RHO-00000001')");await role();
 pass('manual reservations and stock adjustments respect active card holds');

 for(const name of ['anon','authenticated','service_role']){
  await role(name,name==='authenticated'?owner:'',sid);
  await assert.rejects(db.query('select * from private.card_checkout_requests'),/permission denied/);
  await assert.rejects(db.query("insert into private.card_inventory_write_context(transaction_id,sku,receipt_id,old_quantity,new_quantity,old_revision) values(txid_current(),'fixture-sku',gen_random_uuid(),10,9,2)"),/permission denied/);
  if(name!=='service_role')await assert.rejects(reserve(),/permission denied/);
 }
 await role();await db.query("select set_config('rho.inventory_actor','system',false)");
 await assert.rejects(db.exec("update public.inventory_items set quantity=9 where sku='fixture-sku'"),/Solo administradores|permission denied/);
 pass('client roles cannot invoke payment mutations; service cannot forge context or a system inventory flag');

 await role();await assert.rejects(bind(first,'cs_test_fixture'),/card_invalid_session/);
 first.sessionId=await bind(first);await bind(first,first.sessionId);
 await assert.rejects(bind(first,'cs_live_other'),/card_binding_conflict/);
 for(const bad of [{amount:1},{currency:'usd'},{session:'cs_live_wrong'}])await assert.rejects(pay(first,bad),/card_payment_mismatch/);
 pass('session binding is immutable and payment identity/amount mismatches make no changes');

 // Real signature verifier, actual operational database RPC adapter, synthetic API.
 const secret='whsec_local_synthetic_fixture',apiKey=['rk','live','synthetic_fixture_only'].join('_');
 const sdk=new Stripe(apiKey,{apiVersion:'2026-08-26.dahlia'}),persistence=cardCheckoutRpc(sqlService(db));
 const session={id:first.sessionId,object:'checkout.session',livemode:true,mode:'payment',payment_status:'paid',
  payment_intent:'pi_integrated_fixture',amount_total:first.totalCents,currency:'mxn',client_reference_id:first.id,
  metadata:{rho_request_id:first.id,environment:'live'}};
 const webhook=cardPaymentRuntime({enabled:true,apiKey,signingSecret:secret,...persistence,
  Stripe:function(){return {webhooks:sdk.webhooks,checkout:{sessions:{retrieve:async()=>session}}};}});
 async function signedSend(eventId,type='checkout.session.completed',tamper=false){
  const body=JSON.stringify({id:eventId,object:'event',livemode:true,type,data:{object:{object:'checkout.session',id:first.sessionId}}});
  const signature=sdk.webhooks.generateTestHeaderString({payload:body,secret});
  return webhook(new Request('https://fixture.invalid',{method:'POST',headers:{'stripe-signature':signature},body:body+(tamper?' ':'')}));
 }
 assert.equal((await signedSend('evt_invalid','checkout.session.completed',true)).status,400);
 const before=await state();
 assert.equal((await (await signedSend('evt_integrated_fixture')).json()).status,'paid');
 const after=await state();assert.deepEqual(after,{orders:1,items:1,receipts:1,stock:8,audit:1,contexts:0});
 assert.equal((await (await signedSend('evt_repeated_fixture','checkout.session.async_payment_succeeded')).json()).status,'paid');
 assert.deepEqual(await state(),after);assert.equal(before.stock,10);
 await role('postgres');assert.equal(await scalar('select changed_by from public.inventory_history where card_receipt_id is not null'),null);
 assert.equal(Number(await scalar('select amount_total from public.orders')),105.64);
 assert.equal(Number(await scalar('select sum(line_total) from public.order_items')),6.64);await role();
 pass('signed payment commits one real-schema order, stock deduction and system audit; repeat stays idempotent');

 await role('authenticated',owner,sid);
 assert.equal((await scalar('select public.card_checkout_status($1)',[first.sessionId])).state,'paid');
 await role('authenticated',other,other);assert.equal(await scalar('select public.card_checkout_status($1)',[first.sessionId]),null);
 await role('authenticated',owner,other);await assert.rejects(db.query('select public.card_checkout_status($1)',[first.sessionId]),/transfer_auth_required/);
 await role('authenticated',admin,admin);await db.query("select set_config('test.aal','aal1',false)");
 await assert.rejects(db.query('select public.card_checkout_identity()'),/transfer_auth_required/);
 await role('postgres');await db.query('update public.profiles set deactivated_at=now() where id=$1',[owner]);
 await role('authenticated',owner,sid);await assert.rejects(db.query('select public.card_checkout_identity()'),/transfer_auth_required/);
 await role('postgres');await db.query('update public.profiles set deactivated_at=null where id=$1',[owner]);await role();
 pass('status is owner-scoped and enforces account, session and administrator MFA checks');

 const late=await reserve(quote(1));late.sessionId=await bind(late);
 await role('postgres');await db.query('update private.card_checkout_requests set expires_at=0 where id=$1',[late.id]);await role();
 const lateBefore=await state();assert.equal((await pay(late)).status,'reconciliation_required');
 const lateAfter=await state();assert.equal(lateAfter.orders,lateBefore.orders);assert.equal(lateAfter.stock,lateBefore.stock);
 assert.equal(lateAfter.receipts,lateBefore.receipts+1);await role('postgres');
 assert.equal(await scalar('select reason from private.card_payment_receipts where request_id=$1',[late.id]),'reservation_expired');await role();
 pass('late payment preserves receipt for review without order or inventory deduction');

 const atomic=await reserve(quote(1));atomic.sessionId=await bind(atomic);
 const atomicBefore=await state();
 await role('postgres');await db.exec(`create function public.fixture_fail_order_item() returns trigger language plpgsql as $$begin raise exception 'synthetic item failure';end$$;
 create trigger fixture_fail_order_item before insert on public.order_items for each row execute function public.fixture_fail_order_item();`);await role();
 await assert.rejects(pay(atomic),/synthetic item failure/);assert.deepEqual(await state(),atomicBefore);
 await role('postgres');assert.equal(await scalar('select hold_active from private.card_checkout_requests where id=$1',[atomic.id]),true);
 await db.exec('drop trigger fixture_fail_order_item on public.order_items;drop function public.fixture_fail_order_item()');await role();
 assert.equal((await pay(atomic)).status,'paid');pass('order failure rolls receipt, hold, stock and history back atomically; retry succeeds');

 const accepted=quote(1),retryKey=crypto.randomUUID();let createdParams;
 const checkout=await createCardCheckout({paymentMethod:'card',items:[{sku:'fixture-sku',quantity:1}],address,expectedTotalCents:accepted.totalCents},
 {enabled:true,ownerId:owner,retryKey,...persistence,quoteBuilder:async()=>accepted,stripe:{checkout:{sessions:{create:async(params)=>{
  createdParams=params;return {id:'cs_live_adapter_fixture',url:'https://checkout.stripe.com/c/pay/cs_live_adapter_fixture',
  livemode:true,status:'open',mode:'payment',payment_status:'unpaid',amount_total:params.line_items[0].price_data.unit_amount,
  currency:'mxn',client_reference_id:params.client_reference_id,metadata:params.metadata,expires_at:params.expires_at};}}}}});
 assert.equal((await persistence.loadRequest(checkout.sessionId)).id,checkout.requestId);
 assert.equal(createdParams.line_items[0].price_data.unit_amount,10232);
 pass('Checkout creation connects to operational reserve/load/bind RPCs with server shipping');

 await role('postgres');
 const unsafe=await rows("select p.proname from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname like 'card_checkout_%' and p.prosecdef");assert.deepEqual(unsafe,[]);
 assert.equal(await scalar("select count(*)::int from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='private' and c.relname in ('card_checkout_configuration','card_checkout_requests','card_checkout_lines','card_payment_receipts','card_inventory_write_context') and c.relrowsecurity"),5);
 const unbound=await scalar('select count(*)::int from public.inventory_history where (changed_by is null)=(card_receipt_id is null)');assert.equal(unbound,0);
 pass('private tables retain RLS, public wrappers use invoker privileges and every inventory history row has exactly one actor');
 console.log(`RESULT: ${passed} operational database groups passed; local synthetic payments only.`);
}finally{await db.close();}
