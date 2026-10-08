# Sequential WhatsApp request references

Format and shared counter approved by Rafael on 2026-10-07 (Mexico City).

Format: `RHO-00000001`, `RHO-00000002`, etc. One global counter, up to
`RHO-99999999`, shared by all cart products. It never resets by day or browser.
Allocation happens when preparing the WhatsApp request, not when the customer
sends the message. An assigned reference remains consumed if the customer
abandons WhatsApp. A retry token recovers the same reference after a lost response.
This is not a paid-order number, inventory reservation, or proof of delivery.

## Approved deployment order

1. Review current main and preserve the existing counter on future changes.
2. Apply `20261008002041_add_sequential_quote_references.sql` once. Inspect counter
   value 0, permissions, RLS and advisors. Never reset an existing counter.
3. Deploy `index.ts` and `handler.js` as `quote-reference`, `verify_jwt: false`.
   The handler validates the `apikey` against `SUPABASE_PUBLISHABLE_KEYS` and
   permits only request-reference allocation. The publishable key is a public
   application credential, not customer authentication. No customer data is returned.
4. Publish `quote-reference.js` and `carrito.html` after the backend is ready.
5. Check live module loading and private grants. Do not consume the first live
   folio with an automated smoke request; real requests start at 00000001.

Local verification: `node --test tests/quote-reference.test.mjs` from the repo
root, after `npm ci --prefix tests`. This uses an isolated PGlite database and
checks allocation, retries, response loss, conflicts, access restrictions, upper
limit, cart units/totals and failure feedback. PGlite serializes connections;
the deployed allocator also passes first-number, retry and increment assertions
inside a rolled-back transaction. Duplicate prevention uses a database row lock
and a unique serial constraint; no load-test claims are made.

The private record stores only retry token, request fingerprint, number and time.
The public endpoint has shared limits of 60 new references per minute and 1000
per rolling 24 hours. Existing-reference retries do not consume this allowance.
No rate limit relies on browser-local state, IP headers, or hidden API keys.
