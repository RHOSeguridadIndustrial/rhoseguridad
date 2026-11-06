# Cola de recolección — laboratorio del 24 de octubre de 2026

Se implementó `logistics/pickup-store.mjs` y el esquema SQL de laboratorio
`logistics/sql/pickup-queue-draft.sql`. No están desplegados ni programados.

## Productor de solicitudes

`syncPaidOrders()` lee pedidos, solicitudes y recibos de `qw10_test`. Solo acepta
entorno de prueba, estado `paid`, coincidencia de solicitud/sesión e importe.
Cada pedido entra en `waiting_preparation`; no se inventan medidas ni domicilios.
Una transferencia debe haber pasado por la confirmación autorizada de QW10 y
tener el mismo recibo canónico. Un comprobante enviado por el cliente no basta.

El sondeo puede repetirse: la restricción única por entorno/pedido impide crear
otra solicitud, incluso con otra revisión. En esta primera versión, modificar
una revisión requiere intervención; no se admiten múltiples paquetes por pedido.
No se usa un cursor que pueda saltarse pagos confirmados fuera de orden.

## Procesamiento y recuperación

El consumidor llama `applyEvent()` desde el servidor autenticado. Bloquea la fila
con `FOR UPDATE`, verifica identidad, registra el evento y actualiza el estado
en una sola transacción. Un evento repetido devuelve `repeated:true`; un evento
con igual identificador y contenido diferente falla. La preparación conserva
domicilio, ruta y medidas en la base privada.

Antes de una futura llamada al transportista, el consumidor debe comprobar que
la transición a `booking_pending` o `pickup_pending` se confirmó y devolvió
`repeated:false`. Nunca debe enviar si `repeated:true`. Si pierde la respuesta
del commit, consulta el estado: un estado pendiente se reconcilia con el proveedor,
no se reenvía. Las claves externas permanecen guardadas después de reiniciar.

`withTransaction(fn)` es una dependencia obligatoria: debe tomar una conexión
exclusiva del pool, abrir BEGIN, ejecutar fn con query(sql,params), hacer COMMIT
o ROLLBACK ante error, y liberar la conexión. No se pueden hacer estas consultas
como peticiones REST independientes ni compartir la conexión entre trabajadores.
`postgres-transaction.mjs` implementa ese contrato para un pool compatible con node-postgres, con tiempos límite y sin reintentar commits inciertos. Falta proporcionar el pool y configurar el programador de ejecución.

## Acceso y límites

El esquema privado activa RLS y no otorga permisos de cliente ni de servicio.
`pickup-worker-role-draft.sql` define un rol NOLOGIN sin BYPASSRLS y políticas explícitas de laboratorio; permite leer fuentes QW10 y actualizar estado, sin modificar pagos ni borrar trabajos. Antes de desplegar falta provisionar la conexión del trabajador sin exponer credenciales al navegador. El módulo rechaza
`environment:'live'`. No se modificaron la base remota, inventario ni pagos.

Faltan: pool y credenciales de servidor, despliegue de esquema/rol, disparo periódico, endpoint de preparación con sesión/MFA vigente, revalidación de pago/cancelación/tarifas antes de contratar,
conectores de transporte, horario, medidas reales y presupuesto aprobado.
Los datos fuente de las pruebas son sintéticos y reproducen solo las columnas
consultadas del contrato QW10; no equivalen a aceptación en el sandbox desplegado.

## Pruebas reproducibles

Desde la raíz del repositorio, instalar las dependencias bloqueadas de tests:

```sh
npm ci --prefix tests
node --test tests/logistics-selection.test.mjs tests/pickup-workflow.test.mjs tests/pickup-store.test.mjs tests/pickup-worker.test.mjs
```

Resultado: 31 pruebas aprobadas (incluido el contenedor de ocho subpruebas SQL).
PGlite 0.3.14 ejecutó PostgreSQL con datos en un directorio temporal, cierre y
reapertura reales. Se probaron filtros de pago, reintentos, cambios de contenido,
reversión transaccional ante fallo, recuperación de guía y denegación de acceso.
No se certifica concurrencia multiconexión: falta verificar las esperas por bloqueo
en PostgreSQL con dos trabajadores antes de desplegar.

## Ejecutor y preparación

`pickupWorker({store,enabled:true}).runOnce()` ingiere lotes acotados de pagos.
Por defecto está deshabilitado. Evita solapamientos en la misma instancia, libera
el estado ocupado ante fallos y acepta AbortSignal entre lotes. La unicidad y los
bloqueos de base de datos son los controles entre distintas instancias. Aún falta
la prueba de concurrencia con conexiones independientes.

`recordPreparation()` comprueba pago, importe, propietario, evento de preparación
y ausencia de despacho en QW10 antes de avanzar. `applyEvent()` ya no permite
inyectar directamente `package_prepared`. El endpoint futuro debe autenticar al
administrador con MFA y construir domicilio/ruta desde fuentes verificadas;
este método de servidor no es un endpoint público ni valida por sí mismo un JWT.

Las pruebas SQL se ejecutaron con `rho_pickup_worker`, sin BYPASSRLS. Se verificó
que puede procesar la cola, pero no cambiar recibos, borrar trabajos/eventos ni
reasignar pedidos. Las pruebas del adaptador de pool usan dobles controlados;
no se ha conectado un pool al proyecto remoto ni programado tareas de servidor.
