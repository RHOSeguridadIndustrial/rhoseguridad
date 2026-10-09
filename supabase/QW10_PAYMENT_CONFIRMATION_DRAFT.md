# Quick Win 10 — payment confirmation preparation

Status: tested policy module, NOT deployed or connected to customer checkout.

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

The authorized test Checkout session is an isolated preview and has no rho_request_id binding; it cannot generate production orders through this module. PayPal is excluded. Never commit Stripe or Supabase secret keys.
