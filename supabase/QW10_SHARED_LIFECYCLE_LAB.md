# QW10 — ciclo compartido de reservas, laboratorio

22 octubre 2026. Solo copia sintética de la integración; no migración ni despliegue remoto.

Ejecutar exportador `node tests/integrated-consumption-database.mjs --export-fixture`, luego `node tests/shared-lifecycle-database.mjs`.

Nueve grupos aprobaron localmente: disponibilidad compartida web/cotización manual; reintentos sin duplicar o extender fechas; ajuste manual respeta reserva web; consumo libera su propia reserva bajo bloqueo y respeta las ajenas; pago repetido no duplica consumo; pedido especial separa piezas disponibles y excedente por cotizar; active=true vencido deja de reservar; pago tardío conserva recibo/caso de conciliación sin orden ni salida; pago sin reserva propia vigente no consume silenciosamente.

El lector private.inventory_reserved de la copia suma reservas manuales y web/especiales usando hora del servidor. El escritor de reservas toma bloqueo por referencia y fila SKU; persiste la demanda original incluso cuando todo requiere cotización. Cada nueva demanda necesita referencia nueva: el reintento de la referencia antigua conserva el resultado original y nunca renueva vencimientos.

El consumidor exige reserva propia vigente y suficiente para las líneas. Bajo bloqueo de todas las filas SKU, libera su reserva y llama al consumidor integrado existente: las guardas ven únicamente las reservas ajenas. Un fallo revierte la liberación. Una solicitud pagada vencida o sin reserva válida produce needs_reconciliation y un caso persistente, sin orden ni descuento; el recibo puede persistir con ese resultado. Esta es una política conservadora de laboratorio, sin reembolsos automáticos ni mensajes.

Límites: reserva y solicitudes usan identificadores sintéticos, no están conectadas a las funciones desplegadas ni al registro operativo de cotizaciones. No se verificó todavía concurrencia para esta ampliación del ciclo. El productor de recibos mantiene la limitación de autorización descrita en QW10_SIGNED_RECEIPT_LAB.md. La reconciliación es un registro técnico; faltan interfaz/operación, prueba de identidad y flujo remoto completo en sandbox. No asumir QW10 terminado ni habilitar producción.

## Evidencia automatizada

Ejecutado y aprobado: https://github.com/RHOSeguridadIndustrial/rhoseguridad/actions/runs/39899390671 . Commit `240887e7dbc02db5deac772b1b9a2eb2aab4252f`, job `120237182637`, success. Nueve grupos de ciclo compartido y cuatro casos de concurrencia del ciclo nuevo, además de las suites anteriores.

Conexiones PostgreSQL independientes comprobaron: web contra pedido especial por última unidad; cotización manual antes de reserva web; reserva web antes de cotización manual; reserva que vence mientras consumo espera bloqueo. El último conservó stock=1, órdenes=0, casos de conciliación=1 y active=true con cantidad reservada vigente=0. Se exigió observar espera por bloqueo en los cuatro casos.

Primer intento de concurrencia `39899205897` falló antes de los casos al recrear roles globales del servidor de pruebas en una segunda base. La preparación se corrigió para reutilizar roles sintéticos existentes tras verificar NOLOGIN/NOBYPASSRLS; no se cambió la lógica para obtener éxito. Esta evidencia cierra el pendiente de concurrencia indicado arriba para esos casos específicos; permanece el trabajo de integración remota, identidad y operación descrito.
