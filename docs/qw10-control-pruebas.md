# QW10: control interno del entorno de prueba

## Comportamiento

El panel `admin-control-pruebas.html` cruza las solicitudes propias del
administrador con recibos, órdenes, artículos reservados, movimientos de stock,
eventos de preparación/salida y eventos de auditoría. Es de consulta y no crea ni
confirma pagos, transferencias, órdenes o movimientos. No sustituye la confirmación
del proveedor ni una conciliación bancaria.

Detecta diferencias de importe y sesión, recibos pagados sin orden, órdenes o
movimientos sin pago, diferencias exactas por SKU/cantidad, preparación sin orden
pagada, salida sin preparación previa, reserva activa después del recibo,
cotización inconsistente y evento de auditoría distinto del recibo.

Un pago `reconciliation_required` conserva ese estado aunque tenga una nota.
Los registros anteriores sin evento de auditoría se muestran con esa limitación;
no se inventan eventos retrospectivos ni se atribuye confirmación bancaria.

Los totales incluyen todas las solicitudes propias. Los detalles tienen un máximo
de 100 y priorizan discrepancias y pagos en revisión; se informa cuando se aplica
ese límite. El informe es una consulta del estado actual: no acredita siete días
consecutivos de operación ni un historial de conciliaciones diarias.

## Acceso y coherencia

El RPC público es SECURITY INVOKER. La consulta privada SECURITY DEFINER usa el
control existente de administrador, MFA, perfil activo y sesión vigente, además
de filtrar por `auth.uid()` como propietario. No concede lectura directa de tablas.
Anon, clientes y service_role no reciben acceso al reporte. Las funciones son
STABLE y calculan totales y detalles con la misma instantánea de lectura.

El navegador valida entorno, alcance, tipos, sumas y contadores; elimina el informe
ante error o cambio de identidad y descarta respuestas tardías. Todos los textos
se insertan con textContent. La reversión elimina únicamente las dos funciones
nuevas y conserva todos los datos de prueba.

## Comprobaciones

Pruebas locales: tres grupos del modelo y siete grupos de base aprobados. Incluyen
roles/MFA/propietario, ejecución en transacción READ ONLY sin cambios de datos,
notas que no resuelven pagos, defectos inducidos en importe/orden/movimiento/salida,
121 solicitudes propias con totales completos y 100 detalles, y reversión sin
perder evidencia. Chromium y WebKit móvil: aprobados dos grupos por motor en CI
40156424617 (rama) y 40156521862 (main). Publicación Pages 40156521878
correcta, PR #30 integrado en `23929bf577d94eea2c2c6ad722e5361cd5acee26`.

El cruce de solo lectura con Stripe sandbox del 24 de octubre de 2026 encontró seis
sesiones completas vinculadas a solicitudes de RHO. Coinciden sesión, referencia,
PaymentIntent, importe, moneda MXN y livemode=false con sus seis recibos locales.
Cinco tienen orden; una conserva el estado de revisión por reserva inactiva.
La sesión adicional marcada por Stripe como diagnóstico y sin surtido se distingue
de esas seis. El recibo `simulation_20261015` es un registro sintético SQL, no una
sesión acreditada de Stripe. No se mutaron esos registros ni la cuenta Stripe.

## Límites del avance

Faltan cobertura/domicilio verificables, integración de la confirmación bancaria,
operación sobre inventario real y aceptación funcional en Safari nativo de iPhone.
La meta de siete días sin diferencias pertenece a la fase de estabilidad del
roadmap propuesto; esta consulta no la declara alcanzada.

Migración `20261025025647_qw10_test_integrity` aplicada. La llamada sin identidad
fue rechazada y se verificaron SECURITY INVOKER público, STABLE, permisos limitados
e inventario real 50 / órdenes reales cero. La verificación del panel publicado
detectó un bloqueo de interfaz con la sesión administrativa válida: SIGNED_IN
reconfirmaba la misma identidad durante el control inicial y alteraba la época
de la consulta. PR #31 corrige la comparación de identidad sin cambiar el control
de MFA, permisos o sesión del servidor. La regresión se reprodujo antes del arreglo
y la prueba local pasó después. Las pruebas de navegador incluyen reconfirmación
de la misma cuenta y cambio de propietario durante una respuesta pendiente.


## Publicación y verificación autenticada — 24 de octubre de 2026

PR #31 integrado en `83b43d87f61216a4d43a5efc621809ca22d616e5`.
CI de la corrección: 40156879559 (rama) y 40156988184 (main), ambas aprobadas;
publicación Pages 40156988237 correcta. Se ejecutaron los tres grupos de modelo,
siete de base y dos por cada motor de navegador. El recorrido publicado confirmó
que una sesión ya verificada puede cargar el control sin un nuevo código MFA.

La consulta autenticada de las 21:07:19 CDMX mostró:

| Indicador de la cuenta verificada | Resultado |
| --- | ---: |
| Solicitudes propias | 11 |
| Recibos registrados | 5 |
| Órdenes de prueba | 4 |
| Importe de recibos con estado pagado | 925.43 MXN |
| Importe en revisión | 123.70 MXN |
| Salidas de prueba registradas | 3 |
| Solicitudes con diferencias internas | 0 |
| Solicitudes sin recibo | 6 |
| Transferencias simuladas sin recibo | 5 |
| Recibos históricos sin evento de auditoría | 3 |

El caso `3ab60af6-ef86-40b7-a4c0-c11690761bfd` conserva revisión y ausencia de
orden; su nota no lo convierte en resuelto. La orden #6 conserva salida registrada.
Los tres recibos históricos sin auditoría se muestran con esa limitación. Cero
diferencias significa consistencia de los registros comprobados; no certifica
cobro bancario, operación real, siete días de estabilidad ni cierre integral.

Los conteos globales a las 21:06:01 CDMX fueron 16 solicitudes, siete recibos,
seis órdenes y seis movimientos de prueba. El panel tiene alcance por propietario;
sus once solicitudes no deben confundirse con esos totales globales. Inventario
real: 50 unidades; órdenes reales: cero. No se crearon nuevos pagos, órdenes,
movimientos ni eventos de preparación durante la consulta.

## Aclaración del estado original — 26 de octubre de 2026

El control muestra el estado del recibo al procesar el pago. Sus etiquetas ya no
afirman que un caso siga pendiente: un reembolso posterior puede haberlo resuelto.
La advertencia enlaza a Revisión de pagos para consultar la resolución actual y
los reembolsos. Se conservan los importes, el histórico y la validación de integridad;
esta aclaración no incorpora reembolsos al cálculo ni modifica datos.
