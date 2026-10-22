# QW10 — contrato de consumo, laboratorio 22 octubre 2026

Estado: 14 comprobaciones aprobadas con PGlite 0.3.14 en memoria. Sin acceso a Supabase, Stripe, credenciales ni stock real.

Ejecutar: `node tests/consumption-contract-database.mjs`.

El prototipo vincula un recibo sintético a propietario, solicitud, sesión de prueba, importe y moneda; exige pago aprobado y modo de prueba. Una sola transacción registra orden, descuento e historial. Bloquea solicitud y SKU ordenados, respeta reservas ajenas vigentes y libera la reserva propia al consumir. El reintento idéntico no vuelve a descontar; otro recibo para la misma solicitud se rechaza.

Pruebas: ocho alteraciones del recibo rechazadas sin efectos; fallo en segundo SKU y fallo de auditoría revierten todo; consumo correcto conserva reservas ajenas e ignora vencidas; reintento idéntico; recibo conflictivo; acceso del cliente denegado. Las 14 aprobaron en la primera ejecución.

## Límites y siguiente integración

Este es un modelo de contrato separado (`consumption_lab`), no una migración desplegable. No sustituye los tres triggers operativos ni integra todavía `private.inventory_automation_events`. Los recibos los inserta el dueño del fixture: NO verifica firmas de Stripe, origen del evento ni autenticación real. El historial simplificado permite demostrar atomicidad, pero no certifica aún compatibilidad del escritor automático con los triggers humanos.

Para integrar: conectar productor autenticado de recibos inmutables, unificar eventos con el contrato de actor anterior, adaptar escritor y guardas en copia aislada del esquema real, y hacer que todos los escritores de reservas adquieran los mismos bloqueos. Probar con sesiones Postgres independientes consumo versus reserva/ajuste; PGlite de una sola conexión no certifica carreras. Definir además política para pagos tardíos sin reserva y stock insuficiente (rechazo actual del modelo). No habilitar producción.

No se asigna porcentaje global: aprobar estas pruebas no equivale a cerrar QW10.
