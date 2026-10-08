# Procurement campaign control

`admin-compras.html` is a private admin surface using the existing AAL2/session guard.
The public RPCs are invoker wrappers around private, checked functions. Neither the
tables nor worker functions are granted to browser roles. Admin changes use a
revision precondition and retain an audit log. No email credentials or automation
tokens are stored in frontend code.

## Worker contract

The existing hourly ChatGPT task is a controller, not a browser-triggered run.
Its authorized Supabase SQL connector calls:

1. `select private.procurement_runner_check(gen_random_uuid(), null);`
2. Keep that `run_id` and `revision` for this run. If `allow_work` is false, stop
   without researching, checking mail, contacting suppliers or notifying the user.
3. Before each work phase, and immediately before EACH supplier send, call
   `select private.procurement_runner_check('<run_id>', <revision>);` again.
   Stop on denied work, changed revision, errors or missing connector. A failed
   check cannot be replaced by a new run ID/revision in the same execution.
4. Sending additionally requires `allow_contact=true`, which is determined by
   the server clock, Monday–Friday 09:00 (inclusive) to 18:00 (exclusive) in
   America/Mexico_City. Respect provider opening hours and all sourcing rules.
   This gate grants no authority to purchase, reserve or accept offers.
5. On completion, call
   `select private.procurement_runner_finish('<run_id>', <revision>, 'completed');`
   Other outcomes: `blocked`, `error`, `stopped`. Record only verified outcomes.

Control checks continue while the campaign is paused/off so the website can resume
it. They perform no sourcing or mail activity in those states. Do not disable the
hosted controller just because the campaign is paused/off. If the task itself is
disabled elsewhere, the website cannot restart it; the heartbeat becomes stale.

Work leases last 20 minutes and refresh at each successful gate. Only one run may
work at a time. A mode change cancels the lease and increments the revision, so an
old run cannot resume after a pause/resume sequence. `off` and `paused` both block
all work until an administrator explicitly activates the campaign; neither erases
history, config or prior supplier requests.

This is a cooperative check before dispatch, not a cancellation API for mail
already in flight. The UI makes this limitation explicit. The browser's successful
save is distinct from the worker's last observed revision/heartbeat. Initial state
is **paused**, and publishing must not send a test email or contact suppliers.

## Verification

Run `npm run test:procurement --prefix tests` with the test dependencies installed.
Set `RHO_CHROMIUM_EXECUTABLE_PATH` if Chromium is not installed by Playwright.
Optional `RHO_PREVIEW_DIR` saves desktop/mobile screenshots from the isolated mock
browser fixture. Database tests execute the actual migration and existing security
migration in PGlite, including role, session, revision, lease and time boundaries.
