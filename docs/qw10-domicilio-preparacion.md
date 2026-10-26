# QW10 — domicilio conservado durante preparación y salida

25 de octubre de 2026, CDMX. Mejora del entorno de pruebas, sin activar compras
ni entregas reales.

La cotización postal ya guardaba el domicilio, pero las pantallas de preparación
no lo mostraban. Ahora transferencia y confirmación de tarjeta presentan calle,
número exterior/interior, colonia, alcaldía, CP y referencias de la cotización.
El texto especifica que es una coincidencia postal histórica y una simulación.
Los registros anteriores sin domicilio se identifican como pruebas rápidas.

El lector qw10_test.transfer_snapshot agrega exclusivamente quote.delivery a la
respuesta existente. Conserva propietario, ACL, seguridad invoker y filtro de
cuenta/entorno. No cambia las funciones de pago, reserva, descuento o despacho.
La migración 20261026030851_qw10_test_transfer_delivery se aplicó y se verificaron
el propietario postgres y los mismos permisos exclusivos del ejecutor.

El modelo de pantalla valida estructura, procedencia, fechas y domicilio
normalizado. Un catálogo histórico vencido puede consultarse sin atribuirle una
validación actual de cobertura. Las respuestas incoherentes no habilitan acciones.
En confirmación de tarjeta, cerrar sesión o cambiar de identidad limpia domicilio
y artículos; el control de generación descarta respuestas anteriores incluso si
se vuelve a la cuenta original.

Validación local: 38 pruebas de modelo/domicilio y nueve grupos de base de datos
aprobados. El servidor de prueba sintético comprueba ambos navegadores, domicilio
durante confirmación/preparación/salida, historial sin domicilio, datos inválidos,
limpieza por cierre de sesión y respuestas atrasadas. CI 40263339914 aprobada
sobre 5791047715d826f242c2551c3cbef6b80ed161c6. PR 35 integrada como
77b9f3bb5a7f9db105edaaa344a41c9186608bfb; CI de main 40263478973 y
40263478977 aprobadas. Pages publicó 1be741a58727581b77a330a035f1e8f25c3954ab
mediante 40263490130; ese commit conserva esta mejora y añade el cotizador de
otro trabajo concurrente. No se sobrescribieron sus cambios.
La consulta posterior a la migración mantiene cero órdenes reales y 50 piezas
totales de inventario real.

Este avance no acredita una dirección físicamente existente, cobertura de un
transportista, pago bancario real ni aceptación en Safari nativo de iPhone.

## Verificación remota, 25/10/2026, 21:20 CDMX

Con sesión de administrador y MFA se preparó una transferencia ficticia por
$123.70 MXN para un N95: Calle Ficticia 123, interior 2, Centro de Azcapotzalco,
Azcapotzalco, CP 02000; referencia de domicilio «Portón ficticio azul».
Solicitud de prueba: aff8037b-29c7-4d51-aafa-6ea4af61d5df.

La confirmación administrativa simulada creó la orden #8 a las 21:20:17 CDMX.
Preparación registrada a las 21:20:36 y salida a las 21:20:49. El domicilio completo
permaneció visible en cada estado. La base conserva una confirmación, un recibo,
una orden, un movimiento de una unidad y dos eventos (preparación/salida).
Stock N95 de prueba: 7 → 6. Inventario real: 50 → 50; órdenes reales: 0.
livemode=false. La cotización conserva el mismo domicilio y hashes de procedencia.
No se realizó ni se acreditó una transferencia bancaria real, ni se programó entrega.

La advertencia preexistente de protección de contraseñas filtradas deshabilitada
permanece sin cambio; los avisos de seguridad no aumentaron con esta migración.
