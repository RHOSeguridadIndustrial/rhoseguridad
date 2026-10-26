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
limpieza por cierre de sesión y respuestas atrasadas. CI y prueba remota pendientes.
La consulta posterior a la migración mantiene cero órdenes reales y 50 piezas
totales de inventario real.

Este avance no acredita una dirección físicamente existente, cobertura de un
transportista, pago bancario real ni aceptación en Safari nativo de iPhone.
