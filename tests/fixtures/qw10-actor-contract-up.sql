-- DESIGN LAB ONLY. Not a deployable migration; no worker or production grants.
-- The marker is an accidental-use guard, not an authorization mechanism.
do $$ begin
  if to_regclass('qw10_actor_lab.only_synthetic_data') is null then
    raise exception 'Requires disposable actor-contract fixture';
  end if;
end $$;

create table private.inventory_automation_events (
  id uuid primary key,
  sku text not null references public.inventory_items(sku),
  service_name text not null check(service_name = 'payment-worker-test'),
  request_reference text not null check(length(btrim(request_reference)) > 0),
  checkout_session text not null check(checkout_session like 'cs_test_%'),
  payment_reference text not null check(length(btrim(payment_reference)) > 0),
  source_event text not null check(length(btrim(source_event)) > 0),
  livemode boolean not null check(livemode = false),
  recorded_at timestamptz not null default clock_timestamp(),
  unique(id,sku),
  unique(source_event,sku)
);
alter table private.inventory_automation_events enable row level security;
revoke all on private.inventory_automation_events from public,anon,authenticated,service_role;

alter table public.inventory_history
  add column actor_kind text not null default 'human',
  add column automation_event_id uuid,
  alter column changed_by drop not null,
  add constraint inventory_history_actor_contract check (
    (actor_kind='human' and changed_by is not null and automation_event_id is null)
    or
    (actor_kind='system' and changed_by is null and automation_event_id is not null)
  ),
  add constraint inventory_history_automation_binding
    foreign key(automation_event_id,sku)
    references private.inventory_automation_events(id,sku);
create unique index inventory_history_automation_once
  on public.inventory_history(automation_event_id,sku)
  where automation_event_id is not null;

-- Existing human triggers, RLS and grants are intentionally unchanged.
-- A verified receipt producer and atomic stock writer are separate gates.
