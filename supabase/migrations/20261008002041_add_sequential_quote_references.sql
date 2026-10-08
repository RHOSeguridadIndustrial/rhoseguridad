-- Approved sequential request references; this does not register sales.
create schema if not exists private;

create table private.quote_reference_counter (
  singleton boolean primary key default true check (singleton),
  last_value integer not null default 0 check (last_value between 0 and 99999999)
);
insert into private.quote_reference_counter (singleton, last_value) values (true, 0);

create table private.quote_request_references (
  request_key uuid primary key,
  fingerprint text not null check (fingerprint ~ '^[a-f0-9]{64}$'),
  serial_number integer not null unique check (serial_number between 1 and 99999999),
  created_at timestamptz not null default now()
);
create index quote_request_references_created_idx on private.quote_request_references (created_at);

alter table private.quote_reference_counter enable row level security;
alter table private.quote_request_references enable row level security;
revoke all on private.quote_reference_counter, private.quote_request_references from public, anon, authenticated;
grant usage on schema private to service_role;
grant select, update on private.quote_reference_counter to service_role;
grant select, insert on private.quote_request_references to service_role;

create function public.allocate_quote_reference(p_request_key uuid, p_fingerprint text)
returns text language plpgsql security invoker set search_path = '' as $$
declare
  previous private.quote_request_references%rowtype;
  next_number integer;
begin
  if p_request_key is null or p_fingerprint is null or p_fingerprint !~ '^[a-f0-9]{64}$' then
    raise exception 'invalid_quote_request' using errcode = '22023';
  end if;
  perform 1 from private.quote_reference_counter where singleton = true for update;
  if not found then raise exception 'quote_counter_unavailable'; end if;

  select * into previous from private.quote_request_references where request_key = p_request_key;
  if found then
    if previous.fingerprint <> p_fingerprint then
      raise exception 'quote_request_conflict' using errcode = '22023';
    end if;
    return 'RHO-' || lpad(previous.serial_number::text, 8, '0');
  end if;

  if (select count(*) from private.quote_request_references where created_at >= now() - interval '1 minute') >= 60
     or (select count(*) from private.quote_request_references where created_at >= now() - interval '24 hours') >= 1000 then
    raise exception 'quote_reference_rate_limit';
  end if;

  update private.quote_reference_counter set last_value = last_value + 1
    where singleton = true and last_value < 99999999 returning last_value into next_number;
  if not found then raise exception 'quote_reference_exhausted'; end if;

  insert into private.quote_request_references (request_key, fingerprint, serial_number)
    values (p_request_key, p_fingerprint, next_number);
  return 'RHO-' || lpad(next_number::text, 8, '0');
end;
$$;
revoke all on function public.allocate_quote_reference(uuid, text) from public, anon, authenticated;
grant execute on function public.allocate_quote_reference(uuid, text) to service_role;
comment on function public.allocate_quote_reference(uuid, text) is
  'Service-only atomic request reference. Does not register a sale, reserve stock, or confirm WhatsApp delivery.';
