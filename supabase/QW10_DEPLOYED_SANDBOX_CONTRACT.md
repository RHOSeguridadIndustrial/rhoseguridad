# QW10 — contrato capturado del sandbox desplegado

23 octubre 2026. Pruebas aisladas, sin migraciones ni escrituras remotas.

## Fuente y alcance

El conector oficial Supabase capturó metadatos de nueve tablas, restricciones, índices, permisos y once funciones del proyecto `mtpqpxcmngrsivntbgcc`. Archivo `tests/fixtures/qw10-deployed-schema-20261023.json`, SHA256 `714c778c60e3daa007b8de2cee47d7bcdca452536e82d62d8d48d271b31d6c43`. No contiene filas operativas, usuarios, contraseñas ni tokens.

Las funciones se ejecutan sin modificar sus cuerpos. Las tres piezas compartidas de `stripe-test-orders` v2 fueron cotejadas nuevamente con el despliegue activo; solo difiere una línea vacía final en las copias. Hash del paquete remoto: `1dd7e9165cb8d233c001ecff371c2e982e5775b8a442aeec05ba819e68f50b44`.

El adaptador de prueba llama los RPC `qw10_test_load_request` y `qw10_test_commit_payment` con los mismos argumentos y rol de servicio. Firma/cuerpo se verifican con Stripe SDK 22.6.0; las respuestas de Checkout y claves son sintéticas. No se hizo una llamada real a Stripe ni se certifica aquí su entrega HTTP remota, configuración de secretos, JWT o MFA.

## Ejecución

`node tests/deployed-sandbox-contract.mjs` aprobó nueve grupos: permisos de acceso; reservas compartidas e identidad/reintentos inmutables; propietario/sesión/firma/estado de pago; pago atómico e idempotencia; preparación/salida simuladas con propietario y orden previa; pago tardío en conciliación; conflicto de reserva en carrito con varias líneas sin descuento parcial; vencimiento de reserva especial active=true; fallo inducido en movimiento con reversión completa y recuperación posterior.

Una tabla centinela local `public.inventory_items` conserva 50 piezas durante toda la suite. Esto complementa el control remoto; no representa una copia del inventario real.

`tests/deployed-sandbox-concurrent.py` requiere PostgreSQL local desechable y rechaza conexiones fuera de loopback. Usa una base nueva y un alias privado `snapshot_service_role` con los permisos efectivos capturados (BYPASSRLS, como el servicio desplegado), sin alterar los roles de otras suites. Seis casos requieren observar una espera real por bloqueo: reintentos de la misma solicitud, dos reservas web por la última unidad, web antes de especial, especial antes de web, dos confirmaciones de pago, y vencimiento durante espera por stock. Resultado CI pendiente de ejecución al redactar este documento.

## Control remoto y límites

Consulta de solo lectura del 23 octubre 2026, 14:07:38 CDMX: `sum(public.inventory_items.quantity)=50`; `count(qw10_test.purchase_orders)=5`. No se crearon esas órdenes en esta ejecución.

El asesor de seguridad reportó 16 avisos informativos de RLS sin políticas en tablas privadas/de prueba que no se ofrecen a clientes, y una advertencia de protección de contraseñas filtradas deshabilitada. No se cambiaron políticas, credenciales ni configuración Auth. La advertencia permanece abierta; el informe no equivale a auditoría de seguridad total.

Esto sustituye la incertidumbre sobre compatibilidad del modelo sintético con los RPC actuales para los casos probados. Aún falta validar la entrega efectiva del webhook sandbox y completar la operación de conciliación, aceptación móvil y cierre documental. No autoriza producción ni consumo del inventario real. El rol de servicio del despliegue tiene más alcance que el ejecutor mínimo del laboratorio anterior; no se declara resuelta esa diferencia.
