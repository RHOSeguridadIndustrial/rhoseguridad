# QW10 — validación de domicilio y catálogo postal

Estado: módulo de servidor implementado y probado; integración operativa pendiente.
No se activó un catálogo ni se cambió el checkout publicado. La prueba de compra
con CP fijo 02000 sigue siendo una simulación, no un domicilio validado.

## Problema y comportamiento

Un código de cinco cifras o un prefijo de CDMX no prueba que exista una combinación
válida de CP, alcaldía y colonia. `delivery-address.js` consulta una combinación
exacta de código postal (cinco caracteres), municipio (tres) y asentamiento
(cuatro), conservando ceros iniciales. Los nombres proceden del catálogo del
servidor. Se exigen país MX, entidad CMX, calle y número exterior; interior y
referencias son opcionales y acotados. Rechaza campos desconocidos, marcas de
cobertura suministradas por el cliente, HTML, controles y texto bidireccional oculto.

`createDeliveryQuote` valida antes de consultar precios, conserva una copia de la
solicitud y vuelve a comprobar la vigencia al finalizar. Usa el cálculo existente
de artículos, envío y cupón; devuelve el domicilio normalizado y la procedencia
junto a la cotización. No reserva inventario ni inicia cobros o entregas.

Resultados:
- `invalid_address`: campos incompletos o formato inválido.
- `outside_coverage`: combinación ausente del catálogo habilitado; no afirma que
  el domicilio sea inexistente ni identifica por rangos otra entidad.
- `coverage_unavailable`: catálogo ausente, no revisado, alterado o vencido.
- `postal_match`: coincidencia postal, con `assurance: postal_catalog_only`.
  No certifica que la calle/número exista, que alguien reciba o que un transportista
  pueda entregar. Esa validación operativa sigue pendiente.

## Procedencia y activación

El módulo exige SHA-256 del archivo configurado por el servidor. El documento
incluye hash del archivo fuente, URL oficial HTTPS de Correos de México, fecha de
revisión y fecha límite. El plazo máximo admitido es 90 días como control interno
de RHO, no como una regla de Correos. También exige las 16 alcaldías y rechaza
claves duplicadas o nombres de municipio contradictorios. Estos controles detectan
errores; no demuestran por sí solos que se descargó todo el catálogo.

El importador `scripts/prepare-delivery-catalog.mjs` recibe el TXT oficial, reconoce
columnas SEPOMEX por nombre, filtra c_estado=09 y conserva ceros, nombres y hash.
Admite UTF-8 y Windows-1252. Rechaza filas truncadas y claves duplicadas. Escribe con
modo exclusivo para no sobrescribir un archivo existente. Su salida tiene siempre
`purpose: candidate`: el validador de entrega la rechaza. No descarga ni activa nada.

Antes de configurar `purpose: delivery` y fijar su nuevo hash deben revisarse la
fuente, fecha, conteo total, duplicados y cobertura de alcaldías. El catálogo debe
quedar en configuración del servidor; nunca se acepta desde el cuerpo del checkout.
No hay archivos de catálogo ni hashes operativos habilitados en este cambio. Los
registros de tests son ficticios y permanecen exclusivamente en la suite de pruebas.

Ejemplo de preparación (fechas y archivo deben corresponder a la descarga revisada):

```sh
node scripts/prepare-delivery-catalog.mjs archivo-oficial.txt candidato.json URL_OFICIAL FECHA_REVISION FECHA_LIMITE
```

## Verificación y límites

61 pruebas locales aprobadas: normalización, coincidencia exacta, ausencia y
alteración de catálogo, vencimiento antes/durante cotización, fuente ajena,
archivo incompleto/duplicado, importe del servidor y regresiones de cupones,
resumen y transferencias vencidas. Sin dependencias nuevas, cambios de tablas,
permisos, pagos ni inventario. CI reproduce esa suite.

El 24/10/2026 (CDMX) se volvió a consultar la fuente oficial del catálogo ADIP:
https://datos.cdmx.gob.mx/dataset/codigos-postales-de-la-cdmx
Recurso CSV:
https://datos.cdmx.gob.mx/dataset/codigos-postales-de-la-cdmx/resource/cf7285b4-6af0-4396-aaf0-08f3692ff6f8
El buscador encontró la ficha, pero las lecturas de la ficha/recurso agotaron tiempo.
No se reconstruyeron códigos a partir de fragmentos del buscador ni se sustituyeron
por rangos. Fuente oficial prevista para el importador TXT:
https://www.correosdemexico.gob.mx/SSLServicios/ConsultaCP/CodigoPostal_Exportar.aspx
El importador aún requiere validación con un archivo oficial completo descargado.

Para cerrar este apartado faltan: obtener/revisar el catálogo completo, conectar la
captura de domicilio y este validador en el servidor, congelar la cotización con la
reserva y comprobar un domicilio/servicio de entrega verificable. QW10 sigue abierto;
se mantienen además pendientes confirmación bancaria real, operación real y Safari
nativo. No se modificó CARD_PAYMENTS_ENABLED.

## Integración verificada

PR #33 integrada en main `d1d23c130c73165c19882651810e2e8ed16dccad`.
CI de rama 40163053828 y main 40163078359: 61 pruebas aprobadas.
GitHub Pages 40163078414 finalizó correctamente. Esto publica el código del
repositorio; no conecta el nuevo módulo al checkout ni habilita cobertura real.
