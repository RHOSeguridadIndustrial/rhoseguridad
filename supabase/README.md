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

## Pausa temporal — 14 de septiembre de 2026

El interruptor común está en `supabase/functions/_shared/loyalty-status.js`.
`LOYALTY_ENABLED = false` pausa las pantallas y las tres Edge Functions.
Se conservan los módulos originales, las tablas, tarjetas, puntos y tokens QR.
No se cambian fechas de vencimiento; el tiempo de pausa no extiende vigencias.

Para reactivar:
1. Cambiar el interruptor a `true`.
2. Publicar las tres funciones (loyalty-admin, loyalty-my-card y loyalty-validate)
   incluyendo el archivo compartido. Mantener verify_jwt: true, true y false respectivamente.
3. Publicar la web y renovar el parámetro de versión del import compartido en los HTML.
4. Verificar el acceso de cliente, los permisos de administrador y la validación QR.

Durante la pausa, el cliente inicia sesión y vuelve al inicio; las cotizaciones
por WhatsApp y el panel administrativo general siguen disponibles.
Las funciones devuelven 503 con reason=program_paused antes de acceder a los datos.
Esta pausa no modifica las políticas RLS ni revoca accesos directos a la base de datos.
