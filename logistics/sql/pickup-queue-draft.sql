-- DRAFT: isolated laboratory schema. Not a deployed migration.
-- A dedicated server connection runs the adapter; no browser/Data API access.
create schema rho_pickup;
revoke all on schema rho_pickup from public;
create table rho_pickup.jobs (
 job_key text primary key,
 environment text not null check(environment in ('test','live')),
 order_id text not null,
 revision text not null,
 state jsonb not null,
 version bigint not null default 0,
 created_at timestamptz not null default clock_timestamp(),
 updated_at timestamptz not null default clock_timestamp(),
 unique(environment,order_id),
 check(length(trim(order_id))>0 and length(trim(revision))>0),
 check(state->>'key' is not distinct from job_key),
 check(state->>'environment' is not distinct from environment),
 check(state->>'orderId' is not distinct from order_id),
 check(state->>'revision' is not distinct from revision)
);
create table rho_pickup.events (
 job_key text not null references rho_pickup.jobs(job_key),
 event_id text not null,
 payload jsonb not null,
 recorded_at timestamptz not null default clock_timestamp(),
 primary key(job_key,event_id)
);
create index pickup_jobs_status on rho_pickup.jobs(environment,(state->>'status'),updated_at);
alter table rho_pickup.jobs enable row level security;
alter table rho_pickup.events enable row level security;
revoke all on all tables in schema rho_pickup from public;
-- No grants or policies for anon/authenticated/service_role. Deployment must
-- provision a dedicated worker role and explicit RLS policies after review.
