-- Private server-side catalog, used only by the authenticated test checkout.
create table qw10_test.delivery_catalog (
 id boolean primary key default true check(id),
 catalog_text text not null check(length(catalog_text) between 100 and 4000000),
 pinned_sha256 text not null check(pinned_sha256 ~ '^[a-f0-9]{64}$'),
 enabled boolean not null default false,
 updated_at timestamptz not null default now()
);
alter table qw10_test.delivery_catalog enable row level security;
revoke all on qw10_test.delivery_catalog from public,anon,authenticated,service_role;
create function private.qw10_test_delivery_catalog()
returns jsonb language sql stable security definer set search_path='' as $$
 select jsonb_build_object('catalogText',catalog_text,'pinnedSha256',pinned_sha256)
 from qw10_test.delivery_catalog where id and enabled
$$;
revoke all on function private.qw10_test_delivery_catalog() from public,anon,authenticated;
grant execute on function private.qw10_test_delivery_catalog() to service_role;
grant usage on schema private to service_role;
create function public.qw10_test_delivery_catalog()
returns jsonb language sql stable security invoker set search_path='' as $$
 select private.qw10_test_delivery_catalog()
$$;
revoke all on function public.qw10_test_delivery_catalog() from public,anon,authenticated;
grant execute on function public.qw10_test_delivery_catalog() to service_role;
