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
- Alcance comprobado: compra exitosa autenticada, importe, moneda, Checkout alojado, webhook y persistencia del pedido, además de cancelación, rechazo y recuperación descritos a continuación. No se realizó ningún cobro real ni se programó una entrega.

### Cancelación, rechazo y reintentos comprobados en sandbox

- Se preparó un carrito de dos unidades: productos **$6.64 MXN**, envío simulado **$99.00 MXN**, total **$105.64 MXN**. Repetir la preparación del mismo carrito devolvió exactamente la misma URL y sesión de Checkout.
- Al salir de Checkout mediante su enlace de regreso, el navegador volvió a `https://rhosegind.com/`. Stripe mantuvo la sesión `open / unpaid`; la base de datos confirmó **cero recibos, cero órdenes y cero movimientos** para esa solicitud. Salir de la página no equivale a expirar la sesión: la reserva permaneció activa dentro de su plazo de vigencia.
- Se reabrió la misma sesión y se usó la tarjeta pública de rechazo `4000 0000 0000 0002`. Checkout mostró el rechazo. Stripe siguió en `open / unpaid`, y la base de datos mantuvo **cero recibos, cero órdenes y cero movimientos**.
- Se corrigió la tarjeta a `4242 4242 4242 4242` dentro de la misma sesión. Stripe confirmó `complete / paid`, **10564 centavos MXN** y `livemode: false`, conservando el mismo PaymentIntent del intento rechazado. Se mantuvo desactivado el guardado de datos en Link.
- El webhook creó automáticamente la **orden de prueba #10**: exactamente **un recibo y una orden**, resultado `paid`, actor `system / stripe-test-orders`, reserva liberada y un único movimiento de dos unidades del SKU `3m-earsoft-yellow-neons-sin-cordon`, todo en `qw10_test`.
- Identificadores: solicitud `b211e4f2-30ef-4913-ba73-2b241bab591b`; sesión `cs_test_a1SqHmkpzF3jZcwqqrOzNgX69l6v62lRHn24xidwEb2UfxOItSZfakNpgj`; PaymentIntent `pi_3UYiBERpe0k2YzxP07j1AhoW`; evento `evt_1UYiCeRpe0k2YzxPqqbZFNdU`. Recibo registrado el **6 de noviembre de 2026, 08:08:54 UTC**.
- Límite de la comprobación visual: después del segundo pago, la página de retorno solicitó verificar nuevamente la sesión de administrador, incluso tras pulsar «Consultar de nuevo». No se eludió esa barrera. El éxito de la orden #10 se confirmó mediante Stripe y una consulta de solo lectura a la base de datos; no se afirma haber visto su confirmación autenticada en pantalla. La orden #9 sí tuvo confirmación visual completa.

### Reenvío remoto preparado y evidencia adicional

- Consulta de solo lectura del 6 de noviembre de 2026: la solicitud de la orden #10 conserva **un recibo, una orden y un movimiento de dos unidades**. Es la línea base para comparar después del reenvío; por sí sola no acredita una entrega duplicada.
- Destino confirmado en el sandbox `acct_1UGwvSRpe0k2YzxP`: `we_1UR03RRpe0k2YzxPZ07v9GNV`, habilitado, `livemode: false`, URL `https://mtpqpxcmngrsivntbgcc.supabase.co/functions/v1/stripe-test-orders`.
- Evento pendiente de reenviar: `evt_1UYiCeRpe0k2YzxPqqbZFNdU`, asociado a la orden #10. El conector disponible no expone el reenvío. Se abrió el Dashboard; el primer paso de inicio de sesión fue aceptado y quedó pendiente la autenticación con la clave de acceso. No se ha reenviado el evento ni se ha cambiado la configuración del webhook.
- Al completar el acceso: seleccionar el sandbox indicado, abrir ese evento y reenviarlo únicamente al destino de órdenes anterior. Verificar una respuesta HTTP satisfactoria y repetir la consulta de recibos, órdenes y movimientos: deben seguir en **1 / 1 / 1**, con **2 unidades** en total. Registrar la entrega antes de marcar esta prueba como aprobada.
- Se contrastó un caso histórico de reserva inactiva: solicitud `3ab60af6-ef86-40b7-a4c0-c11690761bfd`, sesión `cs_test_a1Amj3o65G4AG8f4dLa6ZA2cb1vy7fxSpD5T1A5zHdnorVTO0vdqTJmLsX`, evento `evt_1UUBmdRpe0k2YzxPzzPiTKfF`. Stripe confirma `complete / paid`, **12370 centavos MXN**, `livemode: false`, y la base de datos conserva `reconciliation_required / reservation_inactive`, **cero órdenes y cero movimientos**. El registro es del **24 de octubre de 2026, 20:43:21 UTC**.
- Este caso histórico acredita el tratamiento de una reserva inactiva. **No acredita vencimiento por tiempo** (`reservation_expired`), ni sustituye una prueba del Checkout versión 9. El caso remoto de pago tardío por vencimiento sigue pendiente. No se alteraron fechas, recibos ni estados de pago en la base de datos para simularlo.

