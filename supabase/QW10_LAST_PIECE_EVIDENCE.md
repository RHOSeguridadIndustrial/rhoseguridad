# QW10 — Prueba de última pieza

Fecha: 16 de octubre de 2026 UTC / 15 de octubre CDMX.

Referencia: Assessment RHO 3.0, página 5, prueba Última pieza.

Entorno: qw10_test, SKU sintético test-last-piece-20261016-0551, 1 unidad. Sin Stripe ni cobros, sin acceso de escritura a inventario real.

Se lanzaron dos llamadas de reserva en paralelo, con identidades distintas. La transacción ganadora mantuvo su bloqueo 2 segundos antes de confirmar; la otra devolvió Insufficient test stock. Se verificó 1 solicitud y 1 unidad reservada. Reintentar la identidad ganadora devolvió exactamente el mismo request. Total de órdenes de prueba permaneció en 3 e inventario real en 50.

La reserva sintética se cerró al finalizar, conservando registros para auditoría. No hubo pagos ni órdenes nuevas.

Alcance: verifica exclusión e idempotencia del adaptador de reservas desplegado en Postgres. No acredita aún prueba de navegador con dos clientes, recorrido Safari, stock compartido con ventas asistidas, ni integración con preparación física. Mantener cobros reales deshabilitados.
