# QW10: desglose antes del pago de prueba

## Problema y cambio

La preparación devolvía subtotal, envío y cupón, pero la pantalla solo mostraba
el total. Ahora presenta cada artículo con cantidad, nombre y precio del servidor,
productos con IVA incluido, modalidad/costo del envío simulado, cupón y total MXN
antes de abrir Stripe. La transferencia simulada presenta el mismo desglose.

`create-test-checkout` añade a su respuesta la moneda, líneas de la cotización
inmutable y `expiresAt`. Los reintentos conservan precios, cantidades y plazo.
No se recalcula el importe con datos del catálogo local del navegador.

El cliente comprueba moneda, identidad/cantidad de artículos, sumas enteras en
centavos y coherencia del cupón antes de mostrar éxito o un enlace de pago.
Una respuesta incompleta o inconsistente conserva la clave de reintento y muestra
el mensaje de resultado incierto. No crea automáticamente otra solicitud.

El resumen se elimina al cambiar carrito, método o identidad, cerrar sesión o
iniciar otro intento. Las respuestas tardías no restauran importes anteriores.
Los nombres se insertan como texto, sin interpretar HTML.

## Vigencia

La fecha se etiqueta como **vigencia de la preparación** y se presenta con zona
America/Mexico_City explícita. `expiresAt` es el vencimiento del checkout (32 minutos
en la reserva actual). La retención de stock puede durar cinco minutos adicionales
para recibir la confirmación. No se confunden ambos plazos ni se promete disponibilidad
real. El servidor conserva la validación final de la reserva.

## Validación

- 29 pruebas de cotización, envío, endpoint, recuperación y resumen: aprobadas
  localmente. Incluyen ambos métodos, umbrales 298.99/299.00/1200.00/1200.01,
  reintento con precio congelado, carrito distinto, importes inconsistentes,
  datos incompletos y moneda incorrecta.
- Siete grupos de base para la recuperación de transferencia vencida.
- Chromium de escritorio y WebKit móvil en CI: pendientes al preparar este cambio.
  Casos añadidos: desglose pagado/gratis, rechazo de suma incorrecta, texto seguro,
  limpieza al cerrar sesión y respuesta tardía tras cambiar carrito.
- Comprobación remota y publicación: pendientes al preparar este cambio.

## Alcance

No modifica esquema, permisos, reservas, confirmaciones de pago o inventario.
El checkout de prueba sigue limitado al administrador con MFA y al CP fixture 02000.
No valida domicilio ni cobertura real. La consulta de catálogos oficiales de CDMX
y SEPOMEX no produjo un archivo verificable en este entorno; no se añadió una lista
inferida de códigos postales.

La conciliación bancaria, inventario/despacho operativo y aceptación funcional en
Safari nativo de iPhone siguen sin acreditarse. QW10 integral permanece abierto.
