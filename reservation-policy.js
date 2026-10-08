// QW9 server-side policy draft. This planner does not persist a reservation.
export const RESERVATION_MINUTES = 30;

export function planReservation({items, inventory, holds, now}) {
  if (!Number.isFinite(now) || !Array.isArray(items) || !items.length || items.length > 100)
    throw new Error('invalid_request');
  const requested = new Map();
  for (const item of items) {
    if (typeof item.sku !== 'string' || !/^[a-z0-9][a-z0-9-]{1,119}$/.test(item.sku) ||
        !Number.isSafeInteger(item.quantity) || item.quantity < 1 || item.quantity > 1000000)
      throw new Error('invalid_request');
    const quantity = (requested.get(item.sku) || 0) + item.quantity;
    if (quantity > 1000000) throw new Error('invalid_request');
    requested.set(item.sku, quantity);
  }
  const stock = new Map(inventory.map(item => [item.sku, item]));
  const rows = [...requested].sort(([a], [b]) => a.localeCompare(b)).map(([sku, quantity]) => {
    const item = stock.get(sku);
    const verified = item?.is_active && item.state === 'tracked' &&
      Number.isSafeInteger(item.quantity) && item.quantity >= 0;
    const reserved = holds.filter(hold => hold.sku === sku && hold.status === 'active' && hold.expiresAt > now)
      .reduce((total, hold) => {
        if (!Number.isSafeInteger(hold.quantity) || hold.quantity < 1) throw new Error('invalid_hold');
        return total + hold.quantity;
      }, 0);
    const available = verified ? Math.max(0, item.quantity - reserved) : 0;
    return {sku, requested:quantity, available, eligible:Boolean(verified && available >= quantity)};
  });
  const eligible = rows.every(row => row.eligible);
  return {action:eligible ? 'reserve' : 'quote', rows,
    expiresAt:eligible ? now + RESERVATION_MINUTES * 60000 : null};
}
