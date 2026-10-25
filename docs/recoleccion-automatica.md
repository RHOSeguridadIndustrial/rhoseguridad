# Selección de proveedor para RHO

Estado: motor de decisión y máquina de estados implementados y probados de forma aislada. Sin conexión a
cotizadores, webhook de pago, inventario ni contratación. No programa recolecciones.

## Reglas de selección

- Trayectos de 3 a 80 km por ruta; destino CDMX. No se amplía cobertura por distancia.
- Presupuesto propuesto: envío cobrado al cliente + 8% del subtotal. Porcentaje configurable, pendiente de aprobación para contratación real.
- Usar la fecha límite guardada en el pedido al confirmar el pago; no reiniciar el
  plazo al empacar. El servicio de pedidos debe calcular días hábiles y festivos
  para estándar y conservar la promesa express. Este motor recibe timestamps UTC.
- Preparación confirmada, pago confirmado y paquete aceptado son obligatorios.
- Cotización vigente vinculada al pedido y revisión de envío (origen, destino,
  paquete, modo de entrega). Cambiar cualquiera de esos datos exige nueva revisión.
- Recolección disponible desde una pieza, después de estar listo, entrega a tiempo.
- Costo completo en centavos MXN: guía, recolección, impuestos, recargos y protección
  requerida incluidos por el adaptador; el motor agrega empaque una sola vez.
- Menor costo gana. En empate: puntualidad histórica, entrega más temprana y
  desempate estable por proveedor/cotización. La distancia no inventa una ETA.
- Proveedores nuevos o no aprobados pasan a evaluación. No usar reputación inventada.
- Sin opción elegible: revisión, conservando la promesa al cliente y su precio.

## Margen pendiente de definición

`grossContributionCents` es la contribución de productos del pedido antes de
logística, después de costos de mercancía y otros costos variables. Todos los
importes deben normalizarse a una misma base fiscal/contable antes de llamar al
motor. `minimumRemainingContributionCents` es el mínimo aprobado para ese pedido;
no tiene valor por defecto. La ausencia de cualquiera impide recomendar.

El 8% es un techo de subsidio, no una garantía de rentabilidad. Una venta de $500
con envío gratuito tiene presupuesto objetivo $40; si ninguna oferta lo cumple,
requiere revisión. No se cobra automáticamente un suplemento al comprador.

## Contrato de integración

`logistics/select-provider.mjs` exporta `selectProvider(order, quotes, policy, now)`.
Los campos y restricciones se documentan mediante fixtures en
`tests/logistics-selection.test.mjs`. Ningún booleano de autorización o precio
puede tomarse directamente del navegador. Un servidor autenticado debe cargar
el pedido, verificar el pago, construir la revisión y validar respuestas de API.

Flujo pendiente de implementación:
1. Pago confirmado: crear trabajo único por pedido/revisión en cola persistente.
2. Preparación confirmada: cotizar usando domicilio, peso y dimensiones reales.
3. Normalizar cotizaciones y ejecutar este motor con margen aprobado.
4. Antes de comprar: bloquear el trabajo y revalidar pago, estado, revisión,
   vigencia de tarifa, disponibilidad y costo; una recomendación no es una reserva.
5. Contratar guía y recolección con claves de idempotencia separadas, persistir
   folios. Si se pierde una respuesta, consultar al proveedor antes de repetir.
6. Registrar confirmación, rastreo, incidencias y puntualidad. Un fallo al pedir
   recolección después de comprar guía se reconcilia, no crea otra guía.

Origen proporcionado: Av. 16 de Septiembre 197, Santa Inés, Azcapotzalco, CP 02140, CDMX. Guardado en `RHO_ORIGIN`; faltan geocodificación y horario de recolección.

Faltantes operativos: datos completos del destinatario,
medidas/peso reales, horario de bodega, margen mínimo, selección y acceso API de
proveedores, reglas para admitir proveedores tras sus pruebas. Las tarifas de
los tests son sintéticas y no representan cotizaciones comerciales.

## Verificación

`node --test tests/logistics-selection.test.mjs tests/pickup-workflow.test.mjs`

No se aplicaron migraciones ni se alteraron políticas publicadas o cobros.

## Avance del 23 de octubre de 2026

`pickup-workflow.mjs` implementa transiciones de pago confirmado → preparación →
cotización seleccionada → guía confirmada → recolección confirmada. Rechaza eventos
de otro pedido, revisión o entorno y reconoce eventos duplicados. Una respuesta
incierta entra a reconciliación: nunca vuelve por sí sola a contratar. Cancelar
tras iniciar la contratación requiere revisar la cancelación con el proveedor.

El CP viene del contacto del comprador; se valida como texto de cinco dígitos.
También se requieren domicilio completo, destinatario, teléfono y peso/medidas.
La ruta debe venir de un cálculo verificado con ambos domicilios; no se convierte
un CP en kilómetros ni se amplía CDMX por estar dentro de 80 km.

Este módulo todavía NO es una cola desplegada ni un conector de transporte. Su
consumidor deberá autenticar los eventos, cargar datos canónicos del pedido,
revalidar tarifas antes de contratar y usar bloqueo transaccional con restricción
única por entorno/pedido/revisión. Persistir booking_pending/pickup_pending antes
de enviar; tras reinicio, reconciliar con la clave externa. seenEvents debe
guardarse en una tabla de eventos única en la implementación persistente.

Validación: 16 pruebas aprobadas con datos ficticios. Sin solicitudes a proveedores,
sin guías compradas y sin modificaciones a la orden de prueba #5.

## Avance del 24 de octubre de 2026

Se agregó persistencia transaccional de laboratorio y un productor que lee pagos
canónicos de QW10. Consulte [Cola de recolección](cola-recoleccion.md) para el
contrato, las 23 pruebas y los límites. No hay cola desplegada ni contratación real.
