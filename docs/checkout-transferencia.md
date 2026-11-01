# Checkout por transferencia — solicitudes registradas

Actualización: 1 de noviembre de 2026. Sustituye el cierre por WhatsApp descrito en la versión anterior.

## Flujo publicado

1. Carrito → Compra por transferencia. El cliente inicia sesión con cuenta verificada y activa; puede continuar desde Mi cuenta.
2. Completa contacto y domicilio, consulta precios y existencias y revisa el resumen.
3. “Registrar solicitud en RHO” guarda la solicitud y devuelve un folio `SOL-` de diez dígitos.
4. “Mis solicitudes” permite volver a consultar las últimas 50; Mi cuenta incluye el acceso.
5. Administración → Solicitudes por transferencia muestra las últimas 50 con sesión administrativa y autenticador vigentes.

El estado es **pendiente de revisión**, el pago está **sin confirmar** y envío/total final siguen pendientes. La solicitud no reserva mercancía, crea una orden, descuenta inventario ni programa entrega. No se habilitan pagos con tarjeta. RHO debe validar el total antes de que el cliente transfiera. La confirmación bancaria y el ciclo de preparación/entrega reales siguen pendientes de implementación.

## Persistencia y acceso

- Migración `20261101065319_transfer_purchase_requests.sql`; tabla privada con RLS y sin permisos directos para clientes ni visitantes.
- RPC públicas invocadoras; funciones privadas verifican identidad, cuenta activa, correo confirmado, usuario no anónimo/bloqueado y sesión vigente. Administradores requieren las comprobaciones MFA e inactividad existentes.
- Lectura limitada al propietario o administrador autorizado. No se recibe un identificador de otro cliente.
- Sólo el servidor toma nombres, precios MXN activos y existencias del catálogo. Rechaza cambios de precio desde la revisión, faltantes, SKU duplicados y cantidades inválidas.
- Folio idempotente por cuenta/UUID y contenido normalizado. Reintentar una respuesta perdida devuelve el mismo resultado aunque el catálogo cambie después. Un UUID reutilizado con contenido diferente se rechaza.
- Límite de 10 solicitudes nuevas por cuenta/hora, serializado por cuenta. Los reintentos válidos no consumen otro registro.
- Contacto/domicilio se guardan únicamente al pulsar Registrar. El navegador conserva en sessionStorage sólo un hash y el UUID de reintento; nunca el domicilio ni teléfono. Al cambiar/cerrar sesión se limpia la pantalla.
- Atención operativa: revisar el panel administrativo. No se envían correos ni notificaciones automáticas. Las solicitudes no tienen todavía acciones de aprobación, pago o salida.

## Validación

`node tests/transfer-persistence-database.mjs`: persistencia, precios del servidor, reintentos, conflicto, datos/cantidades inválidos, stock insuficiente, aislamiento, permisos directos, sesión/cuenta/MFA, límite y ausencia de cambios en órdenes/inventario.

`node tests/transfer-persistence-browser.cjs`: Chromium/WebKit, revisión, registro, respuesta perdida y reintento con la misma clave, recibo móvil, consulta y limpieza al salir. Usa datos sintéticos; no crea solicitudes de clientes en producción ni equivale a aceptación física en iPhone.

Workflow: `.github/workflows/transfer-persistence.yml`.

## Autocompletado postal conservado

Se conserva `postal-lookup` y el catálogo nacional privado previamente desplegado: consulta por CP, colonia única/múltiple, cancelación de respuestas antiguas y corrección manual. Esto no certifica cobertura logística ni dirección física. Los datos bancarios publicados y botones Copiar permanecen sin cambios.
