"""Operational card migration under real PostgreSQL locks, loopback fixture only."""
import concurrent.futures as futures
import json
import os
from pathlib import Path
import subprocess
import time
from urllib.parse import urlsplit, unquote


def main():
    uri = urlsplit(os.environ.get('RHO_LOCAL_PG_URL', ''))
    if uri.scheme not in ('postgres', 'postgresql') or uri.hostname not in ('localhost', '127.0.0.1', '::1') or uri.query or uri.fragment:
        raise ValueError('Only a disposable loopback database is allowed')
    env = {k: v for k, v in os.environ.items() if not k.startswith('PG')}
    env.update(PGHOST=uri.hostname, PGPORT=str(uri.port or 5432), PGDATABASE=unquote(uri.path[1:]),
               PGUSER=unquote(uri.username or 'postgres'), PGPASSWORD=unquote(uri.password or ''),
               PGCONNECT_TIMEOUT='5', PGOPTIONS='-c statement_timeout=15000 -c lock_timeout=10000')

    def query(sql, expected=None):
        result = subprocess.run(['psql', '-X', '-Atq', '-v', 'ON_ERROR_STOP=1', '-v', 'VERBOSITY=sqlstate'],
                                input=sql, text=True, capture_output=True, env=env)
        if result.returncode:
            if expected and 'ERROR:  ' + expected in result.stderr:
                return 'rejected:' + expected
            raise RuntimeError('Local fixture query failed: ' + result.stderr[-1200:])
        return result.stdout.strip()

    assert query("select count(*) from pg_namespace where nspname in ('private','auth')") == '0'
    query(Path('/tmp/rho-card-operational-fixture.sql').read_text())
    owner = '11111111-1111-4111-8111-111111111111'
    other = '22222222-2222-4222-8222-222222222222'
    admin = '33333333-3333-4333-8333-333333333333'
    address = dict(country='MX', state='CMX', postalCode='02000', municipalityCode='002', settlementCode='0001',
                   street='Calle sintética', exterior='10', interior='', reference='')
    quote = dict(currency='mxn', paymentMethod='card', lines=[dict(sku='fixture-sku', name='fixture-sku', quantity=1,
                 unitPriceCents=332, lineTotalCents=332)], subtotalCents=332, shippingCents=9900, totalCents=10232, mode='standard',
                 delivery=dict(status='postal_match', assurance='postal_catalog_only', catalogSha256='a' * 64,
                 validUntil='2099-01-01T00:00:00Z', address={**address, 'municipality': 'Azcapotzalco', 'settlement': 'Centro'}))
    identity = dict(address=address, contact=dict(name='Comprador de prueba', phone='5555555555'), paymentMethod='card', items=[dict(sku='fixture-sku', quantity=1)])
    # Values below are fixed synthetic fixtures, not external input.
    qtext = json.dumps(quote, ensure_ascii=False)
    itext = json.dumps(identity, ensure_ascii=False)

    def as_admin(sql):
        return f"select set_config('test.uid','{admin}',false),set_config('test.aal','aal2',false);set role authenticated;" + sql

    def reserve(key, who=owner):
        return f"set role service_role;select public.card_checkout_reserve('{who}','{key}','{qtext}'::jsonb,'{itext}')->>'id';"

    def seed():
        query("truncate public.orders,public.order_items,private.card_checkout_requests,private.card_checkout_lines,"
              "private.card_payment_receipts,private.card_inventory_write_context,public.inventory_history,"
              "private.inventory_reservations,private.inventory_reservation_lines;")
        query("update private.card_checkout_configuration set enabled=true,pinned_sha256='" + 'a' * 64 + "';")
        query(as_admin("select set_config('rho.inventory_reason','Reset isolated fixture',false);"
                       "update public.inventory_items set quantity=1 where sku='fixture-sku';"))

    def prepared(key):
        req = query(reserve(key)).splitlines()[-1]
        session = 'cs_live_' + req.replace('-', '')
        query(f"set role service_role;select public.card_checkout_bind('{req}','{owner}','{session}');")
        return req, session

    def pay(request):
        req, session = request
        suffix = req.replace('-', '')
        return f"set role service_role;select public.card_checkout_commit('{req}','{session}','pi_{suffix}',10232,'mxn','evt_{suffix}')->>'status';"

    def state():
        return query("select (select quantity from public.inventory_items where sku='fixture-sku')||','||"
                     "(select count(*) from public.orders)||','||(select count(*) from private.card_payment_receipts)||','||"
                     "(select count(*) from public.inventory_history where card_receipt_id is not null)")

    def race(first, second, expected=None):
        with futures.ThreadPoolExecutor(max_workers=2) as pool:
            a = pool.submit(query, "set application_name='rho_card_first';" + first)
            deadline = time.monotonic() + 8
            while query("select count(*) from pg_stat_activity where application_name='rho_card_first' and wait_event='PgSleep'") != '1':
                if a.done() or time.monotonic() > deadline:
                    raise RuntimeError('First session did not hold locks: ' + str(a.result()))
                time.sleep(.03)
            b = pool.submit(query, "set application_name='rho_card_second';" + second, expected)
            deadline = time.monotonic() + 5
            while query("select count(*) from pg_stat_activity where application_name='rho_card_second' and wait_event_type='Lock'") != '1':
                if a.done() or b.done() or time.monotonic() > deadline:
                    raise RuntimeError('No concurrent lock wait observed; first=' + str(a.result()) + ', second=' + str(b.result()))
                time.sleep(.02)
            return a.result(), b.result()

    seed()
    req = prepared('duplicate-payment-key')
    _, repeated = race('begin;' + pay(req) + 'select pg_sleep(2);commit;', pay(req))
    assert repeated.splitlines()[-1] == 'paid' and state() == '0,1,1,1'
    print('PASS 1: simultaneous copies of a payment produce one order, receipt and stock audit')

    seed()
    _, blocked = race('begin;' + reserve('first-buyer-retry-key') + 'select pg_sleep(2);commit;',
                      reserve('second-buyer-retry-key', other), 'P0001')
    assert blocked == 'rejected:P0001' and query('select count(*) from private.card_checkout_requests') == '1'
    print('PASS 2: two different buyers competing for the last unit get only one reservation')

    seed()
    manual = as_admin("select public.inventory_reservation('create','RHO-00000001','[{\"sku\":\"fixture-sku\",\"quantity\":1}]')->>'action';")
    _, blocked = race('begin;' + manual + 'select pg_sleep(2);commit;', reserve('manual-first-web-key'), 'P0001')
    assert blocked == 'rejected:P0001'
    print('PASS 3: a manual quote blocks a competing card checkout at the same SKU lock')

    seed()
    _, blocked = race('begin;' + reserve('web-first-manual-key') + 'select pg_sleep(2);commit;', manual)
    assert blocked.splitlines()[-1] == 'quote'
    print('PASS 4: a card checkout blocks a competing manual quote without over-reservation')

    seed()
    req = prepared('expiry-lock-wait-key')
    query(f"update private.card_checkout_requests set expires_at=floor(extract(epoch from clock_timestamp()))::bigint+1 where id='{req[0]}'")
    _, late = race("begin;select sku from public.inventory_items where sku='fixture-sku' for update;select pg_sleep(2);commit;", pay(req))
    assert late.splitlines()[-1] == 'reconciliation_required' and state() == '1,0,1,0'
    assert query('select reason from private.card_payment_receipts') == 'reservation_expired'
    print('PASS 5: expiration during a stock lock wait records review without an order or stock deduction')

    seed()
    req = prepared('paid-before-manual-key')
    revision = query("select revision from public.inventory_items where sku='fixture-sku'")
    adjustment = as_admin(f"select public.inventory_adjust('fixture-sku','issue',1,1,'pieza',true,'Manual collision',{revision});")
    _, blocked = race('begin;' + pay(req) + 'select pg_sleep(2);commit;', adjustment, '40001')
    assert blocked == 'rejected:40001' and state() == '0,1,1,1'
    print('PASS 6: competing manual stock adjustment observes the committed revision and cannot consume twice')
    assert query('select count(*) from private.card_inventory_write_context') == '0'
    print('RESULT: 6 PostgreSQL concurrency checks passed on operational inventory/order migration')


if __name__ == '__main__':
    main()
