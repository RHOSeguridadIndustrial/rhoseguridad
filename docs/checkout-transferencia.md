# Solicitud de compra por transferencia

El carrito ofrecía transferencia como estimación pero no permitía continuar.
Ahora enlaza a `checkout-transferencia.html` para revisar contacto, domicilio,
artículos y un resumen antes de compartir una solicitud por WhatsApp con RHO.

## Operación

1. El cliente elige Continuar con transferencia y completa contacto y entrega.
2. Revisar mi solicitud vuelve a consultar precios activos MXN y existencias.
3. El cliente revisa el resumen y envía el mensaje en WhatsApp a RHO.
4. RHO confirma existencias, cobertura, envío, total, referencia y datos bancarios.
5. El pago permanece pendiente hasta que RHO confirma la recepción del dinero.

Este flujo es una solicitud con atención manual: no registra automáticamente un
pedido, no reserva inventario, no concilia abonos ni activa cobros en línea.
Los datos de contacto y domicilio permanecen en memoria de la página hasta que
el cliente decide compartirlos por WhatsApp. No se guardan en localStorage,
sessionStorage ni en nuevas tablas. Cerrar o cambiar de sesión limpia el formulario.

Los faltantes y el stock desconocido se derivan a Suministro especializado.
La política existente de envío se reutiliza sin cambiar sus umbrales; el resultado
es una estimación. Los destinos fuera de CDMX y los beneficios sin registro
reconocido conservan envío y total por confirmar. Los datos bancarios de Inbursa proporcionados por Rafael el 31/10/2026
se muestran con botones de copia. Se indica utilizar únicamente el importe y la
referencia confirmados por RHO; el resumen permanece como estimación.

## Validación

- 19 pruebas del modelo de cotización y solicitud aprobadas.
- UI móvil a 390 px: revisión del resumen y enlace de WhatsApp con datos ficticios;
  edición de domicilio invalida el enlace anterior; sin desbordamiento horizontal.
- Stock agotado, fallo de consulta y cierre de sesión comprobados en vista previa.
- Catálogo real consultado desde vista previa sin modificaciones de pedidos ni stock.
- No se enviaron mensajes ni se transfirió dinero.

La conciliación bancaria automática y un checkout que cree órdenes persistentes
siguen fuera de este cambio. La aceptación en Safari nativo sigue pendiente.
