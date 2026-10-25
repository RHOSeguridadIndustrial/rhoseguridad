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

La CI 40159455234 del cambio y 40161955813 de main aprobaron modelo,
base de datos, cuatro contenciones PostgreSQL reales, Chromium/WebKit, retorno
MFA y regresiones de checkout. GitHub Pages 40161955367 publicó el panel.

La comprobación autenticada detectó `permission denied for schema auth`:
el rol de migraciones no puede conceder USAGE sobre el esquema administrado
por Supabase. La migración 20261025043509_qw10_test_transfer_identity resuelve
solo el actor autenticado mediante una función privada SECURITY DEFINER,
restringida al ejecutor de transferencias, que exige private.is_admin().
El ejecutor mantiene su acceso limitado a las tablas de pruebas. La regresión
reproduce la ausencia de USAGE sobre auth y aprueba los nueve grupos de base.

Recorrido publicado verificado el 24/10/2026 (CDMX):
- Confirmación ficticia: 22:35:28; solicitud e1914b9c-d0ad-4371-abbb-d7bd0234652b.
- Importe: 123.70 MXN; referencia BANKTEST-A8F5440741F947E18F19D710905E82F7.
- Orden de prueba #7, un recibo y un movimiento; N95 de prueba de 8 a 7 unidades.
- Preparación: 22:35:42; salida simulada: 22:35:49.
No hubo consulta bancaria, cobro ni entrega real.

La fuente oficial de códigos postales volvió a agotar el tiempo de consulta; no se
incorporaron rangos inferidos como cobertura. Continúan pendientes cobertura y
domicilio verificables, fuente de confirmación bancaria real, operación real y
aceptación funcional en Safari nativo. No equivale al cierre integral del QW10.


Migración `20261025034544_qw10_test_transfer_confirmation` aplicada después de CI
40159280974 aprobada (modelo, nueve grupos de base, cuatro contenciones reales,
interfaz Chromium/WebKit, retorno MFA y regresiones de checkout). Se verificó
rechazo sin identidad, RPC público invoker y ausencia de permisos del ejecutor
sobre inventario/órdenes reales. Las quince funciones existentes auditadas conservan
sus hashes; inventario real 50, órdenes reales cero. El asesor no agregó advertencias
de seguridad. El índice por administrador se validó localmente y la copia de
migración debe coincidir byte por byte con el SQL canónico.

Control autenticado posterior, 24/10/2026 22:36 CDMX: 12 solicitudes propias,
6 recibos, 5 órdenes, 4 salidas y cero diferencias internas. Se conservan un pago
anterior en revisión (123.70 MXN), tres recibos anteriores sin evento de auditoría
y cinco transferencias sin recibo. La comprobación global de producción mantiene
50 unidades y cero órdenes; el ejecutor no tiene acceso al inventario real.

Cierre de verificación del avance: commit 9f81a54, CI 40162510486 aprobada
(modelo, base, cuatro contenciones, Chromium/WebKit, MFA y checkout), y Pages
40162510299 publicada correctamente.
