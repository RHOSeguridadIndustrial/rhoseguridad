import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const source = await readFile(new URL('../inventory-availability.js', import.meta.url), 'utf8');
const { describeAvailability } = await import('data:text/javascript;base64,' + Buffer.from(source).toString('base64'));

test('missing and failed inventory never invent a zero', () => {
  for (const result of [
    describeAvailability('ready', undefined),
    describeAvailability('error', {is_active:true,state:'tracked',quantity:5}),
    describeAvailability('loading', undefined)
  ]) {
    assert.equal(result.quantity, undefined);
    assert.doesNotMatch(result.text, /0|disponibles|24|48/);
  }
});

test('a recorded zero remains distinct from unconfirmed stock', () => {
  const result = describeAvailability('ready', {is_active:true,state:'tracked',quantity:0});
  assert.equal(result.state, 'empty');
  assert.equal(describeAvailability('ready', {is_active:true,state:'tracked',quantity:0,unit:'par'}, 'par').text, 'Existencias en stock: 0 piezas');
  assert.equal(result.quantity, 0);
  assert.match(result.text, /Existencias en stock: 0 piezas/);
});

test('counts use the confirmed sales unit and do not promise free stock', () => {
  const one = describeAvailability('ready', {is_active:true,state:'tracked',quantity:1,unit:'unidad'}, 'par');
  const five = describeAvailability('ready', {is_active:true,state:'tracked',quantity:5,unit:'unidad'}, 'par');
  assert.match(one.text, /Existencias en stock: 1 par/);
  assert.match(five.text, /Existencias en stock: 5 pares/);
  assert.equal(describeAvailability('ready', {is_active:true,state:'pending',quantity:0}).quantity, 0);
  assert.match(describeAvailability('ready', {is_active:true,state:'tracked',quantity:2,unit:'rollo'}).text, /Existencias en stock: 2 rollos/);
});

test('inactive or malformed records do not expose a sellable count', () => {
  for (const item of [
    {is_active:false,state:'tracked',quantity:20},
    {is_active:true,state:'unexpected',quantity:20},
    {is_active:true,state:'tracked',quantity:-1},
    {is_active:true,state:'tracked',quantity:null},
    {is_active:true,state:'tracked',quantity:1.5}
  ]) assert.equal(describeAvailability('ready', item).quantity, undefined);
});
