# QW10 — conexión operativa de cobros con tarjeta

6 de noviembre de 2026. **Conexión implementada; activación pública pendiente.**

## Implementación

El nuevo flujo utiliza `public.orders`, `public.order_items` y `public.inventory_items`.
La migración `20261106094135_card_checkout_operational.sql` añade registros privados
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

- **44 pruebas de JavaScript**: 21 existentes, 16 del núcleo y 7 del endpoint.
- **14 grupos de base de datos**: esquema operativo, RPC, firma SDK, aislamiento por
  propietario, permisos, reservas manuales, pagos repetidos/tardíos, límites de uso
  y reversión total ante fallos en partidas y después de varias salidas de stock.
- **6 pruebas concurrentes en PostgreSQL 17**: pago duplicado simultáneo, compradores
  por la última pieza, reserva manual frente a web en ambos sentidos, vencimiento
  durante espera y movimiento manual que compite con un pago.
- Ejecución de concurrencia aprobada sobre `1091f36`:
  https://github.com/RHOSeguridadIndustrial/rhoseguridad/actions/runs/42198185369

Las bases de validación son desechables y la API Stripe es sintética; las firmas
se comprueban con el SDK real. Estos resultados acreditan la lógica integrada y
concurrencia probadas, **no un cobro live**. No se usan credenciales ni datos reales
de clientes en las pruebas.

## Pendientes de activación

1. Confirmar despliegue de la migración y de ambas funciones con las barreras apagadas.
2. Conectar el checkout público, recoger y verificar datos de contacto para entrega,
   mostrar el total antes de aceptar y conservar el reintento al regresar.
3. Sustituir la consulta antigua de `pago-exitoso.html` por el estado de solo lectura
   del propietario, con tratamiento de pago pendiente/en revisión y retorno de login.
4. Configurar y verificar catálogo/cobertura operativos, claves restringidas y
   destino webhook live. El 6 de noviembre, antes de este despliegue, la cuenta
   activa devolvió cero destinos webhook; la presencia de secretos no se presume.
5. Completar validación remota y aceptación móvil antes de activar el botón público.
   La coincidencia postal por sí sola no acredita servicio físico de entrega.

La advertencia previa de contraseñas filtradas deshabilitadas en Supabase permanece:
https://supabase.com/docs/guides/auth/password-security#password-strength-and-leaked-password-protection
