"""Local PostgreSQL only; creates and removes an isolated synthetic lab schema.
RHO_LOCAL_PG_URL must point to a disposable local database. Never use Supabase.
"""
import concurrent.futures as futures
import json
import re
import os
from pathlib import Path
import shutil
import time
import subprocess
from urllib.parse import urlsplit, unquote


def connection_env(url):
    parsed = urlsplit(url)
    if parsed.scheme not in ('postgres', 'postgresql') or parsed.hostname not in ('localhost', '127.0.0.1', '::1'):
        raise ValueError('Only explicit loopback PostgreSQL connections are allowed')
    if parsed.query or parsed.fragment or not parsed.path.strip('/'):
        raise ValueError('Supply a local database name without URL query options')
    env = {k: v for k, v in os.environ.items() if not k.startswith('PG')}
    env.update(PGHOST=parsed.hostname, PGPORT=str(parsed.port or 5432), PGDATABASE=unquote(parsed.path[1:]), PGUSER=unquote(parsed.username or 'postgres'), PGPASSWORD=unquote(parsed.password or ''), PGCONNECT_TIMEOUT='5', PGOPTIONS='-c statement_timeout=15000 -c lock_timeout=10000')
    return env


def main():
    env = connection_env(os.environ.get('RHO_LOCAL_PG_URL', ''))
    if not shutil.which('psql'):
        raise RuntimeError('psql is required; concurrency has not been executed')

    def query(sql, expected_state=None):
        result = subprocess.run(['psql', '-X', '-v', 'ON_ERROR_STOP=1', '-v', 'VERBOSITY=sqlstate', '-Atq'], input=sql, text=True, capture_output=True, env=env)
        if result.returncode and expected_state and ('ERROR:  '+expected_state) in result.stderr:
            return 'rejected:'+expected_state
        if result.returncode:
            # Do not print connection diagnostics or credential-bearing URLs.
            raise RuntimeError('Local PostgreSQL query failed')
        return result.stdout.strip()

    def race(first, second, expected_state=None):
        # Observe the first session sleeping AFTER its locks, rather than assuming timing.
        with futures.ThreadPoolExecutor(max_workers=2) as pool:
            a = pool.submit(query, "set application_name='rho_lab_race_first';" + first)
            deadline = time.monotonic() + 10
            while query("select count(*) from pg_stat_activity where application_name='rho_lab_race_first' and wait_event='PgSleep'") != '1':
                if a.done():
                    a.result()
                    raise RuntimeError('First session ended before overlap was observed')
                if time.monotonic() > deadline:
                    raise RuntimeError('Concurrency synchronization timed out')
                time.sleep(0.05)
            b = pool.submit(query, "set application_name='rho_lab_race_second';" + second, expected_state)
            deadline = time.monotonic() + 5
            while query("select count(*) from pg_stat_activity where application_name='rho_lab_race_second' and wait_event_type='Lock'") != '1':
                if b.done() or a.done() or time.monotonic() > deadline:
                    raise RuntimeError('Required lock contention was not observed')
                time.sleep(0.02)
            return a.result(), b.result()

    query('create database rho_deployed_snapshot_lab')
    env['PGDATABASE']='rho_deployed_snapshot_lab'
    # Existing lab roles are cluster-wide. Use one private alias for this snapshot's
    # BYPASSRLS service role; preserve its exact captured grants without changing any role.
    setup=Path('/tmp/qw10-deployed-fixture.sql').read_text()
    setup=setup.replace('create role anon nologin;', '').replace('create role authenticated nologin;', '')
    setup=re.sub(r'\bservice_role\b','snapshot_service_role',setup)
    query('begin;'+setup+'commit;')
    assert query("select count(*) from pg_roles where rolname='snapshot_service_role' and not rolcanlogin and rolbypassrls")=='1'
    worker='set role snapshot_service_role;'
    def seed():
        query("""truncate qw10_test.stock,qw10_test.requests,qw10_test.lines,qw10_test.quote_holds,qw10_test.special_requests,qw10_test.receipts,qw10_test.purchase_orders,qw10_test.movements,qw10_test.preparation_events restart identity;
        insert into qw10_test.stock values('test-race-a',1,true);""")
    def web(owner='owner-a',retry='retry_snapshot_race1'):
        quote=json.dumps({'currency':'mxn','totalCents':100,'lines':[{'sku':'test-race-a','quantity':1}]})
        identity=json.dumps({'items':[{'sku':'test-race-a','quantity':1}],'address':{'postalCode':'02000'}})
        return worker+f"select public.qw10_test_reserve_v2('{owner}','{retry}','{quote}'::jsonb,'{identity}')->>'id';"
    def special():
        return worker+"select public.qw10_test_special_order('owner-a','special_snapshot_race1','test-race-a',1)->>'reserved';"
    def count(table):return query('select count(*) from qw10_test.'+table)
    seed()
    a,b=race('begin;'+web()+"select pg_sleep(2);commit;",web())
    assert b.splitlines()[-1]==a.splitlines()[-1] and count('requests')=='1' and count('lines')=='1'
    print('PASS 1: exact deployed reserve_v2 concurrent retry returns the same request without duplicate hold')
    seed()
    a,b=race('begin;'+web()+"select pg_sleep(2);commit;",web('owner-b','retry_snapshot_race2'),'P0001')
    assert b=='rejected:P0001' and count('requests')=='1'
    print('PASS 2: competing web request waits for stock lock then rejects overselling the last unit')
    seed()
    a,b=race('begin;'+web()+"select pg_sleep(2);commit;",special())
    assert b.splitlines()[-1]=='0' and query('select additional from qw10_test.special_requests')=='1' and count('quote_holds')=='0'
    print('PASS 3: web reservation wins contention; special request quotes excess without taking that stock')
    seed()
    a,b=race('begin;'+special()+"select pg_sleep(2);commit;",web(),'P0001')
    assert b=='rejected:P0001' and count('requests')=='0' and count('quote_holds')=='1'
    print('PASS 4: special reservation wins contention; web cannot take its reserved unit')
    seed();rid=query(web()).splitlines()[-1]
    query(worker+f"select public.qw10_test_bind('{rid}','owner-a','cs_test_race');")
    paid=worker+f"select public.qw10_test_commit_payment('{rid}','cs_test_race','pi_race',100,'mxn','evt_race')->>'repeated';"
    a,b=race('begin;'+paid+"select pg_sleep(2);commit;",paid)
    assert a.splitlines()[-1]=='false' and b.splitlines()[-1]=='true'
    assert count('receipts')==count('purchase_orders')==count('movements')=='1' and query('select quantity from qw10_test.stock')=='0'
    print('PASS 5: exact deployed payment RPC serializes simultaneous receipt delivery and consumes stock once')
    seed();rid=query(web()).splitlines()[-1]
    query(worker+f"select public.qw10_test_bind('{rid}','owner-a','cs_test_race');")
    query(f"update qw10_test.requests set hold_until=clock_timestamp()+interval '1.5 seconds' where id='{rid}'")
    a,b=race("begin;select sku from qw10_test.stock where sku='test-race-a' for update;select pg_sleep(2.5);commit;",
       worker+f"select public.qw10_test_commit_payment('{rid}','cs_test_race','pi_race',100,'mxn','evt_race')->>'status';")
    assert b.splitlines()[-1]=='reconciliation_required' and count('receipts')=='1'
    assert count('purchase_orders')==count('movements')=='0' and query('select quantity from qw10_test.stock')=='1'
    print('PASS 6: actual deployed function rechecks expired deadline after observed stock-lock wait')
    print('RESULT: 6 deployed-snapshot PostgreSQL contention cases passed; loopback-only disposable database')

if __name__ == '__main__':
    main()
