-- Public catalog queries must not depend on access to customer profiles.
alter policy "Public can read active products" on public.products
  to anon, authenticated using (is_active = true);
create policy inventory_admin_catalog_read on public.products
  for select to authenticated using ((select private.is_admin()));
