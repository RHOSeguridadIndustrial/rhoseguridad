# QW10 — preparación del adaptador de cobro real

6 de noviembre de 2026. **Borrador de integración; cobros reales deshabilitados.**

## Estado verificado directamente

- `create-card-checkout` desplegado: versión 6, `CARD_PAYMENTS_ENABLED=false`.
  La implementación de septiembre crea órdenes antes de la sesión, no envía
  idempotency key, no incluye envío ni reservas de QW10 en su cálculo.
- `verify-card-payment` desplegado: versión 4. Actualiza la orden al consultar
  el retorno; no sustituye un webhook firmado ni un escritor atómico de stock.
- La lista de endpoints webhook de la cuenta activa de RHO devolvió cero
  resultados, `has_more=false`. No se creó ninguno durante esta revisión.
- Los tres triggers operativos `inventory_before_write`, `inventory_audit` e
  `inventory_reservation_guard` aún requieren administrador humano. La auditoría
  exige `changed_by` asociado a `auth.users`; no existe un escritor automático
  autorizado para el cobro real.
- El webhook y los pedidos #9 y #10 descritos en `STRIPE_INTEGRATION_TODO.md`
  pertenecen al sandbox. No prueban que producción esté lista.

Por lo tanto, **guardar un secreto y cambiar una bandera no basta** para activar
el cobro real. La presencia actual de secretos de producción no se pudo comprobar
con el conector y no se presume ni su ausencia ni su validez.

## Código preparado

`create-card-checkout.js` es una función de servidor aún sin endpoint desplegado:

- Calcula la cotización con un proveedor de precios/domicilio del servidor y
  comprueba importes en centavos, envío, contenido del carrito y domicilio.
- Exige el total aceptado por el cliente, pero nunca lo usa como fuente de precio.
- Reutiliza la reserva inmutable en reintentos, incluida su clave de idempotencia
  Stripe. No libera reservas por un resultado de red desconocido.
- Rechaza reservas de pruebas, vencidas, de otro propietario o con otro carrito.
- Preserva los parámetros acordados de Checkout Studio y los cuatro parámetros
  autorizados de asociación, caducidad y moneda. Usa las rutas de producción
  existentes; esas páginas todavía deben adaptarse al nuevo contrato.
- Valida entorno live, sesión, importe, moneda, referencia, metadatos, vencimiento
  y URL Stripe antes de asociar la sesión y devolver la redirección.

`card-payment-runtime.js` verifica la firma sobre el cuerpo original mediante
Stripe SDK y vuelve a consultar la sesión en Stripe. Exige evento y sesión live,
identidad e importe coincidentes, y llama al adaptador atómico de persistencia.
Los pagos pendientes no crean órdenes. Un error al persistir devuelve 500 para
permitir reintentos. Este módulo no registra reembolsos, disputas ni expiraciones;
su destino deberá suscribirse exclusivamente a los dos eventos de éxito admitidos
hasta implementar y verificar las demás proyecciones.

Ambos módulos se mantienen apagados por defecto. **No están conectados a las
funciones desplegadas, la base operativa ni el carrito público.** No modifican
`create-test-checkout`, su webhook ni sus validadores.

## Contrato pendiente de implementar antes de desplegar

| Componente | Requisito verificable |
| --- | --- |
| Autenticación y límite de uso | Resolver el cliente desde su sesión válida, cuenta activa y correo confirmado; conservar MFA para administradores; limitar reservas por cuenta. Nunca aceptar `ownerId` del navegador. |
| `quoteBuilder` | Precios del catálogo operativo y domicilio validado contra el catálogo postal vigente. Configuración confiable del servidor, separada del catálogo de prueba. La coincidencia postal no acredita entrega física. |
| `loadReservation` | Consulta por propietario y clave; devuelve la cotización inmutable, `environment=live`, `livemode=true` e `integrationVersion=card-checkout-v1`. |
| `reserve` | Transacción con bloqueo por clave y SKUs ordenados, revisión de precio/disponibilidad incluyendo reservas manuales, límite de uso y expiración persistida compatible con Stripe. Rechazar cambio de carrito o de total aceptado. |
| `bindSession` | Asociación atómica de una única sesión a la reserva de ese propietario; reintentos iguales permitidos, sustituciones rechazadas. |
| `loadRequest` del webhook | Búsqueda por sesión asociada, con ID de solicitud, total congelado, entorno y versión. Si el webhook llega antes de la asociación, responder con error temporal para reintento. |
| `commitPaid` | Firma verificada previamente; bloquear solicitud y SKUs, validar nuevamente todos los datos, insertar recibo/pedido/movimiento/auditoría en una sola transacción. Unicidad de sesión y PaymentIntent. |
| Pago tardío/sin existencias | Conservar recibo para conciliación, sin descontar inventario ni crear un pedido listo para surtirse. Verificar vigencia después de esperar bloqueos. |
| Inventario | Adaptar los tres triggers para una identidad de sistema verificable; no usar un UUID humano ficticio ni una bandera enviada por el cliente. Mantener bloqueos y reservas manuales. |
| Consulta de estado | Solo lectura y limitada al propietario; no confirmar el pago desde la página de éxito. |
| Interfaz | Mostrar total y envío antes de crear sesión, conservar clave al reintentar, registrar domicilio/contacto del comprador y manejar retorno/cancelación en móvil y escritorio. |

Los callbacks aún no implementados son dependencias obligatorias. No sustituirlos
por funciones de `qw10_test` ni activar el endpoint antiguo.

## Evidencia y siguientes pasos

`node --test tests/live-checkout-core.test.mjs tests/checkout-summary.test.mjs tests/checkout-coupon.test.mjs`
pasó **37 pruebas**: 16 nuevas y 21 existentes. Las nuevas cubren configuración
cerrada, importes/envío, cambio de precio, reintentos tras timeout o error de
asociación, carritos distintos, mezcla sandbox/live, firma alterada, discrepancias
de Stripe, pagos pendientes y persistencia fallida.

Las firmas se verifican con el SDK real; Stripe y persistencia son simulados en
estas pruebas. **No acreditan concurrencia, atomicidad ni ausencia de duplicados
en la base de producción**. Esas propiedades se deben comprobar al implementar
el contrato de persistencia. No se realizaron cargos ni cambios de inventario.

Siguiente trabajo: implementar y validar ese contrato contra el esquema operativo,
integrar las pantallas y completar las pruebas remotas pendientes del sandbox.
Después, configurar el destino webhook de producción y sus secretos en Supabase,
desplegar y verificar el circuito completo antes de habilitar el botón público.
