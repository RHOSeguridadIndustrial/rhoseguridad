# Portada con módulos del catálogo RHO

31 de octubre de 2026.

Implementa el cambio 3 (versión 10.3) pendiente: retirar el módulo de recomendaciones de Inicio y Mi cuenta, junto con sus recursos cliente. No elimina historial de compras ni tablas.

Adapta las referencias de tarjetas y carrusel del usuario a la portada: diez accesos por categoría, tres módulos en cuadrícula 2×2, doce artículos del catálogo y accesos a suministro especializado y señalización. En móvil se muestra parte del siguiente módulo, se puede deslizar y usar botones anterior/siguiente. En escritorio se muestran los tres módulos.

Los nombres y fotografías se obtienen de search-catalog.js. Los enlaces abren la búsqueda del producto en el catálogo existente para consultar precios, inventario, variantes y agregar al carrito. No se inventan descuentos, clasificaciones de ventas, paquetes ni recomendaciones personales. No se añade un segundo flujo de compra.

Se conservan el aviso de pago con tarjeta, los banners enlazados a Productos, las tarjetas compactas de las categorías, la cotización empresarial y el checkout existentes. version.json permanece en 10.6, que ya había sido registrado por otro proyecto; no se reutiliza 10.4 para esta mejora de portada.

Validación: sintaxis y diff; prueba de las imágenes, enlaces, navegación de módulos, ausencia de recomendaciones y ancho de página en Chromium y WebKit a 320, 390, 768 y 1280 px.
