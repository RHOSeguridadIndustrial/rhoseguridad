# QW10 — conexión operativa de cobros con tarjeta

6 de noviembre de 2026. **Servidor e interfaz implementados; activación pública pendiente.**

## Implementación

El nuevo flujo utiliza `public.orders`, `public.order_items` y `public.inventory_items`.
La migración `20261106100121_card_checkout_operational.sql` añade registros privados
de solicitudes, líneas, recibos y autorización transaccional de movimientos. No
inserta pedidos ni existencias y crea la configuración con `enabled=false`.

- La cotización viene del servidor y compara el total con el aceptado por el cliente.
  Incluye envío, precios con IVA, domicilio validado y máximo de 100 unidades por
  SKU, compatible con la restricción existente de `order_items`.
- Reserva, reintentos y asociaciones se guardan en la base operativa. El precio,
  carrito, propietario y vencimiento quedan congelados. La misma reserva conserva
  la misma clave de idempotencia Stripe después de una interrupción de red.
- Las reservas de tarjeta y las manuales comparten bloqueos de SKU y cálculo de
  existencias comprometidas. La vigencia se revisa después de esperar los bloqueos.
- El webhook verifica la firma con Stripe SDK y consulta la sesión autoritativa.
  La base comprueba importe, moneda, sesión y PaymentIntent antes de registrar
  recibo, pedido, partidas, inventario y auditoría en una única transacción.
- Un aviso repetido devuelve el resultado existente. Un pago tardío conserva el
  recibo para conciliación, sin pedido surtible ni descuento de inventario.
- El actor automático se acredita mediante un registro privado de la misma
  transacción, unido al recibo y SKU. No se suplanta a un administrador ni se confía
  en una bandera del cliente. La auditoría conserva sus columnas históricas y
  añade `card_receipt_id`; cada registro tiene exactamente un actor humano o de pago.
- La consulta `card_checkout_status` es de solo lectura y exclusiva del propietario.
  Reutiliza las comprobaciones de cuenta activa, correo confirmado, sesión vigente
  y MFA de administrador ya existentes. No confirma pagos desde el navegador.

Los RPC públicos son `SECURITY INVOKER`. Las funciones privilegiadas se encuentran
solo en `private`, con `search_path` vacío y permisos explícitos. Clientes y
`service_role` no tienen acceso directo a las nuevas tablas privadas. Las funciones
que escriben pagos se conceden únicamente al servidor.

## Servidor

`create-card-checkout` admite `postal_lookup`, `quote` y `create`. Valida la sesión
mediante `card_checkout_identity`; rechaza orígenes ajenos y cuerpos excesivos.
Las acciones de consulta no crean reservas ni sesiones Stripe. La configuración
postal debe ser independiente de `qw10_test` y mantener su digest y vigencia.

`stripe-card-orders` atiende únicamente notificaciones firmadas. El destino Stripe
debe suscribirse a `checkout.session.completed` y
`checkout.session.async_payment_succeeded`. Reembolsos, disputas y caducidades no
se proyectan automáticamente en este nuevo flujo. El servicio conserva respuestas
no satisfactorias ante errores de persistencia para permitir reintentos.

| Configuración | Función |
| --- | --- |
| `STRIPE_LIVE_RESTRICTED_KEY` | Clave restringida live; exclusivamente en secretos de Supabase. |
| `STRIPE_LIVE_ORDERS_SIGNING_SECRET` | Secreto del destino webhook live, nunca del sandbox. |
| `CARD_PAYMENTS_ENABLED=true` | Habilita creación de Checkout solo si además está habilitada la configuración privada. |
| `CARD_WEBHOOK_ENABLED=true` | Habilita recibos; es independiente para seguir recibiendo pagos ya iniciados al cerrar nuevas compras. |
| `private.card_checkout_configuration.enabled` | Segunda barrera; se crea en `false`. |

No guardar secretos en el repositorio. Una pausa operativa debe deshabilitar nuevas
compras y conservar el procesamiento de recibos ya iniciados. No borrar recibos,
pedidos, movimientos ni auditoría para revertir una activación.

## Verificación

- **52 pruebas de JavaScript**: 21 existentes, 16 del núcleo, 7 del endpoint y 6 del modelo de interfaz/retorno y 2 de retirada del verificador antiguo.
- **15 grupos de base de datos**: esquema operativo, RPC, firma SDK, aislamiento por
  propietario, permisos, reservas manuales, pagos repetidos/tardíos, límites de uso
  y datos del destinatario y reversión total ante fallos en partidas y después de varias salidas de stock.
