# Seguridad de administración RHO

Estado: listo para revisión; requiere autorización de Rafael antes de publicar. No se modificaron usuarios, contraseña, factores ni sesiones reales.

## Cambios

- Autenticación TOTP obligatoria en administración. La cuenta propia se puede consultar a AAL1 para iniciar la vinculación. Los datos de otros clientes y las operaciones administrativas requieren AAL2, un factor TOTP verificado y una sesión vigente del mismo usuario.
- Cierre por 15 minutos de inactividad y máximo absoluto de 8 horas. Tanto las políticas de datos como las APIs comprueban estado de sesión en el servidor. Una sesión eliminada no puede recuperar permisos con un JWT anterior.
- Acceso protegido en clientes, pedidos, precios, inventario y lealtad, incluyendo RPCs y los tres servicios administrativos. La protección no depende del menú ni de una variable JavaScript.
- Asistente de vinculación con QR y clave manual para usar en el mismo teléfono; selección de autenticadores, verificación y opción de agregar uno de respaldo tras MFA. No se almacenan códigos ni claves TOTP en registros, archivos ni almacenamiento del navegador. Solo se recuerda el ID de un factor pendiente para evitar dejar factores sin verificar.
- Botón para cerrar otras sesiones. Salida administrativa con cierre global desde el asistente y limpieza del contenido al terminar la sesión.

## Publicación

Tras autorización: publicar página de seguridad/guardas y los servicios con JWT activado, aplicar la migración de MFA/sesiones y verificar que las APIs bloqueen AAL1. La puesta en marcha requiere que Rafael ingrese con su cuenta y vincule su autenticador. No simular, capturar ni completar códigos del usuario.

Si la sesión anterior tiene más de 8 horas, tras verificar el factor se solicitará iniciar sesión otra vez; el factor queda vinculado. Si una sesión expiró por inactividad, un código TOTP reciente permite recuperarla mientras no haya llegado al límite de 8 horas.

## Recuperación

Agregar un autenticador de respaldo desde Seguridad antes de cambiar de teléfono. Si se pierden todos los factores, el propietario del proyecto necesita recuperar MFA mediante el canal administrativo de Supabase. No hay un botón público para omitir MFA. No eliminar la cuenta de administrador ni establecer contraseñas desde estas migraciones.

## Limitaciones pendientes

El proyecto informa que la protección contra contraseñas filtradas está desactivada. Su activación depende de la configuración/plan de Auth y no está incluida en este cambio. Los límites generales de intentos y las políticas de contraseña de Auth son configuraciones del proyecto y no se simulan con bloqueos de JavaScript. Una página con cierre automático ayuda a limpiar la pantalla; la seguridad de acceso se impone en el servidor. Una sesión previamente verificada puede operar durante su ventana activa; MFA no sustituye cuidar el dispositivo y las credenciales.

## Pruebas

Pruebas locales de permisos AAL1/AAL2, factores, sesión de otro usuario, sesiones vencidas/revocadas, inactividad, revalidación TOTP y políticas restrictivas que bloquean permisos antiguos. Navegador: redirección de paneles sin MFA, vinculación/challenge, fallos de código, rutas permitidas y diseño móvil. Todo usa fixtures aisladas; la vinculación real solo la completa Rafael.
