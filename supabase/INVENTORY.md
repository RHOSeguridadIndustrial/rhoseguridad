# Administración de inventario

El panel está en `admin-inventario.html`. Usa la sesión y el rol `admin` existentes de `public.profiles`. También se enlaza desde el panel principal y Mi cuenta para administradores.

## Operación

- `inventory_items`: existencia física por SKU exacto, mínimo, unidad, estado, visibilidad y revisión.
- `inventory_import`: referencia original de compra, visible únicamente para administradores.
- `inventory_history`: historial de movimientos, sin permisos de edición ni eliminación para usuarios de la aplicación.
- `inventory_adjust`: entrada, salida, conteo, cambio de datos o regreso a pendiente con existencia cero. Bloquea la fila y exige la revisión leída para prevenir cambios perdidos.
- `inventory_create`: alta de una variante en cero, pendiente de recepción.

La importación inicial del Excel fue ejecutada mediante la conexión administrativa. Las cantidades propuestas no son existencias físicas. Las filas comienzan en cero y estado `pending`. No se publican los datos de compra en el repositorio.

Al recibir mercancía, registrar una entrada en su SKU y seleccionar la unidad de venta correspondiente. Para los chalecos, la propuesta no determina colores: agregar primero cada variante y registrar las entradas en ella. No duplicar cantidades entre el registro genérico y los colores. La mascarilla debe configurarse según se venda por pieza o por caja y el precio debe corresponder a esa unidad.

## Tienda

`inventory.js` consulta Supabase al abrir, recuperar el foco y cada 30 segundos mientras la página esté visible. No conserva cantidades antiguas si la consulta falla. Las variantes sin registro muestran «Consultar disponibilidad». Las compras pendientes muestran «Próximamente», sin promesa de entrega inmediata.

El flujo actual es de cotización. Agregar al carrito no reserva ni descuenta existencias. Las salidas de ventas se registran por el administrador. El pago con tarjeta permanece desactivado en el backend existente. Antes de activar pagos se requiere una reserva transaccional en servidor y confirmación de movimientos mediante eventos de pago verificados.

## Verificación aplicada

Se probaron en transacciones revertidas: entrada y salida administrativa, auditoría con usuario, rechazo de revisión obsoleta, rechazo de salida superior a existencias, bloqueo de escritura/RPC para clientes y visitantes y protección del historial. Se verificó la lectura pública de disponibilidad sin otorgar acceso a perfiles de clientes. Ningún movimiento de prueba quedó guardado.
