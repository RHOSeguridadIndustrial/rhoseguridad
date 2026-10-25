-- LAB ONLY. Apply after pickup-queue-draft.sql and QW10 source tables exist.
-- NOLOGIN: credentials and LOGIN membership are intentionally not provisioned.
create role rho_pickup_worker nologin noinherit nobypassrls;
grant usage on schema rho_pickup,qw10_test to rho_pickup_worker;
grant select on qw10_test.requests,qw10_test.receipts,qw10_test.purchase_orders,
 qw10_test.preparation_events to rho_pickup_worker;
create policy pickup_source_requests on qw10_test.requests for select to rho_pickup_worker using(livemode=false);
create policy pickup_source_receipts on qw10_test.receipts for select to rho_pickup_worker using(true);
create policy pickup_source_orders on qw10_test.purchase_orders for select to rho_pickup_worker using(true);
create policy pickup_source_preparation on qw10_test.preparation_events for select to rho_pickup_worker using(true);
grant select,insert on rho_pickup.jobs,rho_pickup.events to rho_pickup_worker;
grant update(state,version,updated_at) on rho_pickup.jobs to rho_pickup_worker;
create policy pickup_jobs_read on rho_pickup.jobs for select to rho_pickup_worker using(environment='test');
create policy pickup_jobs_insert on rho_pickup.jobs for insert to rho_pickup_worker with check(environment='test');
create policy pickup_jobs_update on rho_pickup.jobs for update to rho_pickup_worker using(environment='test') with check(environment='test');
create policy pickup_events_read on rho_pickup.events for select to rho_pickup_worker
 using(exists(select 1 from rho_pickup.jobs j where j.job_key=events.job_key and j.environment='test'));
create policy pickup_events_insert on rho_pickup.events for insert to rho_pickup_worker
 with check(exists(select 1 from rho_pickup.jobs j where j.job_key=events.job_key and j.environment='test'));
