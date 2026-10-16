# QW10 — Rechazo de tarjeta en Stripe Sandbox

16 octubre 2026 UTC / 15 octubre CDMX.

Flujo real de navegador en sandbox, administrador MFA: se sustituyó el cono del carrito de pruebas por una mascarilla, 2470 centavos + envío9900 =12370 MXN. Sesión cs_test_a1fwvpp1ApSwpm4gmC4S7MCVGzOs9Yy2KLmdK67biJavTqgeelFYhe58In; solicitud 17768de2-f24a-453b-b4a2-6f88c0b15645.

Tarjeta pública Stripe de rechazo genérico 4000000000000002; datos ficticios; Link desmarcado. Stripe mostró: Se rechazó tu tarjeta de crédito. Intenta pagar con una tarjeta de débito.

Verificación posterior en RHO: state pending, orderId null, recibo null, órdenes previas3, inventario real50. Pantalla no confirma el pago. La reserva de prueba permanece hasta vencimiento: no liberar anticipadamente mientras la sesión Stripe pueda reintentarse. No se efectuó pago aprobado ni se activaron cobros reales. Carrito quedó con 1 mascarilla para esta prueba.

Hallazgo visual: en estado pending el título conserva Verificando sesión por el callback de autenticación; preparar cambio a Pago de prueba sin confirmar en siguiente revisión. Screenshot rho-qw10-pago-no-confirmado.jpg. No se modificó la página en este paso.
