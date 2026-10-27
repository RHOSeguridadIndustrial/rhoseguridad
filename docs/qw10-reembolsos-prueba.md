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

## Evidencia remota confirmada

El bloqueo anterior de suscripción quedó superado: el endpoint `we_1UR03RRpe0k2YzxPZ07v9GNV` contiene los tres eventos de reembolso y conserva los dos de Checkout. Stripe sandbox registra el reembolso `re_3UUBmcRpe0k2YzxP0FQBjbjF`, vinculado a `pi_3UUBmcRpe0k2YzxP0UVdcAHD`, por 12,370 centavos MXN y estado `succeeded`. No debe repetirse.

RHO conserva el evento `evt_3UUBmcRpe0k2YzxP0cRvkEq7`, recibido el **25 de octubre de 2026 a las 22:23:54 CDMX** (2026-10-26T04:23:54.837948Z). La proyección devuelve `refunded`. Este registro acredita el aviso recibido por el consumidor firmado existente; no un movimiento de dinero real.

Revisión de solo lectura del **26 de octubre de 2026 a las 12:30 CDMX**:
- Cero órdenes y cero movimientos para la solicitud de excepción.
- Inventario operativo total: 50 unidades; órdenes operativas: cero.
- Stock N95 de prueba: 6 unidades, igual al control posterior a la orden #8.
- El recibo original conserva `reconciliation_required` y su única nota de revisión; la resolución se consulta por separado.
- `anon` y `authenticated` no pueden ejecutar la RPC de registro de reembolsos.
- `service_role` no puede insertar directamente en la tabla de evidencia.
- Estas comprobaciones no crearon otro reembolso ni modificaron datos operativos.

## Pendientes de aceptación

El 26 de octubre de 2026 se completó el inicio de sesión administrativo y el autenticador mediante el formulario seguro. El panel publicado `admin-revision-pruebas.html` mostró **«0 sin resolver · 1 casos recientes»** y **«Reembolso de prueba confirmado»**, con importe 123.70 MXN y referencias de reembolso/evento coincidentes con Stripe y la base. Esta comprobación fue realizada por el asistente en Chrome en la nube; no acredita Safari nativo de iPhone. El panel de control interno conserva métricas basadas en el estado original del recibo: su importe «en revisión» no debe interpretarse como ausencia del reembolso; la resolución se acredita en el panel de revisión y en la evidencia anterior.

El usuario aportó el 26 de octubre de 2026 la captura `IMG_5491.jpeg` desde su iPhone (hora visible 1:03). Muestra «0 sin resolver · 1 casos recientes», «Reembolso de prueba confirmado» y $123.70 MXN, con las mismas referencias de solicitud, reembolso y aviso. Se registra como evidencia de visualización móvil del resultado. La captura muestra un visor web integrado de iOS; no permite certificar por sí sola Safari independiente, pulsación de Actualizar, compra completa o recorrido de entrega en el dispositivo.

QW10 sigue abierto para los criterios operativos reales (confirmación bancaria, inventario y despacho) y las pruebas móviles funcionales restantes. Tampoco se acredita la meta posterior de siete días estables. El éxito de esta consulta no prueba por sí solo la renovación de todos los permisos de escritura del conector Stripe.

## Reversión

Retirar únicamente los tres eventos de reembolso del endpoint de Stripe, conservando los dos eventos de Checkout, y restaurar los cuatro archivos de la función `stripe-test-orders` de su versión 2. La tabla de evidencia se conserva; no se elimina ni reescribe historial. Restaurar el panel anterior solo si fuese necesario, teniendo presente que sus notas no demuestran resolución de pagos.

## Continuidad de sesión en revisión — 27 de octubre de 2026

El panel conserva los casos al reconfirmar SIGNED_IN o renovar TOKEN_REFRESHED
para la misma identidad. Un cierre o cambio de cuenta elimina los casos e invalida
respuestas pendientes, también durante el arranque. La consulta sigue exigiendo
el guard administrativo, MFA y las restricciones del RPC. No cambia datos ni permisos.

## Resultados vigentes y recuperación de errores — 27 de octubre de 2026

Actualizar casos retira el resultado anterior mientras consulta. Si falla la red
o la validación de la respuesta, no conserva indicadores de reembolso confirmado
ni conteos anteriores. Si se pierde la respuesta al registrar una nota, retira el
formulario y pide actualizar antes de otro intento; una lectura recupera la nota
ya confirmada sin repetir la escritura. No modifica el histórico ni la resolución.
