import {createRequire} from 'node:module';
import {readFileSync} from 'node:fs';
import assert from 'node:assert/strict';
const require=createRequire(import.meta.url);
const {PGlite}=require('@electric-sql/pglite');
const db=new PGlite();
const admin='11111111-1111-4111-8111-111111111111',customer='22222222-2222-4222-8222-222222222222',sid='33333333-3333-4333-8333-333333333333';
const run='44444444-4444-4444-8444-444444444444',otherRun='55555555-5555-4555-8555-555555555555';
await db.exec(`create role anon;create role authenticated;create role service_role;create schema auth;create schema private;
create function auth.jwt() returns jsonb language sql stable as $$select coalesce(nullif(current_setting('request.jwt.claims',true),'')::jsonb,'{}'::jsonb)$$;
create function auth.uid() returns uuid language sql stable as $$select nullif(auth.jwt()->>'sub','')::uuid$$;
create table auth.users(id uuid primary key);
create table auth.sessions(id uuid primary key,user_id uuid references auth.users(id),aal text,created_at timestamptz default now(),not_after timestamptz);
create table auth.mfa_factors(id uuid default gen_random_uuid(),user_id uuid,factor_type text,status text);
create table profiles(id uuid primary key,role text,deactivated_at timestamptz);
create function private.is_admin() returns boolean language sql as $$select false$$;
alter table profiles enable row level security;
grant usage on schema public,private,auth to authenticated;grant select on profiles to authenticated;
create policy profile_read on profiles for select to authenticated using(id=auth.uid() or private.is_admin());
insert into auth.users values('${admin}'),('${customer}');insert into profiles values('${admin}','admin',null),('${customer}','customer',null);
insert into auth.sessions(id,user_id,aal)values('${sid}','${admin}','aal2');
insert into auth.mfa_factors(user_id,factor_type,status)values('${admin}','totp','verified');`);
await db.exec(readFileSync('supabase/migrations/20261007204123_harden_admin_mfa_and_sessions.sql','utf8'));
await db.exec(readFileSync('supabase/migrations/20261008060826_procurement_campaign_control.sql','utf8'));
const claims={sub:admin,session_id:sid,aal:'aal2',amr:[{method:'totp',timestamp:Math.floor(Date.now()/1000)}]};
const setClaims=async overrides=>db.query("select set_config('request.jwt.claims',$1,false)",[JSON.stringify({...claims,...overrides})]);
const value=async(q,args=[])=>(await db.query(q,args)).rows[0].value;
const get=()=>value('select public.admin_procurement_get() as value');
const set=(mode,rev)=>value('select public.admin_procurement_set($1,$2) as value',[mode,rev]);
const check=(id,rev=null)=>value('select private.procurement_runner_check($1,$2) as value',[id,rev]);

await db.exec('set role anon');await assert.rejects(get());await assert.rejects(set('active',1));await db.exec('reset role');
for(const overrides of [{sub:customer},{aal:'aal1'},{session_id:run}]){
  await setClaims(overrides);await db.exec('set role authenticated');await assert.rejects(get());await assert.rejects(set('active',1));await db.exec('reset role');
}
console.log('PASS anonymous, customer, AAL1 and revoked/nonexistent sessions cannot control campaign');
await setClaims({});await db.query('select public.admin_session_touch()');await db.exec('set role authenticated');
let c=await get();assert.equal(c.mode,'paused');assert.equal(c.events.length,1);
await assert.rejects(db.query('update private.procurement_control set mode=\'active\''));
await assert.rejects(db.query('select * from private.procurement_control_events'));
await assert.rejects(check(run));await assert.rejects(value('select private.procurement_snapshot() as value'));
await assert.rejects(set('invalid',1));await assert.rejects(set(null,1));
c=await set('active',1);assert.equal(c.mode,'active');assert.equal(c.revision,2);assert.equal(c.events[0].by_admin,true);
assert.equal((await set('active',2)).revision,2);
await assert.rejects(set('off',1));assert.equal((await get()).mode,'active');
console.log('PASS authenticated RPC, audit, idempotence, direct-table denial and stale revision rejection');
await db.exec('reset role');let gate=await check(run);assert.equal(gate.allow_work,true);assert.equal(gate.revision,2);
assert.equal((await check(otherRun)).reason,'busy');
await db.exec('set role authenticated');c=await set('paused',2);await db.exec('reset role');
assert.equal((await check(run,2)).allow_work,false);
await db.exec('set role authenticated');c=await set('active',3);await db.exec('reset role');
assert.equal((await check(run,2)).reason,'superseded');
assert.equal((await check(otherRun)).allow_work,true);
assert.equal(await value('select private.procurement_runner_finish($1,$2,$3) as value',[run,2,'completed']),false);
assert.equal(await value('select private.procurement_runner_finish($1,$2,$3) as value',[otherRun,4,'completed']),true);
await db.exec('set role authenticated');c=await set('off',4);await db.exec('reset role');
assert.equal((await check(run)).allow_work,false);assert.equal((await check(run)).allow_contact,false);
console.log('PASS exclusive worker lease, pause invalidation, old-run rejection after resume and off gate');
for(const [time,expected] of [
  ['2026-10-08T08:59:59-06:00',false],['2026-10-08T09:00:00-06:00',true],
  ['2026-10-08T17:59:59-06:00',true],['2026-10-08T18:00:00-06:00',false],
  ['2026-10-10T12:00:00-06:00',false],['2026-10-11T12:00:00-06:00',false],
  ['2026-10-12T09:00:00-06:00',true]
])assert.equal(await value('select private.procurement_contact_open($1) as value',[time]),expected,time);
console.log('PASS CDMX opening/closing boundaries and weekends');
await db.query('delete from auth.sessions where id=$1',[sid]);await db.exec('set role authenticated');await assert.rejects(get());await assert.rejects(set('active',5));await db.exec('reset role');
assert.equal((await db.query('select * from private.procurement_control_events')).rows.length,5);
await db.close();console.log('PASS session revocation and retained history');
