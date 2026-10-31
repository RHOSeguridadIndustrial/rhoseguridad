# Versión 10.4 — Cambio 4

31 de octubre de 2026. Mejor distribución de información de todos los artículos de RHO.

Los 22 artículos de las 10 categorías usan tarjetas con fotografía a la izquierda y nombre, precio, IVA, unidad, existencias, características y compra a la derecha. Se compactan márgenes y tipografía conservando los nombres completos, el contenido técnico y los selectores de talla/color.

Se retira el recuadro permanente de pedidos especiales del catálogo, búsqueda y carrito. Al agregar unidades o aumentar la cantidad del carrito por encima de las existencias del SKU elegido, aparece un aviso centrado durante 3 segundos. Un nuevo intento reinicia el plazo. Reducir cantidades no dispara el aviso. Si el inventario no está confirmado se muestra un mensaje distinto, sin afirmar que hay cero piezas.

El carrito conserva su funcionamiento de solicitud de cotización: agregar unidades no reserva inventario y las unidades adicionales se cotizan como pedido especial. No se modifican precios, cantidades físicas, pedidos ni cobros.

Validación: sintaxis de JavaScript; pruebas de disponibilidad y del umbral del aviso; revisión en navegador de las diez categorías a 320, 390 y 1100 px, variantes y aviso temporal.
