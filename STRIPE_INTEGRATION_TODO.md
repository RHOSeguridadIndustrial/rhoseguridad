# Stripe Checkout — estado y pasos pendientes

## Estado: desplegado en pruebas (versión 9); validación integral pendiente

Aplica el escenario A. Se encontró una única creación de Checkout Session en el código local: [create-test-checkout.js](supabase/functions/_shared/create-test-checkout.js). Su contenido inicial coincide con el archivo consultado en GitHub/main. Solo se modificó su objeto de parámetros; no se cambiaron rutas, validadores, autenticación, inicialización del cliente ni webhooks. Este adaptador es exclusivamente de pruebas.

Se conservan, con autorización expresa del usuario, `client_reference_id`, `metadata`, `expires_at` y `adaptive_pricing` además de los parámetros de Checkout Studio. Los dos primeros vinculan el pago con la reserva; los otros mantienen el vencimiento y el importe en MXN acordados. Los validadores existentes permanecen intactos.

## Validación remota (6 de noviembre de 2026)

- Acceso confirmado tanto a la cuenta activa como a **Entorno de prueba de RHO Seguridad Industrial**. Todas las operaciones de validación se realizaron exclusivamente en este último, con `livemode: false`.
- Se comprobó que no había sesiones de diagnóstico anteriores y se creó correctamente `cs_test_a1N7UtC7L5fjMdsKmjF11DRcqOt8Et9tBGD96PzwTvFv4JsNXSolkVoyBs` con referencia `rho-checkout-studio-validation-20261106`.
- Stripe aceptó los parámetros configurados: página alojada `hosted_page`, contexto `web`, identificador `hosted_web_0001`, importe 16319 centavos MXN, impuestos automáticos desactivados y promociones desactivadas. La respuesta confirmó `payment_status: unpaid`, sin PaymentIntent ni cliente creado.
- La sesión quedó abierta, sin realizar pago. Caducidad configurada: **6 de noviembre de 2026 a las 08:39:47 UTC**. El conector no expone la operación de expiración manual en las búsquedas disponibles; no se afirma haberla cerrado.
- El esquema del conector corresponde a `2026-09-30.preview`; esta prueba no demuestra por sí sola compatibilidad con la versión fijada por el endpoint (`2026-08-26.dahlia`).
- Se desplegó `create-test-checkout`, versión **9**, estado **ACTIVE**. Se recuperaron los nueve archivos desplegados y se verificó coincidencia exacta con el paquete enviado. Solo cambió el objeto de parámetros del helper; autenticación, SDK y versión de API permanecen iguales.
- Comprobación HTTP posterior: `OPTIONS` → 204; `POST` sin sesión → 401 `admin_session_required`; `GET` → 405 `method_not_allowed`. Estas respuestas verifican disponibilidad y barreras de acceso, no un pago completo.
- Pendiente: desde una sesión de administrador existente, completar un pedido de prueba para validar los parámetros con la versión de API fijada por el endpoint, así como el pedido persistido y el webhook. No se dispone de esa sesión en esta ejecución; no se alteró ni eludió la autenticación.

## Values to Replace

No se añadieron placeholders. Se conservaron todos los valores reales de `mode`, `success_url`, `cancel_url` y `line_items` conforme al escenario A. No hay archivos con placeholders nuevos.

| Campo | Valor conservado | Acción pendiente |
|---|---|---|
| mode | `payment` | Cobro único; no cambiar por una suscripción sin adaptar el producto. |
| success_url | `https://rhosegind.com/confirmacion-prueba.html?session_id={CHECKOUT_SESSION_ID}` | Página existente de pruebas; no representa una integración de producción. |
| cancel_url | `https://rhosegind.com` | URL real conservada. |
| line_items | `price_data` en MXN, `unit_amount: quote.totalCents`, cantidad 1 | Cotización real calculada por el servidor; no sustituir por `price_...`. El producto conserva su nombre de prueba. |

## Configured Parameters

Archivo: [create-test-checkout.js](supabase/functions/_shared/create-test-checkout.js).

