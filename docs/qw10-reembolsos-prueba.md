# QW10 — resolución de pagos de prueba por reembolso

Implementación validada en laboratorio y desplegada en el servidor de pruebas el 25 de octubre de 2026 (CDMX). No habilita ventas reales, no inicia reembolsos desde la página y no acredita movimientos bancarios de Inbursa.

El webhook existente verifica la firma de Stripe sobre el cuerpo original y conserva los avisos `refund.created`, `refund.updated` y `refund.failed` con `livemode=false` en un registro de solo inserción. Se conservan el pago, importe, moneda, estado, identificador del aviso y fecha del proveedor. No se guardan datos de tarjeta, cliente ni cuerpos completos. El rol ejecutor únicamente lee e inserta esos avisos; no puede escribir órdenes, recibos ni inventario.

El panel de revisión mantiene la nota administrativa separada de la resolución. Solo muestra «Reembolso de prueba confirmado» cuando existe exactamente un reembolso exitoso por el importe completo en MXN, vinculado al mismo PaymentIntent, sin orden ni movimientos. Los reembolsos parciales, múltiples, pendientes, cancelados, fallidos y casos ambiguos permanecen abiertos. El recibo de pago y la revisión original nunca se reescriben.

Se conserva evidencia aunque el aviso de reembolso llegue antes del recibo de compra. La fecha del evento determina el estado, no su orden de llegada; ante dos estados del mismo segundo prevalece el no exitoso. Un fallo posterior vuelve a mostrar resolución pendiente. El panel depende de la recepción de avisos; no certifica una consulta bancaria ni llegada de fondos reales.

Fuentes de contrato: https://docs.stripe.com/api/refunds/object y https://docs.stripe.com/api/events/types. No se cambiaron la API 2026-08-26.dahlia, el SDK Stripe 22.6.0 ni los secretos existentes.

## Validación

CI aprobado en https://github.com/RHOSeguridadIndustrial/rhoseguridad/actions/runs/40265783682, commit `fe2e5f6b5e7f92db01c78bb0d658373334268b87`: 5 pruebas de validación, 14 grupos de regresión de base de datos, 6 de recibos firmados, 7 de reembolsos/permisos, 3 carreras PostgreSQL con espera real por bloqueo y 8 grupos de UI en Chromium/WebKit. El laboratorio usa datos sintéticos y firmas generadas con una clave ficticia; no certifica el proveedor remoto ni Safari nativo en iPhone.

Migración aplicada: `20261026034836_qw10_test_refunds.sql`. Función `stripe-test-orders` versión 3 activa, SHA256 de paquete `3fd761f2bec5e626b3fa1a5398e0af7601b2ecbcb30deb983de2788d655a2655`; cinco archivos de despliegue coinciden exactamente con el código preparado. Verificación de permisos remota: rol ejecutor sin login, superusuario ni bypass RLS; clientes no pueden ejecutar la RPC de evidencia y el backend no puede insertar directamente. Los avisos de seguridad existentes no aumentaron.

Caso reservado para la prueba remota: solicitud `3ab60af6-ef86-40b7-a4c0-c11690761bfd`, pago simulado por 12,370 centavos MXN, reserva inactiva, sin orden ni movimiento. El recibo original y la nota permanecen intactos. Inventario real total: 50; órdenes reales: 0. Antes de ejecutar el reembolso: cero avisos de reembolso y resolución `unresolved`.

**Bloqueo pendiente:** Stripe rechazó la actualización de suscripciones del endpoint `we_1UR03RRpe0k2YzxPZ07v9GNV` porque la conexión necesita renovar permisos. Todavía NO se añadieron los eventos de reembolso al endpoint y NO se solicitó ningún reembolso. Se requiere renovar la conexión del entorno de prueba RHO, añadir solo los tres eventos mencionados conservando Checkout, ejecutar un reembolso de prueba por 12,370 centavos y comprobar su aviso firmado y la resolución. La sesión administrativa del navegador también venció; la pantalla publicada aún requiere comprobación con sesión real. QW10 permanece abierto.

## Reversión

Retirar únicamente los tres eventos de reembolso del endpoint de Stripe, conservando los dos eventos de Checkout, y restaurar los cuatro archivos de la función `stripe-test-orders` de su versión 2. La tabla de evidencia se conserva; no se elimina ni reescribe historial. Restaurar el panel anterior solo si fuese necesario, teniendo presente que sus notas no demuestran resolución de pagos.
