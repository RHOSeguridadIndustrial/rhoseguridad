# Stripe Checkout — estado y pasos pendientes

## Estado: integrado en main, desplegado y validado de extremo a extremo en pruebas (versión 9)

Aplica el escenario A. Se encontró una única creación de Checkout Session en el código local: [create-test-checkout.js](supabase/functions/_shared/create-test-checkout.js). Su contenido inicial coincide con el archivo consultado en GitHub/main. Solo se modificó su objeto de parámetros; no se cambiaron rutas, validadores, autenticación, inicialización del cliente ni webhooks. Este adaptador es exclusivamente de pruebas.

Se conservan, con autorización expresa del usuario, `client_reference_id`, `metadata`, `expires_at` y `adaptive_pricing` además de los parámetros de Checkout Studio. Los dos primeros vinculan el pago con la reserva; los otros mantienen el vencimiento y el importe en MXN acordados. Los validadores existentes permanecen intactos.

## Validación remota (6 de noviembre de 2026)

- Acceso confirmado tanto a la cuenta activa como a **Entorno de prueba de RHO Seguridad Industrial**. Todas las operaciones de validación se realizaron exclusivamente en este último, con `livemode: false`.
- Se comprobó que no había sesiones de diagnóstico anteriores y se creó correctamente `cs_test_a1N7UtC7L5fjMdsKmjF11DRcqOt8Et9tBGD96PzwTvFv4JsNXSolkVoyBs` con referencia `rho-checkout-studio-validation-20261106`.
- Stripe aceptó los parámetros configurados: página alojada `hosted_page`, contexto `web`, identificador `hosted_web_0001`, importe 16319 centavos MXN, impuestos automáticos desactivados y promociones desactivadas. La respuesta confirmó `payment_status: unpaid`, sin PaymentIntent ni cliente creado.
- La sesión quedó abierta, sin realizar pago. Caducidad configurada: **6 de noviembre de 2026 a las 08:39:47 UTC**. El conector no expone la operación de expiración manual en las búsquedas disponibles; no se afirma haberla cerrado.
- El esquema del conector corresponde a `2026-09-30.preview`; la sesión de diagnóstico anterior no demostró por sí sola compatibilidad con la versión fijada por el endpoint. Esa compatibilidad se comprobó después mediante la compra autenticada descrita abajo.
- Se desplegó `create-test-checkout`, versión **9**, estado **ACTIVE**. Se recuperaron los nueve archivos desplegados y se verificó coincidencia exacta con el paquete enviado. Solo cambió el objeto de parámetros del helper; autenticación, SDK y versión de API permanecen iguales.
- Comprobación HTTP posterior: `OPTIONS` → 204; `POST` sin sesión → 401 `admin_session_required`; `GET` → 405 `method_not_allowed`. Estas respuestas verifican disponibilidad y barreras de acceso, no un pago completo.
- Se completaron el inicio de sesión de administrador y la verificación MFA mediante entrada segura del usuario. No se alteró ni eludió la autenticación.
- Desde `checkout-prueba.html`, el endpoint desplegado creó una sesión para un par de tapones 3M E-A-Rsoft sin cordón: productos **$3.32 MXN**, envío simulado **$99.00 MXN**, total **$102.32 MXN**. Esto verificó los parámetros con el SDK y la versión de API existentes (`22.6.0` / `2026-08-26.dahlia`).
- Se completó Checkout con la tarjeta pública de prueba `4242`, datos ficticios y guardado de datos en Link desactivado. Stripe confirmó `status: complete`, `payment_status: paid`, `amount_total: 10232`, `currency: mxn` y `livemode: false`.
- El webhook existente registró automáticamente el pago y creó la **orden de prueba #9**. La consulta de la base de datos confirmó exactamente **un recibo y una orden**, resultado `paid`, actor `system / stripe-test-orders`, reserva liberada (`hold_active: false`) y un movimiento de una unidad en el esquema de pruebas `qw10_test`, coincidente con el artículo solicitado.
- El navegador regresó a `confirmacion-prueba.html` y mostró **Pago de prueba aprobado**, orden #9 y total $102.32. La confirmación se contrastó con Stripe y la base de datos; no se usó la redirección como única prueba.
- Identificadores de esta validación: solicitud `dd403d9b-18e0-4f7d-a169-b8e7bd7e79eb`; sesión `cs_test_a1HKZTFTgRkqbqOR8GRnVoIVNE9Zy647AKsGfWxuos8HXgdxfYd8VDgWjr`; PaymentIntent `pi_3UYi1NRpe0k2YzxP0b3Pfwe6`; evento `evt_1UYi1ORpe0k2YzxPhcm9cCV3`. Recibo registrado el **6 de noviembre de 2026, 07:57:15 UTC**.
- Alcance comprobado: compra exitosa autenticada, importe, moneda, Checkout alojado, webhook y persistencia del pedido. No se ejecutaron en esta sesión pruebas remotas de cancelación, rechazo, reenvío de eventos o pago tardío. No se realizó ningún cobro real ni se programó una entrega.

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

