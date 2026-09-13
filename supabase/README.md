# RHO Loyalty backend

The production Supabase project contains the loyalty module created by these migrations:

- `20260913190819_create_rho_loyalty_module`
- `20260913190926_optimize_rho_loyalty_rls_and_indexes`
- `20260913191349_encrypt_retrievable_loyalty_qr_tokens`

The module uses `loyalty_cards`, `loyalty_tiers`, `loyalty_customer_details`,
`loyalty_transactions`, `loyalty_transaction_items`, `loyalty_points_ledger`,
`loyalty_rewards`, `loyalty_redemptions`, `loyalty_qr_tokens`, and
`loyalty_qr_scans`. Row Level Security is enabled on every table.

Edge Functions:

- `loyalty-admin`: authenticated admin-only issuance, point adjustments, and QR rotation.
- `loyalty-my-card`: returns an authenticated member's card and decrypts only their current QR.
- `loyalty-validate`: public QR validation without returning personal data.

QR bearer tokens have 256 bits of randomness. The database stores a SHA-256 lookup hash and an
AES-GCM encrypted copy; the plaintext token is never stored. The encryption key is derived inside
trusted Edge Functions from the project service-role secret, which is never exposed to browser code.
