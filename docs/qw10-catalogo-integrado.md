# QW10 — catálogo recibido y checkout postal de prueba

Archivo aportado por el propietario: CPdescargatxt.zip. El encabezado del TXT
identifica a Correos de México. Fecha interna ZIP: 22/10/2026 00:16:40 (sin zona
horaria). No es una descarga verificada de manera independiente desde el servidor.

- ZIP SHA-256: 66958263bf3e2f996023dfd2469198a04752b41d693c116c5f6f305b2c6e7b5d
- TXT SHA-256: e418524da00e6e23ce544ad2f43d849698baa5673b3348bbf5cc84d6d8515c96
- 159382 registros nacionales, 32 entidades.
- CDMX: 1531 asentamientos, 1110 códigos postales, 16 alcaldías, cero claves duplicadas.
- Codificación: Windows-1252; ceros y acentos conservados.

El catálogo completo no se incorpora a GitHub ni al cliente web. Se prepara la
selección CDMX como texto verificado mediante SHA-256 en una tabla privada con RLS,
sin lectura directa para anon, authenticated ni service_role. El getter es exclusivo
del servicio; la función privada solo lee el catálogo habilitado. La API de prueba
requiere administrador con MFA y devuelve exclusivamente opciones de un CP.
La función nunca ofrece el catálogo completo al navegador.

El checkout conserva el modo rápido 02000 para compatibilidad y agrega selección
explícita de consulta postal. El administrador ingresa CP, elige alcaldía/colonia
y usa calle/número ficticios. La respuesta se invalida al cambiar CP o identidad;
los resultados tardíos no restauran datos. La referencia de reintento usa el hash
del carrito, método y domicilio, sin guardar el domicilio en sessionStorage.
Cambiar el domicilio cambia la clave; el servidor rechaza reusar la anterior con
otro domicilio. La cotización conserva su domicilio y procedencia en qw10_test.
Una coincidencia postal no confirma existencia física de calle/número ni entrega.

Verificación local inicial: 66 pruebas de módulo/endpoint/regresiones y prueba de
RLS, permisos del getter y deshabilitación. La CI incluye Chromium y WebKit móvil.
Publicación, migración, carga del catálogo y prueba remota pendientes de verificación.
No se activan cobros, reservas operativas ni entregas reales.
