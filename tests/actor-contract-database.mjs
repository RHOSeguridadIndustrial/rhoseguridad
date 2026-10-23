import {PGlite} from '@electric-sql/pglite';
import {readFile} from 'node:fs/promises';
import assert from 'node:assert/strict';

// In-memory only: no Supabase URL, keys, browser sessions or production records.
const db = new PGlite();
const admin = '11111111-1111-4111-8111-111111111111';
const event = '22222222-2222-4222-8222-222222222222';
const load = path => readFile(new URL(path,import.meta.url),'utf8');
const up = await load('./fixtures/qw10-actor-contract-up.sql');
const down = await load('./fixtures/qw10-actor-contract-down.sql');
let passed=0;
const pass = name => { passed++; console.log(`PASS ${passed}: ${name}`); };
const one = async sql => (await db.query(sql)).rows[0];
async function denied(sql,code) {
  await assert.rejects(db.exec(sql),e=>e.code===code);
}
try {
  await denied(up,'P0001');
  pass('lab script refuses an unmarked database');
  await db.exec(`create role anon;create role authenticated;create role service_role;
    create schema private;create schema auth;create schema qw10_actor_lab;
    create table qw10_actor_lab.only_synthetic_data(marker boolean);
    create table auth.users(id uuid primary key);
    insert into auth.users values('${admin}');
    create function auth.uid() returns uuid language sql as
      $$select nullif(current_setting('test.uid',true),'')::uuid$$;
    create function private.is_admin() returns boolean language sql as
      $$select auth.uid()='${admin}'::uuid and current_setting('test.aal',true)='aal2'$$;
    grant usage on schema private,auth to authenticated,service_role;
    create table public.products(id text primary key,is_active boolean not null);
    grant select on public.products to anon,authenticated;
    insert into public.products values('lab-product',true);
    select set_config('test.uid','${admin}',false);
    select set_config('test.aal','aal2',false);`);
  // Exact committed operational inventory migration and reservation triggers.
  await db.exec(await load('../supabase/migrations/20261007181348_add_admin_inventory_and_pending_purchase_import.sql'));
  await db.exec(`create table private.quote_request_references(serial_number integer primary key);
    insert into private.quote_request_references values(1);`);
  await db.exec(await load('../supabase/reservations.sql'));
  await db.exec(`set role authenticated;
    select public.inventory_create('lab-a','lab-product','Synthetic A','pieza');
    select public.inventory_create('lab-b','lab-product','Synthetic B','pieza');
    select public.inventory_adjust('lab-a','receive',5,1,'pieza',true,'Fixture receipt',1);
    reset role;`);
  const baseline=(await db.query('select * from public.inventory_history order by id')).rows;
  const triggerFingerprint=await one(`select string_agg(pg_get_functiondef(p.oid),E'\n' order by p.proname) value
    from pg_trigger t join pg_proc p on p.oid=t.tgfoid
    where t.tgrelid='public.inventory_items'::regclass and not t.tgisinternal`);
  await db.exec('begin');await db.exec(up);
  const upgraded=(await db.query('select * from public.inventory_history order by id')).rows;
  assert.equal(upgraded.length,baseline.length);
  for(let i=0;i<baseline.length;i++) {
    const {actor_kind,automation_event_id,...oldColumns}=upgraded[i];
    assert.equal(actor_kind,'human');assert.equal(automation_event_id,null);
    assert.deepEqual(oldColumns,baseline[i]);
  }
  pass('upgrade preserves every historical column and identifies legacy rows as human');
  await db.exec(down);await db.exec('commit');
  assert.deepEqual((await db.query('select * from public.inventory_history order by id')).rows,baseline);
  pass('reversal without automatic events restores original data and columns');
  await db.exec(up);
  await db.exec(`set role authenticated;
    select public.inventory_adjust('lab-a','receive',1,1,'pieza',true,'Manual after upgrade',2);
    reset role;`);
  assert.deepEqual(await one(`select actor_kind,changed_by,automation_event_id from public.inventory_history order by id desc limit 1`),
    {actor_kind:'human',changed_by:admin,automation_event_id:null});
  pass('existing manual adjustment and audit remain compatible');
  await db.exec(`set role authenticated;select set_config('test.aal','aal1',false);`);
  await denied(`select public.inventory_adjust('lab-a','issue',1,1,'pieza',true,'Unauthorized',3)`,'42501');
  await db.exec(`select set_config('test.aal','aal2',false);
    select public.inventory_reservation('create','RHO-00000001','[{"sku":"lab-a","quantity":5}]');`);
  await denied(`select public.inventory_adjust('lab-a','issue',2,1,'pieza',true,'Invades reserved',3)`,'P0001');
  await db.exec('reset role');
  assert.equal((await one(`select quantity from public.inventory_items where sku='lab-a'`)).quantity,6);
  pass('MFA and reservation-floor guards still reject unauthorized or conflicting adjustments');
  const insertHistory=(kind,who,eventId,sku='lab-a') => `insert into public.inventory_history
    (sku,old_quantity,new_quantity,old_state,new_state,new_details,reason,changed_by,actor_kind,automation_event_id)
    values('${sku}',6,5,'tracked','tracked','{}','Synthetic model validation',${who},'${kind}',${eventId})`;
  await denied(insertHistory('human','null','null'),'23514');
  await denied(insertHistory('system',`'${admin}'`,`'${event}'`),'23514');
  await denied(insertHistory('system','null','null'),'23514');
  await denied(insertHistory('unknown',`'${admin}'`,'null'),'23514');
  await denied(insertHistory('system','null',`'${event}'`),'23503');
  pass('missing, mixed, unknown and unbound actor identities are rejected');
  const insertEvent = `insert into private.inventory_automation_events
    (id,sku,service_name,request_reference,checkout_session,payment_reference,source_event,livemode)
    values('${event}','lab-a','payment-worker-test','request-fixture','cs_test_fixture','pi_fixture','evt_fixture',false)`;
  for(const role of ['anon','authenticated','service_role']) {
    await db.exec(`set role ${role}`);
    await denied(insertEvent,'42501');
    await denied(insertHistory('system','null',`'${event}'`),'42501');
    await db.exec('reset role');
  }
  pass('client and backend roles gain no direct event or history insertion privilege');
  await db.exec(`set role authenticated;select set_config('rho.inventory_actor','system',false);`);
  await denied(insertEvent,'42501');
  await db.exec(`select set_config('test.uid','',false);`);
  // RLS hides writable rows from this caller; UPDATE can validly affect zero rows.
  const blockedUpdate=await db.query(`update public.inventory_items set quantity=5 where sku='lab-a' returning sku`);
  assert.equal(blockedUpdate.rows.length,0);
  await db.exec(`reset role;select set_config('test.uid','${admin}',false);`);
  assert.equal((await one(`select quantity from public.inventory_items where sku='lab-a'`)).quantity,6);
  pass('a caller-provided system flag does not grant automatic inventory access');
  await denied(insertEvent.replace(',false)',',true)'),'23514');
  await denied(insertEvent.replace('cs_test_fixture','cs_live_fixture'),'23514');
  pass('lab evidence rejects live-mode and live-session fixtures');
  // Only the isolated fixture owner inserts model rows; this is NOT a worker API.
  await db.exec('begin');await db.exec(insertEvent);
  await denied(insertHistory('system','null',`'${event}'`,'lab-b'),'23503');
  await db.exec('rollback');
  await db.exec('begin');await db.exec(insertEvent);await db.exec(insertHistory('system','null',`'${event}'`));await db.exec('commit');
  await denied(insertHistory('system','null',`'${event}'`),'23505');
  pass('system evidence binds to the exact SKU and cannot duplicate its history entry');
  const countBefore=await one('select count(*)::int n from public.inventory_history');
  await db.exec('begin');await assert.rejects(db.exec(down),/Automatic evidence exists/);await db.exec('rollback');
  assert.deepEqual(await one('select count(*)::int n from public.inventory_history'),countBefore);
  assert.equal((await one('select count(*)::int n from private.inventory_automation_events')).n,1);
  pass('rollback refuses to discard automatic evidence');
  assert.deepEqual(await one(`select string_agg(pg_get_functiondef(p.oid),E'\n' order by p.proname) value
    from pg_trigger t join pg_proc p on p.oid=t.tgfoid
    where t.tgrelid='public.inventory_items'::regclass and not t.tgisinternal`),triggerFingerprint);
  pass('all three operational trigger functions remain byte-identical');
  console.log(`RESULT: ${passed} checks passed. Local synthetic database only.`);
  console.log('LIMIT: no payment verification, worker authorization, atomic consumption, JWT verification or concurrent sessions certified.');
} finally {await db.close();}
