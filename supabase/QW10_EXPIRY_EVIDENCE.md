# QW10 — Pago pendiente, reserva vencida y pago tardío

16 octubre 2026 UTC / 15 octubre CDMX.

Ejecutado tests/payment-expiry-sandbox.sql en el Postgres desplegado, dentro de una transacción revertida completamente. SKU sintético aislado, 1 unidad. Verificado: reserva sin pago -> estado pending y cero órdenes; vencimiento simulado -> otra solicitud reserva la unidad; pago tardío simulado en el límite de persistencia -> reconciliation_required, sin orden ni descuento; reintento tardío -> mismo resultado idempotente. Resultado final: cero filas fixture, 3 órdenes de prueba previas y 50 unidades reales intactas.

También pasaron las 9 pruebas de payment-confirmation.test.mjs, incluyendo avisos de fallo y expiración que nunca confirman el pago.

Límite: el pago tardío fue una simulación controlada de la entrada de persistencia, no una notificación nueva de Stripe. No se ejecutó una tarjeta rechazada ni expiración remota de una sesión Stripe. No acredita cancelación remota, liberación anticipada por rechazo, ni recorrido móvil. Ningún cambio se publicó. Cobros reales deshabilitados.
