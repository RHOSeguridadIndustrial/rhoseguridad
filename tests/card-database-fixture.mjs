import {readFileSync} from 'node:fs';
export const migrationPath='supabase/migrations/20261106094135_card_checkout_operational.sql';
export const owner='11111111-1111-4111-8111-111111111111';
export const other='22222222-2222-4222-8222-222222222222';
export const admin='33333333-3333-4333-8333-333333333333';
export const sid='44444444-4444-4444-8444-444444444444';
export const address={country:'MX',state:'CMX',postalCode:'02000',municipalityCode:'002',settlementCode:'0001',
 street:'Calle sintética',exterior:'10',interior:'',reference:''};
export function quote(quantity=2,sku='fixture-sku',price=332){
 const subtotal=quantity*price, shipping=subtotal<29900?9900:0;
 return {currency:'mxn',paymentMethod:'card',lines:[{sku,name:sku,quantity,unitPriceCents:price,lineTotalCents:subtotal}],
 subtotalCents:subtotal,shippingCents:shipping,totalCents:subtotal+shipping,mode:subtotal>120000?'express':'standard',
 delivery:{status:'postal_match',assurance:'postal_catalog_only',catalogSha256:'a'.repeat(64),
 validUntil:'2099-01-01T00:00:00Z',address:{...address,municipality:'Azcapotzalco',settlement:'Centro'}}};
}
export const identity=q=>JSON.stringify({address,paymentMethod:'card',items:q.lines.map(l=>({sku:l.sku,quantity:l.quantity})).sort((a,b)=>a.sku.localeCompare(b.sku))});
// Isolated schema reproduces the inspected operational orders constraints and
// exact committed inventory/reservation/rename/identity definitions. Auth uses
// synthetic sessions; this is not a claim of remote JWT verification.
export function fixtureSql(){return `
create role anon;create role authenticated;create role service_role bypassrls;
create schema auth;create schema private;
grant usage on schema auth,private to authenticated,service_role;
alter default privileges in schema public grant all on tables to service_role;
alter default privileges in schema private grant all on tables to service_role;
alter default privileges in schema private grant execute on functions to service_role;
create table auth.users(id uuid primary key,email_confirmed_at timestamptz,is_anonymous boolean,banned_until timestamptz);
create table auth.sessions(id uuid primary key,user_id uuid,not_after timestamptz);
create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('test.uid',true),'')::uuid$$;
create function auth.jwt() returns jsonb language sql stable as $$select jsonb_build_object('session_id',current_setting('test.sid',true))$$;
create table public.profiles(id uuid primary key,email text,full_name text,phone text,deactivated_at timestamptz);
create function private.customer_account_enabled() returns boolean language sql stable security definer set search_path='' as $$
 select exists(select 1 from public.profiles where id=auth.uid() and deactivated_at is null)$$;
create function private.current_user_is_admin() returns boolean language sql stable as $$select auth.uid()='${admin}'::uuid$$;
create function private.is_admin() returns boolean language sql stable as $$select private.current_user_is_admin() and current_setting('test.aal',true)='aal2'$$;
create table public.products(id text primary key,name text,price numeric(12,2),currency char(3),is_active boolean);
grant select on public.products to anon,authenticated;
create table public.orders(id uuid primary key default gen_random_uuid(),checkout_session_id text unique,
 payment_intent_id text,status text not null default 'pending' check(status in ('pending','paid','expired','cancelled','refunded','failed')),
 customer_email text,customer_name text,amount_total numeric(12,2) not null default 0 check(amount_total>=0),
 currency char(3) not null default 'MXN' check(currency~'^[A-Z]{3}$'),created_at timestamptz not null default now(),
 paid_at timestamptz,updated_at timestamptz not null default now());
create table public.order_items(id bigint generated always as identity primary key,order_id uuid not null references public.orders(id) on delete cascade,
 product_id text not null references public.products(id),product_name text not null,requested_item_id text,
 quantity integer not null check(quantity>0 and quantity<=100),unit_price numeric(12,2) not null check(unit_price>=0),
 line_total numeric(12,2) not null check(line_total>=0),created_at timestamptz not null default now());
alter table public.orders enable row level security;alter table public.order_items enable row level security;
revoke all on public.orders,public.order_items from public,anon,authenticated;
create table private.quote_request_references(serial_number integer primary key);
${readFileSync('supabase/migrations/20261007181348_add_admin_inventory_and_pending_purchase_import.sql','utf8')}
${readFileSync('supabase/reservations.sql','utf8')}
${readFileSync('supabase/migrations/20261024203615_inventory_rename_audited.sql','utf8')}
${readFileSync('supabase/migrations/20261101065319_transfer_purchase_requests.sql','utf8')}
${readFileSync(migrationPath,'utf8')}
`;}
export function seedSql(){return `
insert into auth.users values('${owner}',now(),false,null),('${other}',now(),false,null),('${admin}',now(),false,null);
insert into auth.sessions values('${sid}','${owner}',null),('${other}','${other}',null),('${admin}','${admin}',null);
insert into public.profiles values('${owner}','buyer@example.test','Comprador','5555555555',null),
 ('${other}','other@example.test','Otro','5555555556',null),('${admin}','admin@example.test','Administrador','5555555557',null);
insert into public.products values('fixture-product','Synthetic product',3.32,'MXN',true);
insert into private.quote_request_references values(1),(2),(3);
select set_config('test.uid','${admin}',false),set_config('test.aal','aal2',false);
set role authenticated;
select public.inventory_create('fixture-sku','fixture-product','fixture-sku','pieza');
select public.inventory_create('fixture-second','fixture-product','fixture-second','pieza');
select public.inventory_adjust('fixture-sku','receive',10,1,'pieza',true,'Fixture initial stock',1);
select public.inventory_adjust('fixture-second','receive',10,1,'pieza',true,'Fixture initial stock',1);
reset role;select set_config('test.uid','',false);
`;}
export function sqlService(db){
 const signatures={card_checkout_config:[],card_checkout_variant:['p_sku'],card_checkout_load:['p_owner','p_retry'],
 card_checkout_reserve:['p_owner','p_retry','p_quote','p_identity'],card_checkout_bind:['p_request','p_owner','p_session'],
 card_checkout_load_payment:['p_session'],card_checkout_commit:['p_request','p_session','p_payment','p_amount','p_currency','p_event']};
 return {rpc:async(name,args={})=>{
  const names=signatures[name];if(!names)throw Error('Unknown fixture RPC');
  try{return {data:(await db.query(`select public.${name}(${names.map((_,i)=>'$'+(i+1)).join(',')}) result`,names.map(n=>typeof args[n]==='object'?JSON.stringify(args[n]):args[n]))).rows[0].result,error:null};}
  catch(error){return {data:null,error};}
 }};
}
