-- RHO inventory. Existing products and administrator roles are preserved.
create table public.inventory_items (
  sku text primary key check (sku ~ '^[a-z0-9][a-z0-9-]{1,119}$'),
  product_id text not null references public.products(id),
  name text not null check (length(btrim(name)) between 1 and 250),
  quantity integer not null default 0 check (quantity between 0 and 1000000),
  minimum_stock integer not null default 1 check (minimum_stock between 0 and 1000000),
  unit text not null default 'unidad' check (unit in ('unidad','pieza','par','caja','rollo')),
  state text not null default 'pending' check (state in ('pending','tracked')),
  is_active boolean not null default true,
  revision integer not null default 0,
  updated_at timestamptz not null default now(),
  check (state = 'tracked' or quantity = 0)
);
create index inventory_items_product_idx on public.inventory_items(product_id);
create table public.inventory_import (
  sku text primary key references public.inventory_items(sku),
  proposed_quantity integer not null check (proposed_quantity >= 0),
  source_date date not null,
  source_name text not null
);
create table public.inventory_history (
  id bigint generated always as identity primary key,
  sku text not null references public.inventory_items(sku),
  old_quantity integer,
  new_quantity integer not null,
  old_state text,
  new_state text not null,
  old_details jsonb,
  new_details jsonb not null,
  reason text not null,
  changed_by uuid not null references auth.users(id),
  changed_at timestamptz not null default now()
);
create index inventory_history_sku_time_idx on public.inventory_history(sku, changed_at desc);
create index inventory_history_actor_idx on public.inventory_history(changed_by);
alter table public.inventory_items enable row level security;
alter table public.inventory_import enable row level security;
alter table public.inventory_history enable row level security;
revoke all on public.inventory_items, public.inventory_import, public.inventory_history from public, anon, authenticated;
grant select on public.inventory_items to anon, authenticated;
grant insert, update on public.inventory_items to authenticated;
grant select on public.inventory_import, public.inventory_history to authenticated;
create policy inventory_public_read on public.inventory_items for select to anon, authenticated
  using (exists (select 1 from public.products p where p.id=product_id and p.is_active));
create policy inventory_admin_read on public.inventory_items for select to authenticated using ((select private.is_admin()));
create policy inventory_admin_insert on public.inventory_items for insert to authenticated with check ((select private.is_admin()));
create policy inventory_admin_update on public.inventory_items for update to authenticated using ((select private.is_admin())) with check ((select private.is_admin()));
create policy inventory_import_admin_read on public.inventory_import for select to authenticated using ((select private.is_admin()));
create policy inventory_history_admin_read on public.inventory_history for select to authenticated using ((select private.is_admin()));

-- Initial pending purchase records were imported from the user workbook through the administrative connection.
-- Source purchase quantities are intentionally excluded from this public repository.

create function private.inventory_before_write() returns trigger language plpgsql security invoker set search_path='' as $$
begin
  if auth.uid() is null or not private.is_admin() then raise exception 'Solo administradores' using errcode='42501'; end if;
  if length(btrim(coalesce(current_setting('rho.inventory_reason',true),''))) < 3 then raise exception 'Indica el motivo del movimiento'; end if;
  if tg_op='UPDATE' then
    if new.sku<>old.sku or new.product_id<>old.product_id then raise exception 'No se puede cambiar la identidad del artículo'; end if;
    new.revision := old.revision + 1;
  else new.revision := 1; end if;
  new.updated_at := clock_timestamp();
  return new;
end $$;
revoke all on function private.inventory_before_write() from public, anon, authenticated;
create function private.inventory_audit() returns trigger language plpgsql security definer set search_path='' as $$
begin
  if auth.uid() is null or not private.is_admin() then raise exception 'Solo administradores' using errcode='42501'; end if;
  insert into public.inventory_history(sku,old_quantity,new_quantity,old_state,new_state,old_details,new_details,reason,changed_by)
  values(new.sku,case when tg_op='UPDATE' then old.quantity end,new.quantity,case when tg_op='UPDATE' then old.state end,new.state,
    case when tg_op='UPDATE' then jsonb_build_object('minimum_stock',old.minimum_stock,'unit',old.unit,'is_active',old.is_active,'name',old.name) end,
    jsonb_build_object('minimum_stock',new.minimum_stock,'unit',new.unit,'is_active',new.is_active,'name',new.name),
    btrim(current_setting('rho.inventory_reason',true)),auth.uid());
  return new;
