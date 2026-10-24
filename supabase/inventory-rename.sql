-- Correct a display name through the existing administrator, RLS and audit controls.
create function public.inventory_rename(p_sku text,p_name text,p_reason text,p_revision integer)
returns public.inventory_items language plpgsql security invoker set search_path='' as $$
declare item public.inventory_items;
begin
  if auth.uid() is null or private.is_admin() is distinct from true then
    raise exception 'Solo administradores' using errcode='42501';
  end if;
  if p_name is null or length(btrim(p_name)) not between 1 and 250 then
    raise exception 'Escribe un nombre de 1 a 250 caracteres';
  end if;
  if p_reason is null or length(btrim(p_reason)) not between 3 and 500 then
    raise exception 'Escribe un motivo de 3 a 500 caracteres';
  end if;
  select * into item from public.inventory_items where sku=p_sku for update;
  if not found then raise exception 'Artículo no encontrado'; end if;
  if p_revision is distinct from item.revision then
    raise exception 'El inventario cambió. Actualiza la lista e inténtalo nuevamente.' using errcode='40001';
  end if;
  if item.name=btrim(p_name) then return item; end if;
  perform set_config('rho.inventory_reason',btrim(p_reason),true);
  update public.inventory_items set name=btrim(p_name) where sku=p_sku returning * into item;
  return item;
end $$;
revoke all on function public.inventory_rename(text,text,text,integer) from public,anon,authenticated;
grant execute on function public.inventory_rename(text,text,text,integer) to authenticated;
notify pgrst, 'reload schema';
