-- Expose only the caller's purchased SKU/date pairs, never the orders table.
-- Legacy orders identify customers by email. Read the verified email from
-- auth.users on the server; never accept an email/user ID from the client.
create or replace function private.purchase_history_for_current_user()
returns jsonb
language plpgsql stable security definer
set search_path = ''
as $$
declare
  caller uuid := auth.uid();
  verified_email text;
  result jsonb;
begin
  if caller is null or not private.customer_account_enabled() then
    raise exception 'Authentication required' using errcode = '42501';
  end if;
  if private.current_user_is_admin() and not private.is_admin() then
    raise exception 'Verified admin session required' using errcode = '42501';
  end if;
  select lower(btrim(u.email)) into verified_email
  from auth.users u
  where u.id = caller and u.email_confirmed_at is not null
    and coalesce(u.is_anonymous, false) = false
    and (u.banned_until is null or u.banned_until <= now());
  if verified_email is null or verified_email = '' then
    raise exception 'Verified account required' using errcode = '42501';
  end if;

  with own_orders as materialized (
    select o.id, coalesce(o.paid_at, o.created_at) as bought_at
    from public.orders o
    where lower(btrim(o.customer_email)) = verified_email
      and o.status = 'paid'
      and (o.checkout_session_id is null or o.checkout_session_id not like 'cs_test\_%' escape '\')
      and coalesce(o.paid_at, o.created_at) between now() - interval '365 days' and now()
    order by coalesce(o.paid_at, o.created_at) desc, o.id
    limit 200
  ), purchases as (
    select distinct o.id as event_id, i.product_id,
      -- Exact historical SKU only. Missing variant stays unspecified; the UI
      -- links to options rather than guessing a colour or shoe size.
      nullif(btrim(i.requested_item_id), '') as sku, o.bought_at
    from own_orders o join public.order_items i on i.order_id = o.id
    where i.quantity > 0
  )
  select coalesce(jsonb_agg(to_jsonb(p) order by p.bought_at desc, p.event_id, p.product_id, p.sku), '[]'::jsonb)
    into result from purchases p;
  return result;
end;
$$;
revoke all on function private.purchase_history_for_current_user() from public, anon;
grant execute on function private.purchase_history_for_current_user() to authenticated;

create or replace function public.get_my_purchase_history()
returns jsonb
language sql stable security invoker
set search_path = ''
as $$ select private.purchase_history_for_current_user(); $$;
revoke all on function public.get_my_purchase_history() from public, anon;
grant execute on function public.get_my_purchase_history() to authenticated;
comment on function public.get_my_purchase_history() is
  'Own confirmed non-test purchases only; maximum 200 orders over 365 days. No client-supplied customer identifier.';
