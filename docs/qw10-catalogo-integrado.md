# QW10 — catálogo recibido y checkout postal de prueba

Archivo aportado por el propietario: CPdescargatxt.zip. El encabezado del TXT
identifica a Correos de México. Fecha interna ZIP: 22/10/2026 00:16:40 (sin zona
horaria). No es una descarga verificada de manera independiente desde el servidor.

- ZIP SHA-256: 66958263bf3e2f996023dfd2469198a04752b41d693c116c5f6f305b2c6e7b5d
- TXT SHA-256: e418524da00e6e23ce544ad2f43d849698baa5673b3348bbf5cc84d6d8515c96
- 159382 registros nacionales, 32 entidades.
- CDMX: 1531 asentamientos, 1110 códigos postales, 16 alcaldías, cero claves duplicadas.
- Codificación: Windows-1252; ceros y acentos conservados.

El catálogo completo no se incorpora a GitHub ni al cliente web. Se prepara la
selección CDMX como texto verificado mediante SHA-256 en una tabla privada con RLS,
sin lectura directa para anon, authenticated ni service_role. El getter es exclusivo
del servicio; la función privada solo lee el catálogo habilitado. La API de prueba
requiere administrador con MFA y devuelve exclusivamente opciones de un CP.
La función nunca ofrece el catálogo completo al navegador.

El checkout conserva el modo rápido 02000 para compatibilidad y agrega selección
explícita de consulta postal. El administrador ingresa CP, elige alcaldía/colonia
y usa calle/número ficticios. La respuesta se invalida al cambiar CP o identidad;
los resultados tardíos no restauran datos. La referencia de reintento usa el hash
del carrito, método y domicilio, sin guardar el domicilio en sessionStorage.
Cambiar el domicilio cambia la clave; el servidor rechaza reusar la anterior con
otro domicilio. La cotización conserva su domicilio y procedencia en qw10_test.
Una coincidencia postal no confirma existencia física de calle/número ni entrega.

Verificación: 66 pruebas de módulo/endpoint/regresiones, permisos de base de datos
y navegación Chromium/WebKit aprobadas. La CI de la rama fue 40164030053.
PR 34 integrado en main como 62059af7981b602cbf852c2675582d924892cd65;
publicación Pages 40258107611 aprobada. Sobre ese commit también aprobaron
40258107703 (checkout postal), 40258107812 (domicilio), 40258107752
(recuperación de checkout) y 40258107665 (transferencias de prueba).

Migración 20261025050045 aplicada. Catálogo CDMX cargado únicamente en el servidor;
el hash almacenado coincide con el texto. Lectura de tabla/getter denegada a
clientes. SHA-256 del artefacto normalizado:
a6bdd1ceb50d7b85ee8c4f851d3427f5d4513b7facdebc22b198f5c3bd24390c.
Revisión: 2026-10-25T05:00:33.991Z; límite interno: 2026-11-24T05:00:33.991Z.
create-test-checkout versión 8 activo; autenticación de administrador y MFA
comprobadas por la función. Las etiquetas de domicilio y colonia tienen nombres
accesibles independientes de las opciones del selector.

## Prueba remota del formulario publicado

Validada el 25/10/2026 en hora de CDMX (26/10/2026 UTC), después de iniciar sesión
y verificar el autenticador en el navegador en la nube:

- Consulta de CP 02000: devolvió Azcapotzalco / Centro de Azcapotzalco.
- Domicilio ficticio: Calle Ficticia 123. El resumen mostró colonia, alcaldía y CP.
- Un N95: $24.70; envío estándar simulado: $99.00; total: $123.70 MXN.
- Preparar dos veces conservó una sola referencia de transferencia simulada.
- Base de datos: una sola solicitud para la misma clave de reintento; domicilio
  conservado en la cotización y en la identidad de la solicitud; livemode=false.
- Evidencia de procedencia: postal_match, postal_catalog_only y hashes de origen
  y catálogo guardados en la cotización.
- Órdenes reales: 0; suma de inventario real: 50 antes y después. Stock N95 de
  pruebas: 7 antes y después. No se confirmó ni despachó esta transferencia.

No se activan cobros, reservas operativas ni entregas reales.
create-card-checkout versión 6 mantiene CARD_PAYMENTS_ENABLED=false.
Este avance completa la consulta y conservación del domicilio postal en pruebas;
no cierra todo QW10. Siguen pendientes la validación física/operativa de entrega,
la confirmación bancaria real, el flujo de inventario y despacho de producción
y la aceptación en Safari nativo de iPhone. WebKit de CI no acredita esta última.
