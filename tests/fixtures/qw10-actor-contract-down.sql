-- DESIGN LAB ONLY. Refuse destructive rollback once automatic evidence exists.
do $$ begin
  if to_regclass('qw10_actor_lab.only_synthetic_data') is null then
    raise exception 'Requires disposable actor-contract fixture';
  end if;
  if exists(select 1 from public.inventory_history where actor_kind <> 'human')
     or exists(select 1 from private.inventory_automation_events) then
    raise exception 'Automatic evidence exists: preserve and reconcile before rollback';
  end if;
end $$;
drop index public.inventory_history_automation_once;
alter table public.inventory_history
  drop constraint inventory_history_automation_binding,
  drop constraint inventory_history_actor_contract,
  alter column changed_by set not null,
  drop column automation_event_id,
  drop column actor_kind;
drop table private.inventory_automation_events;
