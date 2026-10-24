# Prueba remota de excepción QW10

Objetivo: un pago de Stripe en sandbox cuya reserva de prueba fue desactivada debe quedar en revisión, sin orden ni descuento de existencias.

1. Abrir el checkout de prueba desde una sesión administrativa con MFA. Crear una sesión nueva con datos sintéticos y anotar la solicitud vinculada y el control de stock.
2. Antes de pagar, desactivar únicamente `hold_active` de esa solicitud en `qw10_test.requests`, con condiciones: ID exacto, sesión `cs_test_`, `livemode=false`, sin recibo y sin orden. Es una inyección de fallo de prueba; no modifica inventario real ni evidencia de pago.
3. El usuario completa el pago simulado en Stripe. No fabricar eventos, firmas, recibos ni identidades de pago.
4. Comprobar el evento Stripe y el webhook, recibo `reconciliation_required`, motivo `reservation_inactive`, cero órdenes y movimientos para esa solicitud, y stock sin cambios.
5. Abrir el panel de revisión con el propietario autenticado. Revisar la evidencia y registrar una nota que identifique la prueba controlada y la ausencia de surtido real.
6. Volver a consultar y comprobar una sola revisión persistida, con autor y fecha; el registro de revisión no debe convertir el pago en una orden.

Esta prueba no certifica cobros reales ni Safari nativo. El reenvío del evento de la orden #6 ya fue validado por separado el 24 de octubre de 2026.
