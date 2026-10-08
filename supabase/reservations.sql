-- QW9: manual quote holds. No payments or physical stock mutations.
create table private.inventory_reservations (
  reference text primary key check(reference ~ '^RHO-[0-9]{8}$'),
  contents jsonb not null,
  status text not null default 'active' check(status in ('active','cancelled')),
  created_at timestamptz not null default clock_timestamp(),
  expires_at timestamptz not null,
  created_by uuid not null references auth.users(id),
  cancelled_at timestamptz,
  cancelled_by uuid references auth.users(id)
);
create table private.inventory_reservation_lines (
  reference text not null references private.inventory_reservations(reference),
  sku text not null references public.inventory_items(sku),
  quantity integer not null check(quantity between 1 and 1000000),
  primary key(reference,sku)
);
create index inventory_reservation_lines_sku on private.inventory_reservation_lines(sku);
create index inventory_reservations_expiry on private.inventory_reservations(expires_at) where status='active';
alter table private.inventory_reservations enable row level security;
alter table private.inventory_reservation_lines enable row level security;
revoke all on private.inventory_reservations,private.inventory_reservation_lines from public,anon,authenticated;

create function private.inventory_reserved(p_sku text) returns bigint
language sql stable security definer set search_path='' as $$
  select coalesce(sum(l.quantity),0) from private.inventory_reservation_lines l
  join private.inventory_reservations r using(reference)
  where l.sku=p_sku and r.status='active' and r.expires_at>statement_timestamp();
$$;
revoke all on function private.inventory_reserved(text) from public,anon,authenticated;

create function private.reservation_admin(p_action text,p_reference text,p_items jsonb)
returns jsonb language plpgsql security definer set search_path='' as $$
declare canonical jsonb; old private.inventory_reservations; row_item record;
  stock public.inventory_items; held bigint; deadline timestamptz; shortage jsonb='[]'; result jsonb;
