# QW10 — integración aislada de consumo e historial

22 octubre 2026. Ejecutar `node tests/integrated-consumption-database.mjs`.

Resultado: seis comprobaciones aprobadas con PGlite 0.3.14, datos sintéticos, sin conexión remota. Se cargan la migración original del inventario, reservations.sql y el contrato de actor. En la copia efímera se adaptan los tres triggers para reconocer un contexto privado asociado a transacción, SKU, cantidades anterior/nueva y evento de auditoría. El contexto se elimina al terminar el consumo. La ruta humana conserva su comprobación de administrador.

Se verificó consumo contra public.inventory_items de la copia y registro system sin suplantar usuario; reintento sin historial duplicado; rechazo por reserva manual con rollback de evento/orden; rechazo de contexto falsificado por authenticated; rechazo de escritura posterior sin contexto; ajuste manual posterior con historial human.

## Alcance pendiente

No es una migración ni un mecanismo de autorización desplegable. El propietario del fixture produce recibos y contexto: falta implementar el productor autenticado de recibos y el rol mínimo del escritor, y demostrar permisos reales. auth.uid/is_admin se simulan para el laboratorio; no certifica JWT/MFA reales. El contexto experimental acota SKU/cantidades, pero una versión desplegable deberá acotar también todos los campos de la fila y el rol del escritor. No se otorgaron accesos nuevos en Supabase.

La prueba anterior de cuatro carreras certifica el modelo consumption_lab separado. Aún debe ejecutarse concurrencia contra esta integración de triggers y todos los escritores operativos. Tampoco unifica aún el ciclo de vida de reservas web con las cotizaciones manuales ni resuelve la compensación de pagos tardíos sin stock. Las tablas de recibos/órdenes del fixture continúan sintéticas.

No habilitar producción. QW10 sigue abierto; el reporte final se emitirá al cerrar los criterios pendientes.
