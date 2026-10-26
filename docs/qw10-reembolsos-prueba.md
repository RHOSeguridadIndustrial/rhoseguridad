# QW10 — resolución de pagos de prueba por reembolso

Implementación en validación. No habilita ventas reales, no inicia reembolsos desde la página y no acredita movimientos bancarios de Inbursa.

El webhook existente verifica la firma de Stripe sobre el cuerpo original y conserva los avisos `refund.created`, `refund.updated` y `refund.failed` con `livemode=false` en un registro de solo inserción. Se conservan el pago, importe, moneda, estado, identificador del aviso y fecha del proveedor. No se guardan datos de tarjeta, cliente ni cuerpos completos. El rol ejecutor únicamente lee e inserta esos avisos; no puede escribir órdenes, recibos ni inventario.

El panel de revisión mantiene la nota administrativa separada de la resolución. Solo muestra «Reembolso de prueba confirmado» cuando existe exactamente un reembolso exitoso por el importe completo en MXN, vinculado al mismo PaymentIntent, sin orden ni movimientos. Los reembolsos parciales, múltiples, pendientes, cancelados, fallidos y casos ambiguos permanecen abiertos. El recibo de pago y la revisión original nunca se reescriben.

Se conserva evidencia aunque el aviso de reembolso llegue antes del recibo de compra. La fecha del evento determina el estado, no su orden de llegada; ante dos estados del mismo segundo prevalece el no exitoso. Un fallo posterior vuelve a mostrar resolución pendiente. El panel depende de la recepción de avisos; no certifica una consulta bancaria ni llegada de fondos reales.

Fuentes de contrato: https://docs.stripe.com/api/refunds/object y https://docs.stripe.com/api/events/types. No se cambiaron la API 2026-08-26.dahlia, el SDK Stripe 22.6.0 ni los secretos existentes.

## Validación

Pendiente de registrar resultados de CI y prueba remota. El laboratorio usa datos sintéticos y firmas generadas con una clave ficticia; no certifica el proveedor remoto ni Safari nativo en iPhone.

## Reversión

Retirar únicamente los tres eventos de reembolso del endpoint de Stripe, conservando los dos eventos de Checkout, y restaurar los cuatro archivos de la función `stripe-test-orders` de su versión 2. La tabla de evidencia se conserva; no se elimina ni reescribe historial. Restaurar el panel anterior solo si fuese necesario, teniendo presente que sus notas no demuestran resolución de pagos.