begin
  if auth.uid() is null or not private.is_admin() then raise exception 'Solo administradores' using errcode='42501'; end if;
  if p_action='list' then
    select coalesce(jsonb_agg(jsonb_build_object('reference',r.reference,'status',
      case when r.status='cancelled' then 'cancelled' when r.expires_at<=clock_timestamp() then 'expired' else 'active' end,
      'created_at',r.created_at,'expires_at',r.expires_at,'items',r.contents) order by r.created_at desc),'[]')
      into result from (select * from private.inventory_reservations order by created_at desc limit 100) r;
    return jsonb_build_object('reservations',result,'inventory',(select coalesce(jsonb_agg(jsonb_build_object(
      'sku',i.sku,'name',i.name,'quantity',i.quantity,'unit',i.unit,'state',i.state,'is_active',i.is_active,
      'reserved',private.inventory_reserved(i.sku),'available',case when i.is_active and i.state='tracked'
        then greatest(0,i.quantity-private.inventory_reserved(i.sku)) else 0 end) order by i.name),'[]') from public.inventory_items i));
  end if;
  if p_reference is null or p_reference !~ '^RHO-[0-9]{8}$' then raise exception 'Referencia inválida'; end if;
  -- Same-reference retries and cancellation always take this lock first.
  perform pg_advisory_xact_lock(hashtextextended('rho-reservation:'||p_reference,0));
  select * into old from private.inventory_reservations where reference=p_reference;
  if p_action='cancel' then
    if old.reference is null then raise exception 'Reserva no encontrada'; end if;
    perform 1 from public.inventory_items i join private.inventory_reservation_lines l on l.sku=i.sku
      where l.reference=p_reference order by i.sku for update of i;
    if old.status='active' then update private.inventory_reservations set status='cancelled',
      cancelled_at=clock_timestamp(),cancelled_by=auth.uid() where reference=p_reference; end if;
    return jsonb_build_object('action','cancelled','reference',p_reference);
  end if;
  if p_action<>'create' or p_action is null then raise exception 'Acción inválida'; end if;
  if current_setting('transaction_isolation')<>'read committed' then raise exception 'Vuelve a intentar la reserva en una transacción nueva'; end if;
  if jsonb_typeof(p_items) is distinct from 'array' or jsonb_array_length(p_items) not between 1 and 100
    then raise exception 'Artículos inválidos'; end if;
  for row_item in select value from jsonb_array_elements(p_items) loop
    if jsonb_typeof(row_item.value) is distinct from 'object'
      or jsonb_typeof(row_item.value->'sku') is distinct from 'string'
      or (row_item.value->>'sku') !~ '^[a-z0-9][a-z0-9-]{1,119}$'
      or jsonb_typeof(row_item.value->'quantity') is distinct from 'number'
      or (row_item.value->>'quantity') !~ '^[1-9][0-9]{0,6}$'
      or (row_item.value->>'quantity')::numeric>1000000 then raise exception 'Cantidad o variante inválida'; end if;
  end loop;
  select jsonb_agg(jsonb_build_object('sku',sku,'quantity',qty) order by sku) into canonical from
    (select value->>'sku' sku,sum((value->>'quantity')::bigint) qty from jsonb_array_elements(p_items) group by 1) s;
  if exists(select 1 from jsonb_array_elements(canonical) where (value->>'quantity')::bigint>1000000)
    then raise exception 'Cantidad inválida'; end if;
  if old.reference is not null then
    if old.contents<>canonical then raise exception 'La referencia ya tiene otras cantidades'; end if;
    return jsonb_build_object('action',case when old.status='cancelled' then 'cancelled'
      when old.expires_at<=clock_timestamp() then 'expired' else 'reserved' end,'reference',p_reference,'expires_at',old.expires_at);
  end if;
  if not exists(select 1 from private.quote_request_references where serial_number=substring(p_reference from 5)::integer)
    then raise exception 'La referencia de cotización no existe'; end if;
  -- Every path that changes physical inventory takes the same inventory row lock.
  perform 1 from public.inventory_items where sku in(select value->>'sku' from jsonb_array_elements(canonical))
    order by sku for update;
  for row_item in select value->>'sku' sku,(value->>'quantity')::integer quantity from jsonb_array_elements(canonical) loop
    select * into stock from public.inventory_items where sku=row_item.sku;
    held:=private.inventory_reserved(row_item.sku);
    if stock.sku is null or not stock.is_active or stock.state<>'tracked' or stock.quantity-held<row_item.quantity then
      shortage:=shortage||jsonb_build_array(jsonb_build_object('sku',row_item.sku,'requested',row_item.quantity,
        'available',case when stock.is_active and stock.state='tracked' then greatest(0,stock.quantity-held) else 0 end));
    end if;
  end loop;
  if jsonb_array_length(shortage)>0 then return jsonb_build_object('action','quote','shortages',shortage); end if;
  deadline:=clock_timestamp()+interval '30 minutes';
  insert into private.inventory_reservations(reference,contents,expires_at,created_by)
    values(p_reference,canonical,deadline,auth.uid());
  insert into private.inventory_reservation_lines(reference,sku,quantity)
    select p_reference,value->>'sku',(value->>'quantity')::integer from jsonb_array_elements(canonical);
  return jsonb_build_object('action','reserved','reference',p_reference,'expires_at',deadline);
end $$;
revoke all on function private.reservation_admin(text,text,jsonb) from public,anon,authenticated;
grant execute on function private.reservation_admin(text,text,jsonb) to authenticated;
create function public.inventory_reservation(p_action text,p_reference text default null,p_items jsonb default null)
returns jsonb language sql security invoker set search_path='' as $$
  select private.reservation_admin(p_action,p_reference,p_items);
$$;
revoke all on function public.inventory_reservation(text,text,jsonb) from public,anon,authenticated;
grant execute on function public.inventory_reservation(text,text,jsonb) to authenticated;

create function private.inventory_reservation_guard() returns trigger
language plpgsql security definer set search_path='' as $$
declare held bigint;
begin
  if auth.uid() is null or not private.is_admin() then raise exception 'Solo administradores' using errcode='42501'; end if;
  if current_setting('transaction_isolation')<>'read committed' then raise exception 'Vuelve a intentar el movimiento en una transacción nueva'; end if;
  held:=private.inventory_reserved(old.sku);
  if held>0 and (new.quantity<held or not new.is_active or new.state<>'tracked') then
    raise exception 'Hay piezas reservadas. Cancela la reserva antes de registrar la salida o modificar las existencias.';
  end if;
  return new;
end $$;
revoke all on function private.inventory_reservation_guard() from public,anon,authenticated;
create trigger inventory_reservation_guard before update on public.inventory_items
  for each row execute function private.inventory_reservation_guard();
notify pgrst,'reload schema';
