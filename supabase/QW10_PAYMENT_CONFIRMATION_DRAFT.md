# Quick Win 10 — payment confirmation preparation

Status: tested policy module, NOT deployed or connected to customer checkout.

2026-10-15 preparation: `checkout-quote.js` builds MXN totals from trusted variant prices, aggregates duplicate SKUs, requires explicit server coverage approval, rejects malformed quantities and computes automatic shipping. Browser-supplied names, prices and totals are ignored. Six pricing tests pass. This does not reserve inventory or create a Stripe session. The production catalog/coverage adapters are still required.

Production inventory review: `inventory_before_write`, `inventory_audit`, and `inventory_reservation_guard` require a real authenticated MFA administrator. A webhook service cannot use them unchanged. Do not spoof an administrator JWT or disable these triggers. Before deployment, introduce a narrowly authorized server inventory path with a distinct audit actor/source, and integrate both checkout and quotation reservations into shared stock locks and availability calculations. Existing QW9 reservations are administrator-created quotation holds and must not be repurposed as public checkout holds.

The existing create-card-checkout function is disabled and has no inventory reservation or request idempotency. Existing verify-card-payment writes paid state after a browser call. Do not enable these functions unchanged.

Prepared module checks authoritative Stripe session state, bound server request, MXN amount, payment identity, and sandbox/live isolation. Both completed and asynchronous success events use the same path. Failed/expired events do not confirm purchases. Shipping is automatic: standard 99 MXN below 299, free at 299; express above 1200, free, CDMX only. Coverage still requires server-side address validation.

Required adapter contract before deployment:

1. Verify raw-body Stripe signature with the endpoint signing secret and pinned SDK. Reject invalid signatures before invoking the module. Do not treat CORS as authentication.
2. Create server-priced checkout requests and atomically reserve exact SKU stock using the shared QW9 locks. Existing admin-only reservations are not a public checkout API.
3. Store request/session binding before fulfillment. Never accept totals or SKU prices from the browser. Use Stripe idempotency key tied to immutable request identity.
4. In one PostgreSQL transaction, lock request and inventory, enforce unique session/payment identities, recheck hold, record payment and create one purchase order. Replayed events return the same order without another stock movement.
5. Late payment after hold release becomes reconciliation required; do not fulfill unavailable stock. Record payment even when a hold expired.
6. Transfer confirmation requires RHO verification of actual bank receipt. A submitted receipt or browser redirect is not confirmation.

Local verification: node --test tests/payment-confirmation.test.mjs. These tests validate policy only. They do not prove signature verification, database idempotency/concurrency, webhook delivery, receipt of funds, or inventory fulfillment.

Database prototype: `payment-confirmation-prototype.sql` runs only in isolated PGlite fixtures via `tests/payment-confirmation-database.mjs`. Repeated queued confirmations generate one receipt/order, conflicting payment identities/amount/currency/environment fail, expired/cancelled holds record a reconciliation receipt without an order, and client roles lack access. It is NOT deployed. Its request/hold fixtures must be replaced by shared QW9 inventory locks and real request bindings before use. Single-connection queue tests do not prove independent PostgreSQL contention.

Activation dependencies: securely configured restricted Stripe test key and webhook signing secret in the server environment, registered Stripe test webhook endpoint, an atomic request/reservation/receipt adapter, and end-to-end test payment. The connected Stripe MCP account authorizes API operations but does not itself configure server credentials. Never ask the user to paste keys into chat.

Integrated local verification: `tests/payment-flow-integration.mjs` connects raw-body SDK signature verification, authoritative-session retrieval fixture, request binding and the isolated SQL commit function. A paid completion followed by a repeated completion and asynchronous success yields exactly one receipt, one order, one movement and one stock deduction. A tampered body is rejected before session retrieval. This is a local integration test; it does not exercise a deployed webhook, real Stripe session retrieval, independent PostgreSQL connections or the production inventory adapter.

The authorized test Checkout session is an isolated preview and has no rho_request_id binding; it cannot generate production orders through this module. PayPal is excluded. Never commit Stripe or Supabase secret keys.