end $$;
revoke all on function private.inventory_audit() from public, anon, authenticated;
create trigger inventory_before_write before insert or update on public.inventory_items for each row execute function private.inventory_before_write();
create trigger inventory_audit after insert or update on public.inventory_items for each row execute function private.inventory_audit();

create function public.inventory_adjust(p_sku text,p_action text,p_quantity integer,p_minimum integer,p_unit text,p_active boolean,p_reason text,p_revision integer)
returns public.inventory_items language plpgsql security invoker set search_path='' as $$
declare item public.inventory_items; next_quantity integer; next_state text;
begin
  if auth.uid() is null or not private.is_admin() then raise exception 'Solo administradores' using errcode='42501'; end if;
  if p_reason is null or length(btrim(p_reason)) not between 3 and 500 then raise exception 'Escribe un motivo de 3 a 500 caracteres'; end if;
  if p_quantity is null or p_quantity < 0 or p_quantity > 1000000 then raise exception 'Cantidad inválida'; end if;
  select * into item from public.inventory_items where sku=p_sku for update;
  if not found then raise exception 'Artículo no encontrado'; end if;
  if p_revision is distinct from item.revision then raise exception 'El inventario cambió. Actualiza la lista e inténtalo nuevamente.' using errcode='40001'; end if;
  next_state := 'tracked';
  case p_action
    when 'receive' then
      if p_quantity=0 then raise exception 'La entrada debe ser mayor que cero'; end if;
      next_quantity := item.quantity+p_quantity;
    when 'issue' then
      if item.state<>'tracked' or p_quantity=0 or p_quantity>item.quantity then raise exception 'Salida mayor que las existencias o inválida'; end if;
      next_quantity := item.quantity-p_quantity;
    when 'count' then next_quantity := p_quantity;
    when 'details' then next_quantity := item.quantity; next_state := item.state;
    when 'pending' then
      if item.quantity<>0 then raise exception 'Registra primero la salida de las existencias'; end if;
      next_quantity := 0; next_state := 'pending';
    else raise exception 'Movimiento inválido';
  end case;
  perform set_config('rho.inventory_reason',btrim(p_reason),true);
  update public.inventory_items set quantity=next_quantity,state=next_state,minimum_stock=p_minimum,unit=p_unit,is_active=p_active where sku=p_sku returning * into item;
  return item;
end $$;
revoke all on function public.inventory_adjust(text,text,integer,integer,text,boolean,text,integer) from public,anon,authenticated;
grant execute on function public.inventory_adjust(text,text,integer,integer,text,boolean,text,integer) to authenticated;
create function public.inventory_create(p_sku text,p_product_id text,p_name text,p_unit text)
returns public.inventory_items language plpgsql security invoker set search_path='' as $$
declare item public.inventory_items;
begin
  if auth.uid() is null or not private.is_admin() then raise exception 'Solo administradores' using errcode='42501'; end if;
  perform set_config('rho.inventory_reason','Alta de artículo pendiente de recepción',true);
  insert into public.inventory_items(sku,product_id,name,unit) values(p_sku,p_product_id,p_name,p_unit) returning * into item;
  return item;
end $$;
revoke all on function public.inventory_create(text,text,text,text) from public,anon,authenticated;
grant execute on function public.inventory_create(text,text,text,text) to authenticated;
comment on table public.inventory_items is 'Physical stock by exact storefront SKU. Pending purchases are not sellable stock. Quantities are maintained by administrators.';
notify pgrst, 'reload schema';
