# QW10 — recibo firmado conectado al consumo aislado

22 octubre 2026. Laboratorio sin llamadas API de Stripe ni escrituras remotas.

Se leyó mediante el conector oficial la función desplegada stripe-test-orders, versión 2, ACTIVE, ezbr_sha256 1dd7e9165cb8d233c001ecff371c2e982e5775b8a442aeec05ba819e68f50b44. Sus tres módulos compartidos se copiaron sin cambios funcionales a tests/fixtures/receipt-runtime. La función stripe-test-notifications se confirmó como diagnóstico separado, sin fulfillment.

SDK stripe 22.6.0 fijado en package.json y package-lock.json de tests. Los secretos y claves de este test son literales sintéticos sin cuenta asociada. Se genera la cabecera de prueba con el SDK y se verifica con constructEventAsync sobre el cuerpo intacto. La recuperación de Checkout usa una respuesta simulada; no se consultaron pagos ni se iniciaron sesiones.

Ejecución: primero `node tests/integrated-consumption-database.mjs --export-fixture`; después `node tests/signed-receipt-integration.mjs`.

Siete grupos aprobados localmente:
1. Firma incorrecta o cuerpo alterado: 400, sin lecturas API simuladas ni commit.
2. Evento firmado livemode=true rechazado.
3. Importe, moneda, modo y referencia inconsistentes rechazados sin recibo/orden.
4. unpaid permanece pending, sin consumo.
5. Pago sintético válido produce recibo, orden, descuento y actor automático.
6. Otro evento de éxito del mismo pago retorna already_consumed, sin cambios.
7. Reserva manual que impide descuento revierte recibo/orden/eventos y retorna 500 para reintento.

El adaptador del laboratorio carga el propietario desde la solicitud bloqueada y ejecuta el consumo bajo lab_worker; el productor de recibos se ejecuta como dueño del fixture. Esto prueba la composición del código desplegado con el modelo de consumo y rollback, pero no acredita todavía la autorización real del productor ni la llegada de un webhook remoto. No se desplegó este adaptador.

Pendientes: identidad mínima del productor de recibos, entrega y reintentos reales en sandbox, integración del ciclo de reservas web/especiales con el esquema compartido y política de reconciliación de pagos tardíos/sin stock. Las pruebas de concurrencia anteriores se mantienen como evidencia separada. QW10 sigue abierto y producción deshabilitada por alcance.

Referencias consultadas: https://docs.stripe.com/checkout/fulfillment y https://docs.stripe.com/webhooks — firma sobre cuerpo original, recuperación de estado actual e idempotencia del fulfillment.

## Evidencia CI y lectura de control

Ejecutado en GitHub Actions: https://github.com/RHOSeguridadIndustrial/rhoseguridad/actions/runs/39898203390 . Commit `357f3f0b2cfd8bbf1a7bc01daec7295138c7a555`, job `120233435311`, success. Aprobó siete grupos de recibos firmados, seis carreras de integración y cuatro carreras del modelo previo.

Consulta oficial de solo lectura a las 22:03:09 CDMX del 22 octubre 2026: sum(quantity) del inventario real = 50; órdenes de prueba = 5. Es distinto del conteo histórico de 4: la orden #5 ya existía desde 18:45:38 CDMX, livemode=false. Este laboratorio no creó ninguna orden remota. No se atribuye aquí el origen de esa orden.