| Parámetro | Valor preparado |
|---|---|
| ui_mode | `hosted_page` |
| billing_address_collection | `auto` |
| phone_number_collection | `{ enabled: false }` |
| automatic_tax | `{ enabled: false }` |
| allow_promotion_codes | `false` |
| submit_type | `auto` |
| integration_identifier | `hosted_web_0001` |
| origin_context | `web` |

`payment_method_collection` se omite porque `mode` es `payment`, según la regla 8. `hosted_page` sigue la regla de versión indicada por el usuario: el endpoint importa `npm:stripe@22.6.0`. No se cambió la versión de API ya fijada por el proyecto. Los parámetros fueron aceptados por Stripe en sandbox mediante el conector. Falta comprobar la versión de API del endpoint y el flujo completo; las pruebas locales usan un cliente simulado.

Se eliminó `locale`, ausente de Field Intents. Excepciones autorizadas:

| Parámetro conservado | Valor |
|---|---|
| client_reference_id | `request.id` |
| metadata | `{ rho_request_id: request.id, environment: 'test' }` |
| expires_at | `request.expiresAt` |
| adaptive_pricing | `{ enabled: false }` |

## Setup and Next Steps

1. Excepción autorizada y aplicada. Conservar los validadores y la asociación entre sesión y pedido al desplegar.
2. Validación local completada: `node --test tests/checkout-summary.test.mjs tests/checkout-coupon.test.mjs` — **21 pasan, 0 fallan**. `git diff --check` también pasa. Estas pruebas cubren cotizaciones, cupones, reintentos, autenticación y vínculo con el pedido usando Stripe simulado.
3. Mantener Stripe SDK 22.6.0, ya importado por el endpoint. No se añadieron dependencias ni archivos `.env`. Los secretos existentes se leen en el servidor como `STRIPE_TEST_RESTRICTED_KEY` y, para el webhook, `STRIPE_TEST_ORDERS_SIGNING_SECRET`; conservar exactamente esos nombres en la configuración de Supabase. No usar prefijos `VITE_` ni exponerlos en el navegador. Mantener también los secretos Supabase existentes.
4. Tras el despliegue, completar una compra desde el flujo autenticado de pruebas y revisar importe, moneda, redirección, cancelación, reintentos y eventos firmados. Tarjeta de prueba de éxito: `4242 4242 4242 4242`, fecha futura y CVC de tres dígitos, únicamente en modo de prueba. No usar tarjetas reales para esta comprobación.
5. Conservar la secuencia existente: usuario autenticado → cotización del servidor → reserva persistida → creación idempotente de sesión → validación y asociación → página alojada en Stripe → webhook verificado → confirmación del pedido. La página de éxito no prueba por sí sola que el pago se haya completado.
6. La activación de la cuenta Stripe no convierte este endpoint de pruebas en uno de producción. Revisar el adaptador de producción y completar una validación independiente antes de habilitar cobros reales. Este cambio no habilita pagos, no crea pedidos reales ni modifica inventario.
7. Para productos y seguimiento, mantener los precios y gastos de envío calculados por el servidor, la asociación pago/pedido y la confirmación idempotente mediante webhook. Verificar vencimiento de reservas, eventos repetidos y pagos tardíos antes del lanzamiento.

### Estructura del cambio

- Modificado: [supabase/functions/_shared/create-test-checkout.js](supabase/functions/_shared/create-test-checkout.js), únicamente el objeto de parámetros.
- Nuevo: [STRIPE_INTEGRATION_TODO.md](STRIPE_INTEGRATION_TODO.md), este documento.

El cambio se desplegó únicamente en `create-test-checkout` (versión 9). Se conserva en la rama `codex/checkout-studio-20261106` de GitHub para revisión. Los cambios previos ajenos a Stripe en el directorio de trabajo se dejaron intactos. No se habilitaron cobros de producción.

### Recursos

- https://support.stripe.com
- https://docs.stripe.com/mcp
- https://docs.stripe.com/testing
- https://docs.stripe.com/keys-best-practices
