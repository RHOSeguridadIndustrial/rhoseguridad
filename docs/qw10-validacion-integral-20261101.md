# QW10 — validación integral del 1 de noviembre de 2026

## Resultado

**Seis bloques de validación técnica aprobados. QW10 integral sigue abierto.**

- Código de la tienda tomado de main: `bc280107074d09666ed26b5e4fb04c670748fb32`.
- Commit de ejecución: `fc8301f035acceec151bcb9efdd5aca3fd35b3d9`.
- [Ejecución aprobada 41281839507](https://github.com/RHOSeguridadIndustrial/rhoseguridad/actions/runs/41281839507).
- [PR #50](https://github.com/RHOSeguridadIndustrial/rhoseguridad/pull/50).

El flujo `.github/workflows/qw10-integrated-acceptance.yml` reúne las pruebas
existentes sobre una misma versión. Se puede iniciar desde GitHub Actions con
**Run workflow**. No tiene programación recurrente. Usa fixtures sintéticos,
bases temporales aisladas y permisos de repositorio de solo lectura; no usa
credenciales de producción ni ejecuta cobros, reembolsos o despachos reales.

## Bloques aprobados

| Bloque | Evidencia principal |
| --- | --- |
| Pagos y reembolsos | 14 grupos de esquema/permisos, 6 de recibos firmados, 7 de reembolsos, 3 de concurrencia de reembolso y 10 de interfaz de revisión. |
| Inventario concurrente | 5 casos con espera real por bloqueo: pago repetido, competencia por una unidad, reservas especiales/web y vencimiento durante la espera. |
| Transferencias y preparación | 9 grupos de base, 4 casos concurrentes y recorridos de confirmación, preparación/salida, domicilio y seguridad administrativa en Chromium/WebKit. |
| Domicilio y recuperación | 66 pruebas de modelos; catálogo postal, recuperación de transferencia vencida y checkout en Chromium/WebKit. |
| Integridad | 3 pruebas de modelo, 7 grupos de base y pantalla administrativa con identidad sintética en Chromium/WebKit. |
| Tienda y regreso de autenticación | 170 pruebas de modelos aprobadas, cero fallidas y una omitida; portada de 18 artículos, carrusel ampliado y retorno tras autenticación. |

Los conteos de diferentes bloques se superponen; no deben sumarse como pruebas
únicas. La prueba omitida requiere `POSTAL_IMPORT_DIR`, el archivo nacional
privado de importación que no se incluye en el repositorio. Esta ejecución no
revalida íntegramente ese archivo fuente ni equivale a una importación nueva.

La portada pasó a 320, 390, 430, 768 y 1280 px, en Chromium y WebKit.
Los seis módulos móviles conservan el aumento del 20%, las 18 imágenes,
los enlaces y el desplazamiento hasta la bota al final.

En el primer intento del nuevo flujo dos pruebas de concurrencia compartían la
misma base temporal; la segunda rechazó correctamente que no estuviera vacía.
Se separaron en trabajos con contenedores independientes. La ejecución aprobada
incluye esa corrección de aislamiento, sin modificar lógica de producción.

## Comprobación remota de solo lectura

Supabase se consultó antes y después de la batería, el **01/11/2026 a las
00:39:02 y 00:43:51, Ciudad de México**.

| Control | Antes | Después |
| --- | ---: | ---: |
| Piezas de inventario operativo | 50 | 50 |
| Órdenes operativas | 0 | 0 |
| Stock de prueba N95 | 6 | 6 |
| Solicitudes de prueba | 19 | 19 |
| Recibos de prueba | 9 | 9 |
| Órdenes de prueba | 8 | 8 |
| Movimientos de prueba | 8 | 8 |

La excepción previamente reembolsada conserva cero órdenes y cero movimientos.
Hay un único identificador de reembolso, con dos avisos del mismo reembolso
exitoso de 123.70 MXN y `livemode=false`; no son dos reembolsos.
No se volvió a solicitar ni a ejecutar ese reembolso.

La función desplegada `create-card-checkout` conserva
`CARD_PAYMENTS_ENABLED = false`.
Las tablas consultadas de stock, recibos, órdenes, movimientos y reembolsos de
prueba, así como el catálogo postal nacional interno, mantienen RLS y carecen
de permiso SELECT directo para `anon` y `authenticated`.

## Seguridad pendiente

El asesor de Supabase conserva la advertencia de **protección de contraseñas
filtradas deshabilitada**. No se cambió la configuración de Auth:
[referencia de remediación](https://supabase.com/docs/guides/auth/password-security#password-strength-and-leaked-password-protection).

También informa 11 tablas con RLS habilitado sin políticas. Varias son tablas
privadas o accesibles exclusivamente por funciones restringidas; no se añadieron
políticas públicas para silenciar esos avisos. Para el catálogo postal interno
esa ausencia es intencional, según su documentación:
[referencia del aviso](https://supabase.com/docs/guides/database/database-linter?lint=0008_rls_enabled_no_policy).

## Criterios que siguen abiertos

1. **Aceptación funcional en Safari independiente del iPhone:** completar el
   recorrido de prueba y conservar evidencia del resultado. WebKit automatizado
   y capturas del navegador en la nube no sustituyen esta aceptación.
2. **Pedido persistente por transferencia y conciliación operativa:** el checkout
   actual termina en una solicitud por WhatsApp; no crea una orden persistente
   ni confirma abonos bancarios. Su sustitución y la evidencia bancaria siguen
   pendientes. Véase [checkout por transferencia](checkout-transferencia.md).
3. **Cobertura física, inventario y despacho operativos:** una coincidencia postal
   no valida la dirección físicamente ni compromete la entrega.
4. **Configuración pendiente de contraseñas filtradas** y verificación posterior.
5. **Siete días de estabilidad:** dos consultas y una batería de laboratorio
   no acreditan siete días de operación sin diferencias.

Esta fase actualiza la evidencia técnica y deja una ejecución repetible.
No certifica ventas reales ni declara concluidos todos los Quick Wins.
