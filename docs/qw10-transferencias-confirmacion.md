# QW10: confirmación administrativa de transferencias simuladas

La referencia de checkout por transferencia podía prepararse, pero no existía un
recorrido para registrar su confirmación y generar una orden. El nuevo panel
`admin-transfer-pruebas.html` permite simular ese recorrido con un importe exacto
y una referencia `BANKTEST-…`, seguido de preparación y salida de prueba.

## Alcance

Solo administrador con MFA, perfil activo, sesión vigente y solicitudes propias.
No consulta un banco, no acredita abonos y no contiene datos bancarios reales.
El inventario y las órdenes operativas permanecen fuera de su alcance. Se mantiene
el control de firma y confirmación Stripe existente para las tarjetas.

La preparación por checkout continúa siendo una preparación, no una consulta del
estado del pago. Su mensaje enlaza al nuevo panel para consultar la confirmación.
Una nueva entrada permitida en la lista de retorno administrativo conserva ese
destino después de MFA; siguen rechazándose destinos externos.

## Integridad

Cada confirmación conserva referencia única, importe, administrador y fecha.
Su correlación usa `tr_test_…`; `payment_intent_id` es NULL. No se inventan sesiones,
PaymentIntents ni eventos Stripe para transferencias. La auditoría identifica
`administrator / admin-transfer-pruebas` y conserva los actores históricos.

La transacción bloquea la solicitud y las existencias en orden de SKU, revisa el
vencimiento después de esperar, respeta las reservas web y de pedidos especiales,
y crea recibo, orden, movimiento y auditoría de forma atómica. Un reintento exacto
no duplica; otra referencia para la misma solicitud o la misma referencia para
otra solicitud se rechazan. Una confirmación vencida, inactiva o sin stock queda
en revisión sin orden ni descuento parcial. La preparación exige orden pagada;
la salida exige preparación previa. Repetir un paso no retrocede su estado.

El RPC público es SECURITY INVOKER. Su implementación privada tiene un rol sin
inicio de sesión, sin bypass de RLS y sin acceso al inventario real. No se conceden
escrituras directas a clientes ni al servicio. La reversión elimina las entradas
del nuevo flujo y conserva recibos, órdenes, referencias, restricciones compatibles
y auditoría; no borra ni recrea evidencia.

## Verificación

Tres grupos de modelo y ocho grupos de base aprobados localmente. Se prepara CI
con cuatro contenciones reales en PostgreSQL desechable: misma solicitud, referencia
compartida, vencimiento durante espera y reserva especial concurrente. Se incluyen
Chromium/WebKit móvil, recuperación de acceso, errores inciertos, cambio de cuenta,
validación del importe y secuencia de preparación/salida. Publicación y recorrido
autenticado remotos pendientes antes de dar este avance por validado.

La fuente oficial de códigos postales volvió a agotar el tiempo de consulta; no se
incorporaron rangos inferidos como cobertura. Continúan pendientes cobertura y
domicilio verificables, fuente de confirmación bancaria real, operación real y
aceptación funcional en Safari nativo. No equivale al cierre integral del QW10.
