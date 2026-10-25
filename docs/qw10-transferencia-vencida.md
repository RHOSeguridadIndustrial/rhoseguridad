# Recuperación de transferencia simulada vencida

Una referencia TEST que vence seguía en sessionStorage y cada clic reutilizaba la
misma clave. La reserva inmutable rechazaba correctamente el intento, pero la
pantalla no permitía iniciar otra transferencia con el mismo carrito.

`qw10_test_load_reservation` mantiene SECURITY INVOKER y permisos sólo de servicio.
Devuelve el código SQL PQT01 exclusivamente para una transferencia de prueba del
propietario, con ambos vencimientos cumplidos, reserva activa, método coincidente
en cotización e identidad, sin sesión Stripe, recibo, orden ni movimiento. No
actualiza la referencia histórica ni libera una reserva todavía vigente. Una
reserva desactivada, incompleta o de tarjeta sigue el rechazo genérico.

El adaptador convierte sólo ese código en HTTP 410 `test_transfer_expired`.
La interfaz ofrece «Iniciar nueva prueba de transferencia». Este botón verifica
la misma cuenta, carrito, método y clave antes de retirar la clave local vencida.
No crea un pedido: al pulsar después Preparar se recalculan precio, cupón y stock
y se genera una nueva referencia. Un error de red, 409, 410 desconocido o una
respuesta tardía no habilitan el cambio. No se borran registros ni se modifican
cobros, pedidos o existencias reales.

## Validación y despliegue

- `node --test tests/checkout-transfer-expiry.test.mjs tests/checkout-coupon.test.mjs tests/shipping-coupon.test.mjs`
- `node tests/checkout-transfer-expiry-database.mjs`
- `node tests/checkout-help-browser.cjs` (Chromium y WebKit móvil).

Aplicar primero `supabase/qw10-test-transfer-expiry.sql`, después desplegar
create-test-checkout con su nuevo auxiliar y publicar la interfaz. Registrar la
versión asignada por Supabase en migrations. La creación remota de esa migración
usa el conector; no se repite el CLI que anteriormente fue rechazado por su
telemetría. El esquema no cambia y no se añaden permisos. Para revertir, restaurar
la definición previa de qw10_test_load_reservation y el endpoint/interfaz del
commit 6c0305b87064ce6784f73af09b72c5ada3cd16d0. Se conservan todas las referencias.

## Cobertura pendiente

Se consultaron el catálogo de Correos de México y el portal de datos CDMX, pero
sus descargas/API devolvieron errores de acceso desde el entorno de trabajo.
No se incorporó un catálogo incompleto ni se dedujo la cobertura por rangos de CP.
La prueba conserva su CP ficticio 02000. La cobertura postal y la entregabilidad
del domicilio siguen pendientes, junto con conciliación y operación reales.

Fuentes revisadas:
- https://www.correosdemexico.gob.mx/SSLServicios/ConsultaCP/CodigoPostal_Exportar.aspx
- https://datos.cdmx.gob.mx/dataset/codigos-postales
- https://supabase.com/docs/guides/functions/auth-headers
- https://supabase.com/changelog/cbc-tls-ciphers-deprecated

La revisión del changelog identificó el retiro futuro de cifrados CBC antiguos.
Esta mejora conserva las versiones y autenticación existentes; no cambia TLS.