- **6 pruebas concurrentes en PostgreSQL 17**: pago duplicado simultáneo, compradores
  por la última pieza, reserva manual frente a web en ambos sentidos, vencimiento
  durante espera y movimiento manual que compite con un pago.
- Ejecución de concurrencia aprobada y navegadores aprobada sobre `e1e4283`:
  https://github.com/RHOSeguridadIndustrial/rhoseguridad/actions/runs/42201409773

Las bases de validación son desechables y la API Stripe es sintética; las firmas
se comprueban con el SDK real. Estos resultados acreditan la lógica integrada y
concurrencia probadas, **no un cobro live**. No se usan credenciales ni datos reales
de clientes en las pruebas.

## Despliegue verificado

- Migración remota: `20261106100121_card_checkout_operational`. El nombre local se
  ajustó a la versión devuelta por Supabase para evitar una aplicación duplicada.
- `create-card-checkout`: versión **8**, ACTIVE; nueve archivos recuperados y
  comparados exactamente con el paquete probado.
- `stripe-card-orders`: versión **1**, ACTIVE; cinco archivos recuperados y
  comparados exactamente con el paquete probado.
- Configuración operativa: `enabled=false`; copia independiente del catálogo CDMX aportado por el propietario, con 1531 asentamientos, 1110 CP y 16 alcaldías. Digest comprobado: `a6bdd1ceb50d7b85ee8c4f851d3427f5d4513b7facdebc22b198f5c3bd24390c`. Se conserva su revisión del 25 de octubre y vencimiento del 24 de noviembre; no se afirma una nueva descarga oficial. El runtime no consulta `qw10_test`.
- HTTP de `create-card-checkout`: OPTIONS 204, GET 405 y POST 503
  `card_checkout_disabled`. El POST al nuevo webhook fue bloqueado por el proxy
  de salida del entorno (403 de túnel), antes de llegar a Supabase; no acredita
  una respuesta HTTP del webhook. Queda pendiente esa comprobación remota.
- Después del despliegue: **0 pedidos reales, 50 piezas, 35 registros históricos**;
  cero solicitudes, recibos y contextos nuevos. No se ejecutó un cobro live.
- Verificación de permisos: anónimos y clientes no pueden confirmar pagos; el
  servidor sí. Clientes no pueden leer recibos directamente y ni siquiera el rol
  de servicio puede insertar directamente autorizaciones de inventario.
- Asesor de seguridad: permanece la advertencia previa de contraseñas filtradas.
  Los cinco avisos nuevos de RLS sin políticas corresponden a tablas privadas,
  sin permisos directos y accesibles por funciones restringidas. No se añadieron
  políticas públicas para silenciarlos:
  https://supabase.com/docs/guides/database/database-linter?lint=0008_rls_enabled_no_policy

## Interfaz y destinatario

- `checkout-tarjeta.html` consulta colonias por CP, recoge destinatario/teléfono,
  muestra productos, envío y total del servidor y exige aceptación explícita antes
  de crear Checkout. El acceso desde el carrito continúa deshabilitado.
- La migración `20261106101832_card_checkout_contact` valida y congela destinatario
  y teléfono con el carrito. No modifica el perfil de la cuenta. La identidad de
  reintento incluye esos datos; cambiar el destinatario no reutiliza otro intento.
- Los intentos se conservan en sessionStorage por propietario e identidad, incluyendo
  domicilio, contacto y total congelado. Una recarga recupera el intento; un cambio
  de cuenta borra los datos visibles. Un fallo de almacenamiento impide crear el pago.
- `pago-exitoso.html` consulta únicamente `card_checkout_status`: pendiente,
  confirmado, vencido o pago recibido en revisión. No invoca la función antigua
  que escribía desde el retorno y no borra el carrito actual. Las respuestas tardías
  después de cerrar sesión no restauran información de la compra.
- Login y MFA conservan solo destinos de compra internos de una lista estricta.
- Chromium de escritorio y WebKit con viewport móvil aprobaron los flujos de
  cotización, aceptación, red interrumpida, recarga, cambio de destinatario/cuenta,
  enlaces ajenos, textos HTML, cierres operativos y estados de pago. Estas pruebas
  sintéticas no acreditan Safari nativo de un iPhone ni un pago real.

El verificador antiguo `verify-card-payment` queda retirado con HTTP 410, sin llamadas
a Stripe, lectura de secretos ni escrituras. Su ruta previa no exigía propietario y
podía modificar pedidos desde una consulta pública. La página de confirmación usa
exclusivamente el nuevo RPC autenticado. No existían pedidos operativos al retirarlo.

