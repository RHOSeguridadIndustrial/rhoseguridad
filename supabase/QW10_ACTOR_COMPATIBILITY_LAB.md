# QW10: actor history compatibility lab

Validated 2026-10-22. Scope: disposable PGlite database with synthetic identities,
products, inventory and events. Nothing in this branch is a production migration.

## Change and rationale

Operational `inventory_history.changed_by` currently requires an auth.users UUID.
An automatic stock writer must not impersonate a human to satisfy that column.
The proposed data contract retains the existing human identity and adds a separate
system-event reference, with mutually exclusive actor forms and an exact SKU binding.

The lab extends the exact committed inventory migration and reservation SQL rather
than replacing their three triggers. It preserves every historical column, human
audit behavior, manual adjustment permissions and reservation guards. The new event
table has RLS enabled and no direct client/backend grants. A fixture owner supplies
synthetic system events only to test constraints; no trusted event ingestion API
or automatic worker has been implemented by this change.

## Reproduce

From `tests`, run `npm ci --ignore-scripts --no-audit --no-fund` using the committed
lockfile (@electric-sql/pglite 0.3.14), then from the repository root:

```sh
node tests/actor-contract-database.mjs
```

No network, production credentials or Supabase connection is used by the test.
Fixtures have an accidental-use guard requiring an isolated lab marker.
That marker is not an authentication or authorization boundary.

## Results: 12 checks passed

1. Refuse unmarked databases.
2. Preserve all legacy history columns; classify old rows as human.
3. Restore original columns/data when reversing before automatic evidence exists.
4. Preserve normal manual adjustment and human audit.
5. Reject low-assurance administrator calls and adjustments invading a reservation.
6. Reject null human identity, mixed identities, unknown kind and missing event.
7. Deny direct event/history inserts to anon, authenticated and service_role fixtures.
8. Caller-supplied system flags do not permit inventory changes.
9. Reject live-mode and live-session fixtures.
10. Require exact event/SKU binding and reject duplicate history for the same event/SKU.
11. Refuse rollback if it would discard automatic evidence.
12. Preserve the definitions of all three operational trigger functions byte for byte.

The initial run stopped at check 8 because its assertion expected a permission
exception. PostgreSQL RLS correctly hid the row and affected zero rows instead.
The assertion was corrected to require zero returned rows AND unchanged inventory;
no permission, policy or product code was weakened. The second complete run passed.

## Limits and next integration gate

- This is a history-schema contract, not full actor authorization.
- `auth.uid()` and administrator/MFA behavior use synthetic fixture functions;
  real JWT/session validation is not certified here.
- No signatures, receipt authenticity, payment amount/currency/owner matching,
  automatic stock consumption or multi-session contention are validated here.
- Existing triggers still require a human administrator. The lab deliberately does
  not enable automated writes. Integrating a narrow trusted writer with verified
  receipts, atomic order/stock/audit and existing manual reservations is pending.
- A production rollback after automated activity must preserve and reconcile its
  evidence; deleting the new evidence to force reversal is not an acceptable path.
- Keep manual SKU locks and guards when adapting the writer. Do not authorize a
  worker merely from a custom setting, caller-provided actor string or fake human UUID.

References reviewed: Supabase database functions and RLS documentation, current
changelog, operational inventory triggers/columns (read-only inspection on Oct 22).
Recent .NET SDK and TLS transport announcements do not change this local SQL lab.

Production, real stock, payments, delivery and WhatsApp were not changed in this work.
QW10 as a whole remains open; this branch closes only this compatibility test gate.
