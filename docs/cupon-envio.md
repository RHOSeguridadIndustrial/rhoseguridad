# Cupón de envío RHO

El carrito muestra una estimación para CDMX: menos de $299, envío estándar de $99;
registro reconocido y pago previsto con tarjeta o transferencia: estándar gratis
entre $299 y $1,200 inclusive, express gratis por encima de $1,200. Los importes
incluyen IVA. No se inventa una tarifa para clientes sin registro desde $299.

`shipping-coupon.js` contiene la decisión sin efectos secundarios. El panel
`cart-coupon.js` verifica el usuario con Auth y recalcula ante cambios del carrito,
precios y sesión. No solicita iniciar sesión repetidamente si la cuenta sigue
reconocida; sin identidad verificable deja el beneficio pendiente. La selección
de pago es una estimación, no una solicitud ni una confirmación de pago.

## Pendiente para aplicar al pedido real

El servicio desplegado `create-card-checkout` tiene CARD_PAYMENTS_ENABLED=false.
El flujo público de compra continúa pendiente (`purchase-channel.js`). No se
habilitaron cobros con este cambio. La política conserva el aviso de próxima
aplicación automática al pedido.

Antes de activar: validar identidad y registro en servidor, resolver dirección y
CP del cliente (no asumir CDMX sólo por cinco dígitos), validar inventario y precios,
recalcular el cupón en servidor y persistir subtotal, envío, modalidad, total y
versión de política en el pedido. Integrar tanto la creación de pago con tarjeta
como la referencia de transferencia, sin confiar en importes del navegador.
Confirmar el pago mediante el proveedor o conciliación bancaria antes de preparar
la entrega, con idempotencia para no duplicar pedidos o recolecciones. Pedidos
especiales requieren cotización independiente. No estimar un ahorro nominal de
$99 para órdenes mayores a $299: esa tarifa no está publicada para ese segmento.

## Validación

- `node --test tests/shipping-coupon.test.mjs`
- `node tests/cart-coupon-browser.cjs` (Playwright y Chromium instalados)

## Integración al pedido de prueba — 22 de octubre de 2026

`create-test-checkout` verifica MFA administrativo, usuario Auth no anónimo y
perfil no desactivado. El precio se consulta en servidor. La cotización guardada
incluye medio de pago, modalidad, subtotal, envío, total y versión del cupón.
No se aceptan precios, registro ni cupón enviados por el navegador.

Tarjeta conserva el flujo Stripe de pruebas. Transferencia devuelve una referencia
TEST y estado awaiting_test_transfer, sin cuenta bancaria, cobro, confirmación de
pago ni entrega. Ambos caminos reutilizan la reserva inmutable existente; cambiar
el método con la misma clave se rechaza. Las reservas usan sólo stock de prueba.
El CP 02000 sigue siendo una dirección ficticia; no es la cobertura real.

La página checkout-prueba.html permite seleccionar ambos caminos. La activación
real sigue pendiente del validador de domicilio, conciliación de transferencias y
finalización del flujo de producción. No debe retirarse todavía el aviso público
de próxima aplicación del cupón al pedido.

Pruebas: `node --test tests/checkout-coupon.test.mjs tests/shipping-coupon.test.mjs`.
