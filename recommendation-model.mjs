const DAY = 86400000;
const median = values => {
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
};

// An explainable recommender: repeat purchases, recency and typical replenishment
// intervals. No customer information is sent to an external AI provider.
export function recommendPurchases({ purchases = [], products = [], inventory = [], catalog = [], now = Date.now(), limit = 6 } = {}) {
  const productMap = new Map(products.filter(p => p.is_active).map(p => [p.id, p]));
  const stockMap = new Map(inventory.map(item => [item.sku, item]));
  const catalogMap = new Map(catalog.map(item => [item.product_id, item]));
  const groups = new Map();
  for (const purchase of purchases) {
    const date = Date.parse(purchase.bought_at);
    if (!purchase.event_id || !Number.isFinite(date) || date > now || date < now - 365 * DAY) continue;
    const product = productMap.get(purchase.product_id);
    const display = catalogMap.get(purchase.product_id);
    if (!product || !display || !Number.isFinite(Number(product.price)) || Number(product.price) <= 0) continue;
    const sku = purchase.sku || null;
    const stock = sku ? stockMap.get(sku) : null;
    // Never switch a customer's size/colour or substitute a different SKU.
    if (stock && (!stock.is_active || stock.product_id !== product.id)) continue;
    const key = JSON.stringify([product.id, sku]);
    if (!groups.has(key)) groups.set(key, { product, display, sku, stock, events: new Map() });
    const group = groups.get(key);
    group.events.set(String(purchase.event_id), Math.max(date, group.events.get(String(purchase.event_id)) || 0));
  }
  return [...groups.values()].map(({ product, display, sku, stock, events }) => {
    const dates = [...events.values()].sort((a, b) => a - b);
    const days = [...new Set(dates.map(date => Math.floor(date / DAY)))];
    const gaps = days.slice(1).map((day, i) => day - days[i]);
    // At least two observed intervals are required for a cadence estimate.
    const intervalDays = gaps.length >= 2 ? Math.round(median(gaps)) : null;
    const lastBought = dates.at(-1);
    const daysSince = Math.max(0, Math.floor((now - lastBought) / DAY));
    const quantity = stock?.state === 'tracked' && Number.isInteger(stock.quantity) && stock.quantity >= 0 ? stock.quantity : null;
    const available = quantity !== null && quantity > 0;
    const due = intervalDays !== null && daysSince >= intervalDays * 0.8;
    return {
      productId: product.id, sku, name: stock?.name || product.name,
      image: display.image, href: display.href, price: Number(product.price), currency: product.currency || 'MXN',
      unit: stock?.unit === 'unidad' ? 'pieza' : stock?.unit || display.unit || 'pieza',
      quantity, available, purchaseCount: dates.length, lastBought, intervalDays, due,
      score: (dates.length > 1 ? 10000 : 0) + Math.min(dates.length, 200) * 100 + 90 * Math.exp(-daysSince / 90) + (due ? 30 : 0)
    };
  }).sort((a, b) => Number(b.available) - Number(a.available) || b.score - a.score || b.lastBought - a.lastBought || a.name.localeCompare(b.name, 'es'))
    .slice(0, Math.max(0, Math.min(12, limit)));
}
