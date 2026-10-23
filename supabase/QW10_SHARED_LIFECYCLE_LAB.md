# QW10 — ciclo compartido de reservas, laboratorio

22 octubre 2026. Solo copia sintética de la integración; no migración ni despliegue remoto.

Ejecutar exportador `node tests/integrated-consumption-database.mjs --export-fixture`, luego `node tests/shared-lifecycle-database.mjs`.

Nueve grupos aprobaron localmente: disponibilidad compartida web/cotización manual; reintentos sin duplicar o extender fechas; ajuste manual respeta reserva web; consumo libera su propia reserva bajo bloqueo y respeta las ajenas; pago repetido no duplica consumo; pedido especial separa piezas disponibles y excedente por cotizar; active=true vencido deja de reservar; pago tardío conserva recibo/caso de conciliación sin orden ni salida; pago sin reserva propia vigente no consume silenciosamente.

El lector private.inventory_reserved de la copia suma reservas manuales y web/especiales usando hora del servidor. El escritor de reservas toma bloqueo por referencia y fila SKU; persiste la demanda original incluso cuando todo requiere cotización. Cada nueva demanda necesita referencia nueva: el reintento de la referencia antigua conserva el resultado original y nunca renueva vencimientos.

El consumidor exige reserva propia vigente y suficiente para las líneas. Bajo bloqueo de todas las filas SKU, libera su reserva y llama al consumidor integrado existente: las guardas ven únicamente las reservas ajenas. Un fallo revierte la liberación. Una solicitud pagada vencida o sin reserva válida produce needs_reconciliation y un caso persistente, sin orden ni descuento; el recibo puede persistir con ese resultado. Esta es una política conservadora de laboratorio, sin reembolsos automáticos ni mensajes.

Límites: reserva y solicitudes usan identificadores sintéticos, no están conectadas a las funciones desplegadas ni al registro operativo de cotizaciones. No se verificó todavía concurrencia para esta ampliación del ciclo. El productor de recibos mantiene la limitación de autorización descrita en QW10_SIGNED_RECEIPT_LAB.md. La reconciliación es un registro técnico; faltan interfaz/operación, prueba de identidad y flujo remoto completo en sandbox. No asumir QW10 terminado ni habilitar producción.
