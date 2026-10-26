import { shippingCoupon } from './shipping-coupon.js?v=20261022';

export const MAX_QUANTITY = 9999;
export function priceInCents(value) {
  if (value === null || value === undefined || value === '' || typeof value === 'boolean') return null;
  const price = Number(value), cents = Math.round(price * 100);
  return Number.isFinite(price) && Number.isSafeInteger(cents) && cents > 0 &&
    Math.abs(price * 100 - cents) < 0.00001 ? cents : null;
}

// Only live, active MXN prices are quotable. Static catalog prices are not a fallback.
export function buildQuoteCatalog(catalog, variants, products, inventory) {
  const prices = new Map(products.map(row => [row.id, row]));
  const stock = new Map(inventory.map(row => [row.sku, row]));
  const parents = new Map(catalog.map(row => [row.product_id, row]));
  return variants.filter(variant => variant.sku !== 'chaleco-seguridad').flatMap(variant => {
    const parent = parents.get(variant.product_id), price = prices.get(variant.product_id);
    if (!parent || price?.is_active !== true || price.currency !== 'MXN') return [];
    const unitCents = priceInCents(price.price);
    if (unitCents === null) return [];
    const item = stock.get(variant.sku);
    if (item && item.is_active !== true) return [];
    const known = !!item && ['tracked', 'pending'].includes(item.state) &&
      Number.isSafeInteger(item.quantity) && item.quantity >= 0;
    return [{...parent, sku: variant.sku, name: item?.name || variant.name,
      unit: variant.unit || parent.unit || 'pieza', unitCents,
      stock: known ? item.quantity : null}];
  });
}

export function calculateQuote(selection, catalog, options = {}) {
  if (!Array.isArray(selection) || !selection.length) throw new Error('Agrega al menos un artículo.');
  const available = new Map(catalog.map(item => [item.sku, item]));
  const quantities = new Map();
  for (const item of selection) {
    if (!Number.isSafeInteger(item.quantity) || item.quantity < 1 || item.quantity > MAX_QUANTITY)
      throw new Error(`Usa cantidades enteras entre 1 y ${MAX_QUANTITY}.`);
    const quantity = (quantities.get(item.sku) || 0) + item.quantity;
    if (quantity > MAX_QUANTITY) throw new Error(`El máximo por artículo es ${MAX_QUANTITY}.`);
    quantities.set(item.sku, quantity);
  }
  let productsCents = 0;
  const lines = [...quantities].map(([sku, quantity]) => {
    const product = available.get(sku);
    if (!product) throw new Error('Un artículo ya no está disponible para cotizar. Retíralo para continuar.');
    const amountCents = product.unitCents * quantity;
    productsCents += amountCents;
    if (!Number.isSafeInteger(amountCents) || !Number.isSafeInteger(productsCents) || productsCents > Math.floor(Number.MAX_SAFE_INTEGER / 100))
      throw new Error('El importe supera el máximo permitido.');
    return {...product, quantity, amountCents, shortage: product.stock !== null && quantity > product.stock};
  });
  const specialOrder = lines.some(line => line.shortage);
  const stockUnknown = lines.some(line => line.stock === null);
  const shipping = stockUnknown ? {status:'pending', reason:'inventory', shippingCents:null, totalCents:null}
    : shippingCoupon({...options, subtotalCents:productsCents, specialOrder});
  const netCents = Math.round(productsCents * 100 / 116);
  return {lines, productsCents, netCents, taxCents:productsCents - netCents, specialOrder, stockUnknown, shipping};
}
