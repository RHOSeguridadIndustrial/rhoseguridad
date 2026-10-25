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
perder evidencia. Chromium y WebKit móvil: pendientes de CI al preparar el cambio.

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
e inventario real 50 / órdenes reales cero. Publicación y verificación remota del
panel: pendientes al preparar este cambio.
