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

    query('create database rho_shared_lifecycle_lab')
    env['PGDATABASE']='rho_shared_lifecycle_lab'
    # PostgreSQL roles are cluster-wide; previous fixture already created these exact roles.
    assert query("select count(*) from pg_roles where rolname in ('anon','authenticated','service_role','lab_worker','lab_executor') and not rolcanlogin and not rolbypassrls")=='5'
    setup = re.sub(r'create role [^;]+;', '', Path('/tmp/qw10-integrated-fixture.sql').read_text(), flags=re.IGNORECASE)
    query('begin;'+setup+'commit;')
    query((Path(__file__).parent/'fixtures/qw10-shared-lifecycle.sql').read_text())
    admin="select set_config('test.uid','11111111-1111-4111-8111-111111111111',false);select set_config('test.aal','aal2',false);set role authenticated;"
    worker="select set_config('test.uid','',false);set role lab_worker;"
    def seed():
        query("""truncate consumption_lab.reconciliation,consumption_lab.history,consumption_lab.orders,consumption_lab.receipts,consumption_lab.holds,consumption_lab.lines,consumption_lab.requests,consumption_lab.reservation_demands;
        truncate private.lab_write_context,public.inventory_history,private.inventory_automation_events;
        truncate private.inventory_reservation_lines,private.inventory_reservations;"""+admin+"""
        select public.inventory_adjust('lab-a','count',1,1,'pieza',true,'Reset fixture',(select revision from public.inventory_items where sku='lab-a'));
        reset role;truncate public.inventory_history;""")
    web=worker+"select consumption_lab.reserve('web','lab-a',1)->>'status';"
    special=worker+"select consumption_lab.reserve('special','lab-a',1)->>'status';"
    manual=admin+"""select public.inventory_reservation('create','RHO-00000001','[{"sku":"lab-a","quantity":1}]')->>'action';"""
    def held():
        return query("select private.inventory_reserved('lab-a')")
    seed()
    a,b=race('begin;'+web+'select pg_sleep(2);commit;',special)
    assert b.splitlines()[-1]=='quote' and held()=='1'
    print('PASS 1: web and special demand share the last unit under contention')
    seed()
    a,b=race('begin;'+manual+'select pg_sleep(2);commit;',web)
    assert b.splitlines()[-1]=='quote' and held()=='1'
    print('PASS 2: prior manual reservation blocks competing web reservation')
    seed()
    a,b=race('begin;'+web+'select pg_sleep(2);commit;',manual)
    assert b.splitlines()[-1]=='quote' and held()=='1'
    print('PASS 3: prior web reservation blocks competing manual reservation')
    seed()
    query(web)
    query("""insert into consumption_lab.requests(id,owner_id,session_id,amount,currency) values('web','owner','cs_test_web',100,'mxn');
    insert into consumption_lab.lines values('web','lab-a',1);
    insert into consumption_lab.receipts values('event','web','owner','cs_test_web','pi_web',100,'mxn','paid',false);""")
    a,b=race("""begin;select sku from public.inventory_items where sku='lab-a' for update;
    update consumption_lab.holds set expires_at=clock_timestamp()+interval '1 second' where reference='web';
    select pg_sleep(2);commit;""",worker+"select consumption_lab.consume('web','event');")
    assert b.splitlines()[-1]=='needs_reconciliation'
    assert query("select quantity from public.inventory_items where sku='lab-a'")=='1'
    assert query('select count(*) from consumption_lab.orders')=='0'
    assert query('select count(*) from consumption_lab.reconciliation')=='1'
    assert query("select active from consumption_lab.holds where reference='web'")=='t' and held()=='0'
    print('PASS 4: hold expiring during lock wait reconciles paid receipt without consuming stock')
    print('RESULT: 4 shared-lifecycle PostgreSQL contention checks passed; disposable database only')

if __name__ == '__main__':
    main()
