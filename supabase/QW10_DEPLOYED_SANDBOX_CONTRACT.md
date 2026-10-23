# QW10 — contrato capturado del sandbox desplegado

23 octubre 2026. Pruebas aisladas, sin migraciones ni escrituras remotas.

## Fuente y alcance

El conector oficial Supabase capturó metadatos de nueve tablas, restricciones, índices, permisos y once funciones del proyecto `mtpqpxcmngrsivntbgcc`. Archivo `tests/fixtures/qw10-deployed-schema-20261023.json`, SHA256 `714c778c60e3daa007b8de2cee47d7bcdca452536e82d62d8d48d271b31d6c43`. No contiene filas operativas, usuarios, contraseñas ni tokens.

Las funciones se ejecutan sin modificar sus cuerpos. Las tres piezas compartidas de `stripe-test-orders` v2 fueron cotejadas nuevamente con el despliegue activo; solo difiere una línea vacía final en las copias. Hash del paquete remoto: `1dd7e9165cb8d233c001ecff371c2e982e5775b8a442aeec05ba819e68f50b44`.

El adaptador de prueba llama los RPC `qw10_test_load_request` y `qw10_test_commit_payment` con los mismos argumentos y rol de servicio. Firma/cuerpo se verifican con Stripe SDK 22.6.0; las respuestas de Checkout y claves son sintéticas. No se hizo una llamada real a Stripe ni se certifica aquí su entrega HTTP remota, configuración de secretos, JWT o MFA.

## Ejecución

`node tests/deployed-sandbox-contract.mjs` aprobó nueve grupos: permisos de acceso; reservas compartidas e identidad/reintentos inmutables; propietario/sesión/firma/estado de pago; pago atómico e idempotencia; preparación/salida simuladas con propietario y orden previa; pago tardío en conciliación; conflicto de reserva en carrito con varias líneas sin descuento parcial; vencimiento de reserva especial active=true; fallo inducido en movimiento con reversión completa y recuperación posterior.

Una tabla centinela local `public.inventory_items` conserva 50 piezas durante toda la suite. Esto complementa el control remoto; no representa una copia del inventario real.

`tests/deployed-sandbox-concurrent.py` requiere PostgreSQL local desechable y rechaza conexiones fuera de loopback. Usa una base nueva y un alias privado `snapshot_service_role` con los permisos efectivos capturados (BYPASSRLS, como el servicio desplegado), sin alterar los roles de otras suites. Seis casos requieren observar una espera real por bloqueo: reintentos de la misma solicitud, dos reservas web por la última unidad, web antes de especial, especial antes de web, dos confirmaciones de pago, y vencimiento durante espera por stock.

CI aprobada: https://github.com/RHOSeguridadIndustrial/rhoseguridad/actions/runs/40017710730 . Commit `be4009a774a7d7a521ba584779332ce15bc3341b`, job `120633955105`, resultado `success`. Los nueve grupos nuevos y seis casos concurrentes aprobaron junto a las suites anteriores. Los errores de stock y revisión mostrados en el log del contenedor son rechazos esperados que las pruebas comprobaron.

## Entrega efectiva en Stripe sandbox

El conector Stripe confirmó la cuenta `acct_1UGwvSRpe0k2YzxP` con `livemode=false`. El endpoint `we_1UR03RRpe0k2YzxPZ07v9GNV` está habilitado para `checkout.session.completed` y `checkout.session.async_payment_succeeded`, apuntando a `stripe-test-orders` del proyecto indicado. El endpoint de diagnóstico permanece separado.

`GetEvents`, filtrado por `type=checkout.session.completed` y `delivery_success=true`, devolvió el evento `evt_1UTWc1Rpe0k2YzxPv5q9jOL8` con `livemode=false`, `pending_webhooks=0`, `payment_status=paid`, importe `29900` centavos y solicitud `84447b66-0e44-49f2-b3e5-41d3ebef0eb2`. Sesión, PaymentIntent, importe y evento coinciden con el recibo de la orden de prueba #5 en Supabase.

El log oficial de Supabase para `stripe-test-orders` registra POST HTTP 200 a las 18:45:38 CDMX del 22 octubre 2026 (23 octubre 00:45:38 UTC); coincide con el registro del recibo a las 00:45:38.764971 UTC. La unión de evento entregado, receptor 200 y recibo coincidente valida la entrega de este caso existente. No se reenviaron eventos, iniciaron pagos ni crearon órdenes en esta comprobación. Fallo y reintento inducidos se probaron en laboratorio, no en el endpoint remoto.

## Control remoto y límites

Consulta de solo lectura del 23 octubre 2026, 14:07:38 CDMX: `sum(public.inventory_items.quantity)=50`; `count(qw10_test.purchase_orders)=5`. No se crearon esas órdenes en esta ejecución.

Control final a las 14:16:37 CDMX: inventario real 50; órdenes de prueba 5; recibos de prueba pagados 5; recibos en conciliación 0; órdenes con vínculos inconsistentes 0; movimientos inconsistentes 0; líneas pagadas sin movimiento 0; conciliaciones con orden 0.

El asesor de seguridad reportó 16 avisos informativos de RLS sin políticas en tablas privadas/de prueba que no se ofrecen a clientes, y una advertencia de protección de contraseñas filtradas deshabilitada. No se cambiaron políticas, credenciales ni configuración Auth. La advertencia permanece abierta; el informe no equivale a auditoría de seguridad total.

Esto sustituye la incertidumbre sobre compatibilidad del modelo sintético con los RPC actuales para los casos probados y valida una entrega efectiva del webhook sandbox. Aún falta completar la operación de conciliación, aceptación móvil y cierre documental. No autoriza producción ni consumo del inventario real. El rol de servicio del despliegue tiene más alcance que el ejecutor mínimo del laboratorio anterior; no se declara resuelta esa diferencia.
