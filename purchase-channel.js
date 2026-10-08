// QW9 routing only. This does not reserve stock, create an order or charge a payment.
export function purchaseChannel(items, inventory, connection = 'ready') {
  if (connection !== 'ready') return {action:'blocked',message:'No pudimos confirmar las existencias. Actualiza la página e intenta nuevamente.'};
  if (!Array.isArray(items) || !items.length) return {action:'blocked',message:'Agrega artículos al carrito.'};
  const requested = new Map();
  for (const item of items) {
    if (typeof item.sku !== 'string' || !Number.isSafeInteger(item.quantity) || item.quantity < 1)
      return {action:'blocked',message:'Revisa las cantidades de tu carrito.'};
    const total = (requested.get(item.sku) || 0) + item.quantity;
    if (!Number.isSafeInteger(total)) return {action:'blocked',message:'Revisa las cantidades de tu carrito.'};
    requested.set(item.sku,total);
  }
  const stock = new Map(inventory.map(item => [item.sku,item]));
  const rows = [...requested].map(([sku,quantity]) => ({sku,quantity,item:stock.get(sku)}));
  if (rows.some(({item}) => !item || !item.is_active || !['tracked','pending'].includes(item.state) || !Number.isSafeInteger(item.quantity) || item.quantity < 0))
    return {action:'blocked',message:'Hay artículos cuyo inventario todavía debe registrarse o confirmarse.'};
  const shortages = rows.filter(({quantity,item}) => quantity > item.quantity).map(({sku,quantity,item}) => ({sku,requested:quantity,stock:item.quantity}));
  if (shortages.length) return {action:'special',shortages,message:'La cantidad solicitada supera las existencias. Cotiza tu pedido especial con un descuento adicional por WhatsApp.'};
  // Physical counts are not free stock. The verified payment/delivery flow is still gated.
  return {action:'onsite_pending',message:'Tu compra continuará en la página cuando se habiliten la confirmación de existencias, la entrega y el pago.'};
}