## Estado de activación — 7 de noviembre de 2026

1. Webhook live creado y consultado nuevamente en Stripe:
   `we_1UZGw62OiK9OVeQQuZWv9IAk`, cuenta `acct_1UGwvI2OiK9OVeQQ`,
   estado `enabled`, API `2026-08-26.dahlia`, URL
   `https://mtpqpxcmngrsivntbgcc.supabase.co/functions/v1/stripe-card-orders`.
   Suscrito a `checkout.session.completed` y
   `checkout.session.async_payment_succeeded`.
   Esto acredita el registro del destino, no una entrega exitosa ni un cobro real.
2. Se guardó `STRIPE_LIVE_ORDERS_SIGNING_SECRET` en los secretos de Edge
   Functions de Supabase el 7 de noviembre de 2026 a las 22:48 UTC. El panel
   confirmó la creación y mostró el registro en la lista. Corresponde al
   webhook live indicado arriba; no se creó un destino duplicado.
   Siguen pendientes `STRIPE_LIVE_RESTRICTED_KEY`, `CARD_PAYMENTS_ENABLED`
   y `CARD_WEBHOOK_ENABLED`. No se incluyen valores secretos en este documento.
3. Consulta operativa de solo lectura: `enabled=false`, cero solicitudes,
   cero recibos y cero pedidos operativos. El botón público y los cobros
   permanecen pendientes de activación. No se ejecutó ningún pago real.
4. El propietario autorizó crear la clave live restringida y guardarla en
   Supabase. En Stripe se revisó un único permiso: Checkout Sessions Write
   (incluye lectura), con nombre `RHO Checkout Produccion QW10`.
   La creación quedó bloqueada por la verificación de identidad por correo.
   Stripe mostró un error de verificación incluso al abrir el enlace en el
   navegador en la nube; el formulario permaneció en `Check your email`.
   No se emitió ni se guardó la clave. No se amplió su alcance ni se habilitaron
   cobros. No repetir reenvíos sin resolver primero esa verificación.
5. Después de conectar credenciales: comprobar el endpoint remoto, la entrega de
   notificaciones firmadas, el pago/pedido/inventario, la experiencia móvil y la
   entrega operativa antes de activar el botón público. Los casos remotos de
   reenvío y pago tardío del sandbox siguen pendientes según
   `STRIPE_INTEGRATION_TODO.md`.

## Respaldo y seguridad — verificación del 7 de noviembre de 2026

- Último respaldo del sitio localizado:
  https://github.com/RHOSeguridadIndustrial/rhoseguridad/actions/runs/42050791557
  — ejecución del **5 de noviembre de 2026**, resultado satisfactorio.
  Artefacto `13426078081`, `RHO-sitio-42050791557-1`, no vencido.
- Se descargó el ZIP y su SHA256 coincidió con el digest publicado por GitHub:
  `84f03b571376e5bd86414accf6e71031bf092f8e26b88c37f196497cf344d672`.
- Se verificaron `SHA256SUMS` y la integridad de ambos ZIP; se restauró
  `historial.bundle` en un directorio aislado. `git fsck --full` terminó
  sin errores de integridad. La cabecera restaurada fue
  `352631e332a3c9f4d26ab67427f652f301e44c73`.
- Los **405 archivos versionados restaurados** coinciden byte por byte con
  `sitio.zip`. No se restauró sobre producción ni se modificó la tienda.
  El respaldo refleja el 5 de noviembre: no incluye cambios posteriores.
- El workflow conserva archivos versionados e historial Git durante 90 días.
  **Excluye datos Supabase, Auth, Storage, secretos y configuración externa.**
  La restauración de este respaldo no acredita recuperación de la base de datos.
- La organización Supabase está en plan Free. La documentación vigente reserva
  los respaldos diarios administrados y la prevención de contraseñas filtradas
  para Pro o superior. No se contrató un plan ni un complemento de pago.
  Sigue pendiente implementar y comprobar el respaldo de la base de datos.
- En el panel de Auth se verificaron confirmación de correo activada,
  inicio de sesión anónimo desactivado y cambio de correo seguro activado.
  Cambio de contraseña con reautenticación, contraseña actual obligatoria y
  prevención de contraseñas filtradas aparecen desactivados. No se alteraron
  esos controles ni contraseñas; cualquier endurecimiento debe conservar el
  funcionamiento de registro y recuperación.
- La advertencia de contraseñas filtradas deshabilitadas indica una función
  inactiva, no evidencia de una filtración.

Referencias de configuración:
- https://supabase.com/docs/guides/platform/backups
- https://supabase.com/docs/guides/auth/password-security
