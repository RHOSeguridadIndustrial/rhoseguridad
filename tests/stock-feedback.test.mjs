import test from 'node:test';
import assert from 'node:assert/strict';
import { stockNoticeForRequest, STOCK_NOTICE_MS } from '../stock-feedback.js';

const tracked = quantity => ({ is_active: true, state: 'tracked', quantity });
test('no aviso al agregar hasta el límite de existencias', () => {
  assert.equal(stockNoticeForRequest('ready', tracked(2), 0, 1), null);
  assert.equal(stockNoticeForRequest('ready', tracked(2), 1, 2), null);
});
test('aviso al superar existencias acumuladas o agregar con cero piezas', () => {
  assert.match(stockNoticeForRequest('ready', tracked(2), 2, 3).message, /Disponibles: 2/);
  assert.match(stockNoticeForRequest('ready', tracked(0), 0, 1).title, /Sin existencias/);
  assert.match(stockNoticeForRequest('ready', { ...tracked(0), state: 'pending' }, 0, 1).title, /Sin existencias/);
});
test('no avisar al disminuir o mantener cantidad, aun cuando supere existencias', () => {
  assert.equal(stockNoticeForRequest('ready', tracked(1), 4, 3), null);
  assert.equal(stockNoticeForRequest('ready', tracked(1), 4, 4), null);
  assert.equal(stockNoticeForRequest('ready', tracked(1), 1, NaN), null);
});
test('un fallo de inventario nunca se presenta como cero existencias', () => {
  for (const [state, item] of [['loading', undefined], ['error', undefined], ['ready', undefined], ['ready', {...tracked(2),is_active:false}], ['ready',tracked(-1)]]) {
    const notice=stockNoticeForRequest(state,item,0,1);
    assert.equal(notice.title,'Disponibilidad por confirmar');
  }
});
test('el aviso se programa para tres segundos', () => {
  assert.equal(STOCK_NOTICE_MS,3000);
});