`payment_method_collection` se omite porque `mode` es `payment`, según la regla 8. `hosted_page` sigue la regla de versión indicada por el usuario: el endpoint importa `npm:stripe@22.6.0`. No se cambió la versión de API ya fijada por el proyecto. Los parámetros fueron aceptados tanto en la comprobación del conector como en la compra completa a través del endpoint desplegado. Las pruebas locales usan un cliente simulado; la validación remota de la orden #9 cubre el recorrido exitoso real en sandbox.

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
4. Compra autenticada de prueba completada: importe, moneda, redirección y registro automático por webhook verificados en la orden #9. Antes de producción, completar los casos remotos de cancelación, rechazo, reintentos y eventos repetidos o tardíos. Tarjeta de prueba de éxito: `4242 4242 4242 4242`, fecha futura y CVC de tres dígitos, únicamente en modo de prueba. No usar tarjetas reales para esta comprobación.
5. Conservar la secuencia existente: usuario autenticado → cotización del servidor → reserva persistida → creación idempotente de sesión → validación y asociación → página alojada en Stripe → webhook verificado → confirmación del pedido. La página de éxito no prueba por sí sola que el pago se haya completado.
6. La activación de la cuenta Stripe no convierte este endpoint de pruebas en uno de producción. Revisar el adaptador de producción y completar una validación independiente antes de habilitar cobros reales. `create-card-checkout` permanece deshabilitado (`CARD_PAYMENTS_ENABLED=false`). Esta integración no habilita cobros reales, no crea pedidos reales ni modifica el inventario real; la orden y el movimiento de esta validación pertenecen exclusivamente a `qw10_test`.
7. Para productos y seguimiento, mantener los precios y gastos de envío calculados por el servidor, la asociación pago/pedido y la confirmación idempotente mediante webhook. Verificar vencimiento de reservas, eventos repetidos y pagos tardíos antes del lanzamiento.

### Estructura del cambio

- Modificado: [supabase/functions/_shared/create-test-checkout.js](supabase/functions/_shared/create-test-checkout.js), únicamente el objeto de parámetros.
- Nuevo: [STRIPE_INTEGRATION_TODO.md](STRIPE_INTEGRATION_TODO.md), este documento.

El cambio se desplegó únicamente en `create-test-checkout` (versión 9). La [PR #52](https://github.com/RHOSeguridadIndustrial/rhoseguridad/pull/52) se integró en `main` el 6 de noviembre de 2026 mediante el commit `4c8824e2ac1d37ec25da19779477081581bf2a94`. GitHub no devolvió ejecuciones de workflows de PR ni estados para su commit de cabecera; la validación automatizada disponible es la local de 21 pruebas. Los cambios previos ajenos a Stripe en el directorio de trabajo se dejaron intactos. No se habilitaron cobros de producción.

### Recursos

- https://support.stripe.com
- https://docs.stripe.com/mcp
- https://docs.stripe.com/testing
- https://docs.stripe.com/keys-best-practices