### Validación local adicional

- `node tests/deployed-fulfillment-database.mjs --export-fixture`: **14 comprobaciones aprobadas**, en PGlite aislado con datos sintéticos. Cubren atomicidad, permisos, importes e identidades, idempotencia, reservas vencidas, inventario insuficiente, auditoría y conservación de evidencia.
- `node tests/deployed-signed-receipt.mjs`: **6 grupos aprobados**, con firma verificada por el SDK de Stripe, consulta a Stripe simulada y base de datos local. Cubren firma inválida, cuerpo alterado, discrepancias del pago, pago pendiente, éxito, segundo evento exitoso sin duplicados y pago tardío enviado a revisión sin orden ni descuento de inventario.
- Estas comprobaciones se suman a las **21 pruebas locales aprobadas** de cotización y Checkout. Los nombres de los scripts no implican que se hayan reenviado eventos al endpoint remoto: los casos repetidos y tardíos de esta sección se ejecutaron localmente.
- Pendiente antes de producción: comprobar redelivery de un evento real de sandbox y un pago tardío contra el webhook desplegado. La búsqueda de operaciones del conector no expuso reenvío de eventos y no había Stripe CLI instalada; no se simularon pagos escribiendo directamente en la base de datos remota.

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
2. Validación local completada: `node --test tests/checkout-summary.test.mjs tests/checkout-coupon.test.mjs` — **21 pasan, 0 fallan**, más las **14 comprobaciones de base de datos y 6 grupos de recibos firmados** detallados arriba. `git diff --check` también pasa. Estas pruebas usan datos sintéticos, Stripe simulado cuando corresponde y una base de datos aislada.
3. Mantener Stripe SDK 22.6.0, ya importado por el endpoint. No se añadieron dependencias ni archivos `.env`. Los secretos existentes se leen en el servidor como `STRIPE_TEST_RESTRICTED_KEY` y, para el webhook, `STRIPE_TEST_ORDERS_SIGNING_SECRET`; conservar exactamente esos nombres en la configuración de Supabase. No usar prefijos `VITE_` ni exponerlos en el navegador. Mantener también los secretos Supabase existentes.
4. Compra autenticada de prueba completada en la orden #9; cancelación, rechazo y recuperación en la misma sesión comprobados en la orden #10. Para volver a consultar la confirmación visual de la orden #10, completar la verificación de administrador solicitada por la página de retorno. Antes de producción, completar el reenvío remoto de eventos y el caso remoto de pago tardío; ya están cubiertos localmente. Tarjetas de prueba: éxito `4242 4242 4242 4242`; rechazo `4000 0000 0000 0002`, con fecha futura y CVC de tres dígitos, únicamente en modo de prueba. No usar tarjetas reales para esta comprobación.
5. Conservar la secuencia existente: usuario autenticado → cotización del servidor → reserva persistida → creación idempotente de sesión → validación y asociación → página alojada en Stripe → webhook verificado → confirmación del pedido. La página de éxito no prueba por sí sola que el pago se haya completado.
6. La activación de la cuenta Stripe no convierte este endpoint de pruebas en uno de producción. Revisar el adaptador de producción y completar una validación independiente antes de habilitar cobros reales. `create-card-checkout` permanece deshabilitado (`CARD_PAYMENTS_ENABLED=false`). Esta integración no habilita cobros reales, no crea pedidos reales ni modifica el inventario real; las órdenes y movimientos de estas validaciones pertenecen exclusivamente a `qw10_test`.
7. Para productos y seguimiento, mantener los precios y gastos de envío calculados por el servidor, la asociación pago/pedido y la confirmación idempotente mediante webhook. Verificar vencimiento de reservas, eventos repetidos y pagos tardíos antes del lanzamiento.

### Estructura del cambio

- Modificado: [supabase/functions/_shared/create-test-checkout.js](supabase/functions/_shared/create-test-checkout.js), únicamente el objeto de parámetros.
- Nuevo: [STRIPE_INTEGRATION_TODO.md](STRIPE_INTEGRATION_TODO.md), este documento.

El cambio se desplegó únicamente en `create-test-checkout` (versión 9). La [PR #52](https://github.com/RHOSeguridadIndustrial/rhoseguridad/pull/52) se integró en `main` el 6 de noviembre de 2026 mediante el commit `4c8824e2ac1d37ec25da19779477081581bf2a94`. GitHub no devolvió ejecuciones de workflows de PR ni estados para su commit de cabecera; la validación automatizada disponible es la local descrita en este documento. Las comprobaciones adicionales no requirieron cambios de código ni un nuevo despliegue. Los cambios previos ajenos a Stripe en el directorio de trabajo se dejaron intactos. No se habilitaron cobros de producción.

### Recursos

- https://support.stripe.com
- https://docs.stripe.com/mcp
- https://docs.stripe.com/testing
- https://docs.stripe.com/keys-best-practices
