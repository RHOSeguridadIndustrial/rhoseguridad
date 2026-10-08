# QW9 — Proposed reservation behavior

Status: server reservation RPC deployed. Administration UI publication and live verification pending.

## Reviewable behavior

- Adding items to a cart creates no hold.
- A RHO administrator confirms the quote and initiates a 30-minute hold using its existing RHO reference.
- Exact variant SKU and quantity are mandatory. Never substitute stock from another color or size.
- Reserve only active, physically tracked inventory. Pending receipt, missing records, zero or insufficient stock keep the request in the WhatsApp quote flow.
- Free stock is physical stock minus active, unexpired holds. Physical counts remain unchanged until fulfillment.
- Multi-item reservations are all-or-nothing. Cancelled and expired reservations release capacity.
- Repeating the same request returns the existing reservation. Changing quantities requires releasing and reconfirming it.
- A hold is not payment confirmation. Payment verification and fulfillment belong to QW10.

## Implemented server behavior and remaining validation

1. Add private reservation header, exact-SKU lines and audit tables; clients cannot create or modify holds directly.
2. Authenticated administrator RPC must check the existing administrator/MFA/session gate.
3. Serialize by request key and lock inventory rows in sorted SKU order. Recompute live holds under the locks, then insert every line in one transaction. A client-side policy check is insufficient.
4. Persist request identity and canonical contents to make retries idempotent; reject conflicting reuse.
5. Enforce the same SKU locks and reserved-floor check on manual stock issues/counts, so administrative adjustments cannot invalidate live holds.
6. Expose only aggregate quantities to the public catalog/cart; reservation contact data and audit entries remain private.
7. Include WhatsApp orders through the same administrator hold operation, rather than a separate inventory counter.
8. Determine expiration using server time; expired holds stop consuming capacity even if scheduled cleanup is delayed.
9. Local PGlite verifies queued last-unit requests, cancellation, expiration, retries, unauthorized calls and manual adjustments. Independent PostgreSQL sessions and real-stock end-to-end fulfillment remain unverified.

## Current verification

`node --test tests/reservation-policy.test.mjs` verifies the planning policy. `node tests/reservations-database.mjs` executes the SQL with local fixtures and checks atomic multi-item requests, cancellation, expiry, retry conflicts, authorization and adjustment guards. PGlite queues a single connection, so these tests do not prove independent-session PostgreSQL contention.

All current inventory quantities are zero and pending receipt. No real merchandise can be reserved until a confirmed physical receipt/count exists.
