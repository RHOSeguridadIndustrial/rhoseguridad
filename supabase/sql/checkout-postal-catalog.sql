-- Internal postal lookup cache. Browsers receive only the requested postcode.
create table public.checkout_postal_catalog (
  prefix text primary key check (prefix ~ '^[0-9]{2}$'),
  compressed_payload text not null check (length(compressed_payload) between 1 and 1000000),
  source_sha256 text not null check (source_sha256 ~ '^[a-f0-9]{64}$'),
  source_updated_on date not null,
  loaded_at timestamptz not null default now()
);
alter table public.checkout_postal_catalog enable row level security;
revoke all on public.checkout_postal_catalog from public, anon, authenticated;
grant select on public.checkout_postal_catalog to service_role;
comment on table public.checkout_postal_catalog is 'Internal SEPOMEX cache; no direct customer access. Only postal-lookup returns individual postcode suggestions.';
