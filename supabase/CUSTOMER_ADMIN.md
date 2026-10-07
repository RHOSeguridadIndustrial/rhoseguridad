# Administración de clientes: edición y baja

Estado: propuesta lista para revisión; requiere autorización de Rafael antes de publicar.

La pestaña Clientes permite buscar, filtrar, editar nombre, empresa, teléfono y correo de acceso, dar de baja y reactivar. Las cuentas con rol distinto de customer quedan protegidas en la interfaz y en el servidor. La baja requiere motivo y confirmación; conserva los perfiles y los pedidos. Cambiar correo requiere confirmar la identidad del nuevo correo. Los pedidos históricos no se reescriben.

## Publicación después de la autorización

1. Revisar cambios concurrentes en main y en el esquema de Supabase antes de aplicar.
2. Aplicar la migración `admin_customer_edit_and_deactivation` de esta rama.
3. Desplegar `supabase/functions/admin-manage-customer/index.ts` con `handler.js`, verificación JWT activada. El servidor usa las variables ya suministradas por Supabase: SUPABASE_URL y SUPABASE_SERVICE_ROLE_KEY. Nunca se incluyen claves privadas en el sitio.
4. Publicar admin.html, admin-customers.css, admin-customers.js y cuenta.js. La cuenta.html debe cargar la nueva versión de cuenta.js.
5. Verificar autorización del endpoint y realizar una prueba con cuenta de prueba autorizada (sin modificar las cuentas existentes para pruebas).

## Integridad y permisos

La Edge Function valida la sesión, consulta el rol real del administrador y protege las cuentas administrativas. Auth impide correos duplicados y bloquea inicio/renovación de sesión de usuarios dados de baja. Un trigger privado procesa una operación única en app_metadata, comprueba la revisión del perfil, actualiza perfil y auditoría en la misma transacción que Auth. Si falla, todo el cambio se revierte. No se utiliza user_metadata para autorizar.

Las políticas restrictivas consultan el estado actual para bloquear operaciones de clientes dados de baja incluso con JWT previamente emitido. La cuenta propia conserva lectura de su perfil para mostrar el aviso. Los clientes solo tienen permiso de actualización de nombre, empresa y teléfono; no pueden cambiar rol, ID, correo de acceso ni estado desde la tabla.

El trigger únicamente actúa cuando cambia rho_customer_admin_operation; inicios de sesión y cambios ordinarios de contraseña no lo ejecutan. Las revisiones de perfiles cambian en cada actualización para prevenir escrituras sobre datos desactualizados.

## Verificación

Las pruebas locales del servidor usan clientes simulados para comprobar permisos, validación, conflictos y correos duplicados. Las pruebas SQL usan PostgreSQL embebido con un esquema mínimo equivalente para verificar atomicidad, baja, reactivación, preservación de pedidos y RLS. Las pruebas de navegador utilizan exclusivamente datos ficticios y respuestas simuladas; no prueban el entorno publicado.

La integración Auth real se verifica después del despliegue autorizado. Revertir solamente el frontend deja los datos intactos; no eliminar la columna de estado ni las políticas si ya hay cuentas inactivas.
