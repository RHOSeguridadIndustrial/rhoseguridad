import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { PGlite } from '@electric-sql/pglite';
import { createQuoteReferenceHandler } from '../supabase/functions/quote-reference/handler.js';

test('sequential quote references, permissions, retries and cart behavior', async () => {
  const db = new PGlite();
  try {
    await db.exec('create role anon; create role authenticated; create role service_role bypassrls;');
    await db.exec(fs.readFileSync(new URL('../supabase/migrations/20261008002041_add_sequential_quote_references.sql', import.meta.url), 'utf8'));
    const allocate = async (key, fingerprint) => {
      try {
        const result = await db.query('select public.allocate_quote_reference($1::uuid,$2) as reference', [key, fingerprint]);
        return { data: result.rows[0].reference, error: null };
      } catch (error) { return { data: null, error }; }
    };
    const handler = createQuoteReferenceHandler({ publishableKeys: ['sb_publishable_test'], allocate });
    const call = (body, overrides = {}) => handler(new Request('https://example.test/quote-reference', {
      method: 'POST', headers: { origin: 'https://rhosegind.com', apikey: 'sb_publishable_test', 'content-type': 'application/json', ...overrides },
      body: JSON.stringify(body)
    }));
    const first = { request_key: crypto.randomUUID(), fingerprint: 'a'.repeat(64) };
    await db.exec('set role service_role');
    assert.equal((await call(first, { apikey: 'bad' })).status, 401);
    assert.equal((await call(first, { origin: 'https://other.test' })).status, 403);
    assert.equal((await call({ request_key: 'bad', fingerprint: 'bad' })).status, 400);
    assert.deepEqual(await (await call(first)).json(), { reference: 'RHO-00000001' });
    assert.deepEqual(await (await call(first)).json(), { reference: 'RHO-00000001' });
    assert.equal((await call({ ...first, fingerprint: 'b'.repeat(64) })).status, 409);
    assert.deepEqual(await (await call({ ...first, request_key: crypto.randomUUID() })).json(), { reference: 'RHO-00000002' });
    await db.exec('begin');
    assert.equal((await allocate(crypto.randomUUID(), first.fingerprint)).data, 'RHO-00000003');
    await db.exec('rollback');

    const saved = new Map();
    globalThis.sessionStorage = { getItem: key => saved.get(key) ?? null, setItem: (key, value) => saved.set(key, value) };
    let loseNextResponse = true;
    globalThis.quoteTestClient = { functions: { invoke: async (_name, { body }) => {
      const response = await call(body);
      const result = await response.json();
      if (loseNextResponse) { loseNextResponse = false; throw new Error('Simulated lost response'); }
      return response.ok ? { data: result, error: null } : { data: null, error: result };
    } } };
    const clientSource = fs.readFileSync(new URL('../quote-reference.js', import.meta.url), 'utf8')
      .replace(/^import[^\n]+\n/, 'const supabase = globalThis.quoteTestClient;\n');
    const moduleUrl = 'data:text/javascript;base64,' + Buffer.from(clientSource).toString('base64');
    const client = await import(moduleUrl);
    const items = [{ id: 'guante-japones-latex', name: 'Guante japonés con látex', qty: 2, price: 39.45 }];
    const request = { items, name: 'Cliente de prueba', company: '' };
    await assert.rejects(() => client.getQuoteReference(request), /Simulated lost response/);
    const reload = await import(moduleUrl + '#reload');
    assert.equal(await reload.getQuoteReference(request), 'RHO-00000003');
    assert.equal(await reload.getQuoteReference(request), 'RHO-00000003');
    assert.ok(![...saved.values()].join('').includes(request.name));

    const elements = new Map();
    const element = id => {
      if (!elements.has(id)) elements.set(id, { innerHTML: '', value: '', disabled: false, hidden: true, textContent: '', setCustomValidity() {}, reportValidity() {} });
      return elements.get(id);
    };
    let failReference = false;
    const context = {
      Intl, Number, String, Set, Math, encodeURIComponent,
      getQuoteReference: async args => { if (failReference) throw new Error('Network error'); return reload.getQuoteReference(args); },
      getCart: () => items, updateQuantity() {}, removeFromCart() {}, updateCartBadges() {},
      document: { getElementById: element, querySelectorAll: () => [] },
      window: { addEventListener() {}, location: { href: '' } }
    };
    const cartScript = fs.readFileSync(new URL('../carrito.html', import.meta.url), 'utf8')
      .match(/<script type="module">([\s\S]*?)<\/script>/)[1].replace(/import\{[^}]+\}from'[^']+';/g, '');
    vm.runInNewContext(cartScript, context);
    element('guestName').value = request.name;
    await element('guestQuoteForm').onsubmit({ preventDefault() {} });
    const url = new URL(context.window.location.href);
    assert.equal(url.hostname, 'wa.me');
    assert.equal(url.pathname, '/525545683441');
    assert.match(url.searchParams.get('text'), /Referencia de solicitud: RHO-00000003/);
    assert.ok(url.searchParams.get('text').includes('2 pares x Guante japonés con látex — $78.90'));
    assert.ok(!element('cart-content').innerHTML.includes('RHO-00000003'));
    context.window.location.href = '';
    failReference = true;
    await element('guestQuoteForm').onsubmit({ preventDefault() {} });
    assert.equal(context.window.location.href, '');
    assert.equal(element('quoteRequestStatus').hidden, false);
    assert.equal(element('checkout').disabled, false);

    await db.exec('reset role');
    const permissions = (await db.query("select has_table_privilege('anon','private.quote_reference_counter','select') as counter_read, has_table_privilege('authenticated','private.quote_request_references','select') as request_read, has_function_privilege('anon','public.allocate_quote_reference(uuid,text)','execute') as allocate")).rows[0];
    assert.deepEqual(permissions, { counter_read: false, request_read: false, allocate: false });
    assert.equal((await db.query('select last_value from private.quote_reference_counter')).rows[0].last_value, 3);
    const rls = (await db.query("select bool_and(relrowsecurity) as enabled from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='private' and c.relname in ('quote_reference_counter','quote_request_references')")).rows[0];
    assert.equal(rls.enabled, true);
    await db.exec('begin; update private.quote_reference_counter set last_value=99999998; set local role service_role;');
    assert.equal((await allocate(crypto.randomUUID(), first.fingerprint)).data, 'RHO-99999999');
    assert.match((await allocate(crypto.randomUUID(), first.fingerprint)).error.message, /quote_reference_exhausted/);
    await db.exec('rollback');
  } finally { await db.close(); }
});
