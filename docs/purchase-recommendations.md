# Recomendaciones de recompra

Inicio y Mi cuenta muestran «Tus compras habituales». El motor estadístico ordena las compras del cliente por recurrencia, recencia y disponibilidad. Estima el intervalo con la mediana cuando existen al menos tres fechas de compra distintas. No usa IA generativa ni envía el historial a proveedores externos.

La función `get_my_purchase_history()` acepta cero parámetros. Su implementación privada verifica identidad, cuenta habilitada, correo confirmado, bloqueo y controles administrativos existentes. Vincula los pedidos heredados con el correo verificado de Auth, ya que `orders` todavía no tiene una columna de propietario UUID. No confía en correo ni identificadores enviados por el navegador. No amplía permisos de lectura sobre pedidos.

Solo usa `public.orders` con estado `paid`, excluye sesiones `cs_test_` y limita el historial a los últimos 200 pedidos dentro de 365 días. No toma cotizaciones, carritos, membresías pausadas ni operaciones del esquema de pruebas QW10. Para que una venta alimente el motor, su flujo existente debe registrarla como pagada en `public.orders` junto con sus `order_items` y correo del cliente. Las ventas externas todavía no registradas no aparecen.

Las variantes conservan `requested_item_id`; si falta o dejó de existir, se invita a consultar opciones sin sustituir talla o color. Precios e inventario salen de las tablas actuales. Antes de agregar una pieza al carrito se verifican sesión, precio, estado e inventario, incluyendo la cantidad ya en el carrito. Esto no reserva inventario ni activa el cobro.

Sin compras confirmadas se muestra un estado vacío honesto. Sin sesión se invita a entrar. Ante fallos se puede reintentar. El historial vive únicamente en memoria y se borra al cambiar de cuenta, salir o volver desde el caché de navegación.

Validación local:

```sh
node --test tests/recommendation-model.test.mjs
node tests/recommendation-database.mjs
node --check recommendations.js
```

La prueba de base usa fixtures sintéticos en PGlite; nunca crea compras en producción. La migración añade únicamente dos funciones de lectura. La integración depende de compras pagadas reales en la tabla indicada: no se fabrican recomendaciones a partir de productos vistos.
