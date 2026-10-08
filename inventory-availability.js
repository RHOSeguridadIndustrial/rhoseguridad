// Display registered physical counts without promising unreserved stock or delivery.
export function describeAvailability(connection, item, unitOverride) {
  if (connection === 'loading') return {state:'loading', text:'Consultando disponibilidad…'};
  if (connection !== 'ready') return {state:'unknown', text:'No fue posible consultar el inventario. Intenta nuevamente.'};
  if (!item) return {state:'unregistered', text:'Inventario: sin registro'};
  if (!item.is_active) return {state:'unavailable', text:'Disponibilidad por confirmar con un asesor.'};
  if (!['tracked','pending'].includes(item.state) || !Number.isInteger(item.quantity) || item.quantity < 0) {
    return {state:'unknown', text:'Estamos confirmando disponibilidad. Consulta por WhatsApp.'};
  }
  const unit = unitOverride || (!item.unit || item.unit === 'unidad' ? 'pieza' : item.unit);
  const labels = {pieza:['pieza','piezas'], par:['par','pares'], caja:['caja','cajas'], rollo:['rollo','rollos'], unidad:['unidad','unidades']};
  const words = labels[unit] || labels.unidad;
  const quantity = item.quantity;
  return {state:item.state === 'pending' ? 'pending' : quantity === 0 ? 'empty' : 'available', quantity, text:`Existencias en stock: ${quantity} ${quantity === 0 ? 'piezas' : words[quantity === 1 ? 0 : 1]}`};
}
