# Cotizador virtual RHO

`cotizador.html` consulta los 22 productos del catálogo y las variantes de
`inventory-catalog.js`. Conserva nombres vigentes de inventario, unidades, tallas
y colores. Solo usa precios activos en MXN obtenidos de la API pública existente;
no usa precios almacenados en caché cuando falla la consulta.

El cliente puede buscar, filtrar, añadir artículos, ajustar cantidades enteras,
retirar partidas e importar su carrito. La importación reemplaza la selección de
la cotización y vuelve a resolver los precios; nunca escribe en el carrito.

El cálculo usa centavos enteros y desglosa el IVA de 16% ya incluido en los
productos. Reutiliza `shipping-coupon.js`: CDMX, forma de pago prevista y registro
verificado mediante `getUser`. No fabrica una tarifa para clientes sin registro
en compras desde $299. La cobertura seleccionada es una estimación y no valida
un domicilio. No consulta ni modifica datos administrativos.

Si una cantidad excede el stock físico, el total final queda pendiente y aparece
el enlace de pedido especial por WhatsApp, con un borrador que debe enviar el
cliente. No se abre WhatsApp ni se envían comunicaciones automáticamente. Las
existencias físicas no constituyen disponibilidad reservada.

`Imprimir / guardar PDF` vuelve a consultar los datos y prepara una hoja de
impresión con logo, fecha CDMX, cliente/empresa opcionales, artículos, cantidades,
importes y condiciones. Utiliza la impresión del navegador. No genera folio
oficial, factura, pedido, reserva ni pago; no fija una vigencia comercial nueva.
La selección y los datos del documento permanecen solo en memoria. Al cambiar de
cuenta se limpian. La consulta se considera obsoleta después de cinco minutos.

Entradas: inicio (botón y menú), menú de Productos y carrito. El acceso desde
`carrito.html` usa `?desde=carrito` para importar la selección de la sesión.
No se modifican funciones de pago, políticas, precios, inventario ni el banner.

Validación: 24 pruebas locales de cálculo, impuestos incluidos, límites de
cantidades, variantes, datos inválidos, excedentes y regresión de envíos/canal de
compra. Revisión en navegador Chromium del catálogo público, búsqueda N95,
cantidad 3 ($74.10), envío $99 y total $173.10, bloqueo con cantidad 0, pedido
especial, documento imprimible y diseño de ancho móvil. No se hicieron compras,
reservas ni envíos de WhatsApp. No se acredita impresión nativa de iOS.

Ejecutar:
`node --test tests/quote-model.test.mjs tests/shipping-coupon.test.mjs tests/purchase-channel.test.mjs`
