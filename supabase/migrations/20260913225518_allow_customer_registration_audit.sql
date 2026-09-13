alter table public.loyalty_admin_audit
  drop constraint if exists loyalty_admin_audit_action_check;

alter table public.loyalty_admin_audit
  add constraint loyalty_admin_audit_action_check
  check (action in ('create_customer','issue_card','rotate_qr','add_points'));
