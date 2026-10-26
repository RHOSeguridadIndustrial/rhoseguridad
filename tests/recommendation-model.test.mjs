import { test } from 'node:test';
import assert from 'node:assert/strict';
import { recommendPurchases } from '../recommendation-model.mjs';
const now = Date.parse('2026-10-25T18:00:00Z');
const products = ['gloves', 'boots'].map(id => ({ id, name: id, price: 40, currency: 'MXN', is_active: true }));
const catalog = products.map(p => ({ product_id: p.id, image: 'assets/demo.webp', href: 'guantes.html' }));
const inventory = [{ sku: 'gloves', product_id: 'gloves', name: 'Guantes', quantity: 20, state: 'tracked', is_active: true }, { sku: 'boots-26', product_id: 'boots', name: 'Botas talla 26', quantity: 4, state: 'tracked', is_active: true }];
const purchase = (event_id, days, product_id = 'gloves', sku = product_id) => ({ event_id, product_id, sku, bought_at: new Date(now - days * 86400000).toISOString() });
const run = (purchases, other = {}) => recommendPurchases({ purchases, products, catalog, inventory, now, ...other });
test('no history produces no invented recommendations', () => assert.deepEqual(run([]), []));
test('repeated purchases lead, even with a recent single purchase', () => {
  const result = run([purchase('a', 55), purchase('b', 25), purchase('c', 0, 'boots', 'boots-26')]);
  assert.equal(result[0].productId, 'gloves'); assert.equal(result[0].purchaseCount, 2);
});
test('duplicate lines count as one order', () => assert.equal(run([purchase('a', 20), purchase('a', 20)])[0].purchaseCount, 1));
test('median cadence needs three distinct purchase dates', () => {
  assert.equal(run([purchase('a', 30), purchase('b', 10)])[0].intervalDays, null);
  const result = run([purchase('a', 90), purchase('b', 60), purchase('c', 30)])[0];
  assert.equal(result.intervalDays, 30); assert.equal(result.due, true);
});
test('same-day orders do not create a replenishment interval', () => assert.equal(run([purchase('a', 3), purchase('b', 3), purchase('c', 3)])[0].intervalDays, null));
test('future, invalid, missing-ID and over-one-year dates are ignored', () => {
  assert.deepEqual(run([purchase('a', -1), purchase('b', 366), { ...purchase('c', 1), bought_at: 'invalid' }, purchase('', 1)]), []);
});
test('uses current catalog price instead of an old paid price', () => assert.equal(run([{ ...purchase('a', 1), price: 99 }])[0].price, 40));
test('inactive and unknown products are omitted', () => assert.deepEqual(run([purchase('a', 1), purchase('b', 1, 'unknown')], { products: products.map(p => ({ ...p, is_active: false })) }), []));
test('exact variant is kept; missing variant cannot auto-add', () => {
  assert.equal(run([purchase('a', 2, 'boots', 'boots-26')])[0].sku, 'boots-26');
  const unknown = run([purchase('b', 2, 'boots', null)])[0]; assert.equal(unknown.sku, null); assert.equal(unknown.available, false);
});
test('deleted SKU is not substituted by another variant', () => {
  const item = run([purchase('a', 1, 'boots', 'boots-27')])[0]; assert.equal(item.sku, 'boots-27'); assert.equal(item.available, false);
});
test('pending or missing inventory is never sold as in-stock', () => {
  assert.equal(run([purchase('a', 2)], { inventory: [{ ...inventory[0], state: 'pending' }] })[0].available, false);
  assert.equal(run([purchase('a', 2)], { inventory: [] })[0].quantity, null);
});
test('out-of-stock products are retained below available purchases', () => {
  const result = run([purchase('a', 20), purchase('b', 10), purchase('c', 4, 'boots', 'boots-26')], { inventory: [{ ...inventory[0], quantity: 0 }, inventory[1]] });
  assert.equal(result[0].sku, 'boots-26'); assert.equal(result[1].quantity, 0);
});
test('SKU mapped to another product or inactive SKU is omitted', () => {
  assert.deepEqual(run([purchase('a', 2)], { inventory: [{ ...inventory[0], product_id: 'boots' }] }), []);
  assert.deepEqual(run([purchase('a', 2)], { inventory: [{ ...inventory[0], is_active: false }] }), []);
});
test('invalid prices excluded and requested limit honored', () => {
  assert.deepEqual(run([purchase('a', 2)], { products: [{ ...products[0], price: null }] }), []);
  assert.equal(run([purchase('a', 1)], { limit: 0 }).length, 0);
});
