import {readFile} from 'node:fs/promises';
import assert from 'node:assert/strict';
// Resolve a separately installed test runtime; no production database connection.
const {PGlite}=await import(process.env.PGLITE_MODULE || '@electric-sql/pglite');
const db=new PGlite();
try {
  await db.exec(await readFile(new URL('../supabase/payment-confirmation-prototype.sql',import.meta.url),'utf8'));
  await db.exec(`create role anon; create role authenticated;
    insert into qw10_test.requests values
    ('valid','cs_test_valid',29100,false,clock_timestamp()+interval '30 minutes',true),
    ('late','cs_test_late',29100,false,clock_timestamp()-interval '1 minute',true),
    ('cancelled','cs_test_cancelled',29100,false,clock_timestamp()+interval '30 minutes',false),
    ('other','cs_test_other',29100,false,clock_timestamp()+interval '30 minutes',true)`);
  const pay=async(id='valid',pi='pi_valid',amount=29100,currency='mxn',live=false,event='evt_first')=>
    (await db.query('select qw10_test.commit_payment($1,$2,$3,$4,$5,$6,$7) result',
      [id,'cs_test_'+id,pi,amount,currency,live,event])).rows[0].result;
  const results=await Promise.all([pay(),pay('valid','pi_valid',29100,'mxn',false,'evt_repeat')]);
  assert.equal(results[0].orderId,results[1].orderId);
  assert.equal((await db.query('select count(*)::int n from qw10_test.purchase_orders')).rows[0].n,1);
  assert.equal((await db.query('select count(*)::int n from qw10_test.receipts')).rows[0].n,1);
  console.log('PASS queued repeated confirmations: one receipt and one order');
  for(const args of [['valid','pi_other'],['valid','pi_valid',19200],['valid','pi_valid',29100,'usd'],['valid','pi_valid',29100,'mxn',true]])
    await assert.rejects(pay(...args));
  await assert.rejects(pay('other','pi_valid'));
  assert.equal((await db.query("select count(*)::int n from qw10_test.receipts where request_id='other'")).rows[0].n,0);
  console.log('PASS altered amount/currency/environment/payment rejected; payment reuse rolls back');
  for(const id of ['late','cancelled']) {
    const result=await pay(id,'pi_'+id);
    assert.equal(result.status,'reconciliation_required');assert.equal(result.orderId,null);
    assert.deepEqual(await pay(id,'pi_'+id),{...result,repeated:true});
  }
  assert.equal((await db.query('select count(*)::int n from qw10_test.purchase_orders')).rows[0].n,1);
  console.log('PASS late/cancelled hold: payment recorded, no fulfillment order');
  for(const role of ['anon','authenticated']) {
    await db.exec('set role '+role);
    await assert.rejects(pay());await assert.rejects(db.query('select * from qw10_test.receipts'));
    await db.exec('reset role');
  }
  console.log('PASS client roles cannot confirm or read private receipts');
  console.log('LIMIT: isolated PGlite queues one connection; real signature/webhook, shared QW9 stock locks and multi-session contention remain untested.');
} finally {await db.close();}
