# QW10 — integración aislada de consumo e historial

22 octubre 2026. Ejecutar `node tests/integrated-consumption-database.mjs`.

Resultado actualizado: nueve comprobaciones aprobadas con PGlite 0.3.14, datos sintéticos, sin conexión remota. Se cargan la migración original del inventario, reservations.sql y el contrato de actor. En la copia efímera se adaptan los tres triggers para reconocer un contexto privado asociado a transacción, SKU, cantidades anterior/nueva y evento de auditoría. El contexto se elimina al terminar el consumo. La ruta humana conserva su comprobación de administrador.

Se verificó consumo contra public.inventory_items de la copia y registro system sin suplantar usuario; reintento sin historial duplicado; rechazo por reserva manual con rollback de evento/orden; rechazo de contexto falsificado por authenticated; rechazo de escritura posterior sin contexto; ajuste manual posterior con historial human.

## Alcance pendiente

No es una migración ni un mecanismo de autorización desplegable. El propietario del fixture produce recibos y contexto: falta implementar el productor autenticado de recibos y demostrar permisos con la identidad real del servicio. El laboratorio ahora usa un rol llamador sin permisos de escritura directa y un ejecutor NOLOGIN/NOBYPASSRLS, con permisos restringidos y políticas RLS explícitas. auth.uid/is_admin se simulan para el laboratorio; no certifica JWT/MFA reales. El contexto experimental acota SKU/cantidades; el trigger además rechaza modificaciones a los demás campos, revisión y fecha proporcionadas por el llamador. No se otorgaron accesos nuevos en Supabase.

La prueba anterior de cuatro carreras certifica el modelo consumption_lab separado. Aún debe ejecutarse concurrencia contra esta integración de triggers y todos los escritores operativos. Tampoco unifica aún el ciclo de vida de reservas web con las cotizaciones manuales ni resuelve la compensación de pagos tardíos sin stock. Las tablas de recibos/órdenes del fixture continúan sintéticas.

No habilitar producción. QW10 sigue abierto; el reporte final se emitirá al cerrar los criterios pendientes.

## Permisos y campos — ampliación

Nueve pruebas aprobadas: las seis previas ahora ejecutan consumo con lab_worker, que únicamente puede invocar la función privada del laboratorio. La función utiliza un ejecutor sin login ni bypass RLS; no se concedió al worker membresía en ese rol. Tres grupos adicionales comprueban denegación de escritura directa en inventario/recibos/contexto, denegación de llamada para anon/authenticated/service_role y rechazo de seis alteraciones de campos acompañadas de un descuento autorizado.

El primer intento del arnés esperaba que SET ROLE fuese rechazado desde una sesión originalmente superusuario. Esa expectativa era incorrecta: se corrigió comprobando pg_has_role y los accesos efectivos a tablas. No se cambiaron permisos para forzar la aprobación. El laboratorio no simula una conexión real con credenciales de worker ni valida autenticación del productor de recibos.

La función SECURITY DEFINER aquí es una entrada interna deliberada, propiedad de un rol restringido y sin EXECUTE público; no se desplegó. Pendiente revisión y prueba de sesiones independientes con esta integración, ciclo compartido de reservas y recibos verificados.
