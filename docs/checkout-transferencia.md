# Solicitud de compra por transferencia

El carrito ofrecía transferencia como estimación pero no permitía continuar.
Ahora enlaza a `checkout-transferencia.html` para revisar contacto, domicilio,
artículos y un resumen antes de compartir una solicitud por WhatsApp con RHO.

## Operación

1. El cliente elige Continuar con transferencia y completa contacto y entrega.
2. Revisar mi solicitud vuelve a consultar precios activos MXN y existencias.
3. El cliente revisa el resumen y envía el mensaje en WhatsApp a RHO.
4. RHO confirma existencias, cobertura, envío, total, referencia y datos bancarios.
5. El pago permanece pendiente hasta que RHO confirma la recepción del dinero.

Este flujo es una solicitud con atención manual: no registra automáticamente un
pedido, no reserva inventario, no concilia abonos ni activa cobros en línea.
Los datos de contacto y domicilio permanecen en memoria de la página hasta que
el cliente decide compartirlos por WhatsApp. No se guardan en localStorage,
sessionStorage ni en nuevas tablas. Cerrar o cambiar de sesión limpia el formulario.

Los faltantes y el stock desconocido se derivan a Suministro especializado.
La política existente de envío se reutiliza sin cambiar sus umbrales; el resultado
es una estimación. Los destinos fuera de CDMX y los beneficios sin registro
reconocido conservan envío y total por confirmar. Los datos bancarios de Inbursa proporcionados por Rafael el 31/10/2026
se muestran con botones de copia. Se indica utilizar únicamente el importe y la
referencia confirmados por RHO; el resumen permanece como estimación.

## Validación

- 19 pruebas del modelo de cotización y solicitud aprobadas.
- UI móvil a 390 px: revisión del resumen y enlace de WhatsApp con datos ficticios;
  edición de domicilio invalida el enlace anterior; sin desbordamiento horizontal.
- Stock agotado, fallo de consulta y cierre de sesión comprobados en vista previa.
- Catálogo real consultado desde vista previa sin modificaciones de pedidos ni stock.
- No se enviaron mensajes ni se transfirió dinero.

La conciliación bancaria automática y un checkout que cree órdenes persistentes
siguen fuera de este cambio. La aceptación en Safari nativo sigue pendiente.

## Autocompletado nacional de domicilio (31/10/2026)

Al completar los cinco dígitos del CP se consulta `postal-lookup` en Supabase.
Devuelve únicamente las colonias del CP solicitado, sus municipios y estados.
Una sola colonia completa los campos; varias requieren selección explícita.
Cambiar CP limpia estado, municipio y colonia, invalida la solicitud anterior y
descarta respuestas tardías. La captura manual funciona ante CP ausente o fallo.
CDMX conserva además el respaldo local anterior en `assets/postal-cdmx.json`.

Fuente nacional: Correos de México / SEPOMEX, descarga TXT del 31/10/2026,
actualizada por la fuente el 30/10/2026. Contiene 31,866 CP, 159,437 asentamientos
y 32 estados. SHA-256 del TXT: `af2304baeef7fc14f828832ac84d3696f4dedd27015be87f8cf7631df54ca35d`.
Fuente: https://www.correosdemexico.gob.mx/SSLServicios/ConsultaCP/CodigoPostal_Exportar.aspx

El catálogo nacional completo permanece en la tabla interna
`public.checkout_postal_catalog`, en 96 segmentos comprimidos por prefijo.
RLS está habilitado; `anon` y `authenticated` no tienen permisos sobre la tabla.
La función valida la clave publicable de la aplicación y el CP antes de consultar
con una clave de servidor obtenida del entorno. Solo responde a un CP exacto;
no acepta búsquedas generales, datos de contacto ni domicilios completos.
El aviso informativo de Supabase «RLS Enabled No Policy» para esta tabla es
intencional: no se conceden políticas de lectura al cliente.

`supabase/sql/checkout-postal-catalog.sql` reproduce el esquema.
`scripts/prepare-postal-import.py` prepara los lotes de importación desde el ZIP
oficial; ejecutar con directorio de salida fuera del repositorio público.
No se publica el TXT nacional ni los lotes de datos en GitHub Pages.
La función se despliega con verificación de clave en el handler (`verify_jwt=false`)
para permitir el checkout de visitantes y las claves publicables actuales.
La fuente se actualiza mediante una nueva descarga e importación, no automáticamente.

19 pruebas aprobadas, incluida validación de todos los CP importados y rechazo
de consultas inválidas. Pruebas de UI móvil: 02140, 44100, 72000, selección de
colonia, resumen nacional, limpieza de datos y captura manual ante fallo.
Sin desbordamiento horizontal a 375 px de contenido. No se enviaron mensajes,
crearon pedidos ni modificaron existencias durante las verificaciones.

Autocompletar no valida calle, número ni cobertura logística. Fuera de CDMX,
la cobertura, el envío y el total siguen sujetos a confirmación de RHO.
