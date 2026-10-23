"""Local PostgreSQL only; creates and removes an isolated synthetic lab schema.
RHO_LOCAL_PG_URL must point to a disposable local database. Never use Supabase.
"""
import concurrent.futures as futures
import json
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

    assert query("select count(*) from pg_namespace where nspname in ('consumption_lab','private','auth','qw10_actor_lab')") == '0'
    assert query("select count(*) from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='public' and c.relkind in ('r','p')") == '0'
    source = Path('/tmp/qw10-integrated-fixture.sql').read_text()
    query('begin;'+source+'commit;')
    admin="select set_config('test.uid','11111111-1111-4111-8111-111111111111',false);select set_config('test.aal','aal2',false);set role authenticated;"
    worker="select set_config('test.uid','',false);set role lab_worker;"
    def seed():
        query("""truncate consumption_lab.history,consumption_lab.orders,consumption_lab.receipts,consumption_lab.holds,consumption_lab.lines,consumption_lab.requests;
        truncate private.lab_write_context,public.inventory_history,private.inventory_automation_events;
        truncate private.inventory_reservation_lines,private.inventory_reservations;"""+admin+"""
        select public.inventory_adjust('lab-a','count',1,1,'pieza',true,'Reset fixture',(select revision from public.inventory_items where sku='lab-a'));
        reset role;truncate public.inventory_history;
        insert into consumption_lab.requests values('r1','owner1','cs_test_one',100,'mxn'),('r2','owner2','cs_test_two',100,'mxn');
        insert into consumption_lab.lines values('r1','lab-a',1),('r2','lab-a',1);
        insert into consumption_lab.receipts values('e1','r1','owner1','cs_test_one','pi_one',100,'mxn','paid',false),('e2','r2','owner2','cs_test_two','pi_two',100,'mxn','paid',false);""")
    c1=worker+"select consumption_lab.consume('r1','e1');"
    c2=worker+"select consumption_lab.consume('r2','e2');"
    reserve=admin+"""select public.inventory_reservation('create','RHO-00000001','[{"sku":"lab-a","quantity":1}]')->>'action';"""
    # The revision is read before waiting; optimistic conflict is an acceptable rejection.
    issue=admin+"select public.inventory_adjust('lab-a','issue',1,1,'pieza',true,'Manual race',(select revision from public.inventory_items where sku='lab-a'));"
    def state():
        return query("select (select quantity from public.inventory_items where sku='lab-a')||','||(select count(*) from consumption_lab.orders)||','||(select count(*) from public.inventory_history where actor_kind='system')||','||(select count(*) from private.inventory_reservations where status='active')||','||(select count(*) from private.lab_write_context)")
    seed()
    a,b=race('begin;'+c1+'select pg_sleep(2);commit;',c1)
    assert b.splitlines()[-1]=='already_consumed' and state()=='0,1,1,0,0'
    print('PASS 1: integrated worker duplicate produces one automatic movement')
    seed()
    a,b=race('begin;'+c1+'select pg_sleep(2);commit;',c2,'P0001')
    assert b=='rejected:P0001' and state()=='0,1,1,0,0'
    print('PASS 2: integrated competing workers cannot oversell')
    seed()
    a,b=race('begin;'+reserve+'select pg_sleep(2);commit;',c1,'P0001')
    assert b=='rejected:P0001' and state()=='1,0,0,1,0'
    print('PASS 3: original manual reservation blocks worker consumption')
    seed()
    a,b=race('begin;'+c1+'select pg_sleep(2);commit;',reserve)
    assert b.splitlines()[-1]=='quote' and state()=='0,1,1,0,0'
    print('PASS 4: original reservation writer sees committed worker stock')
    seed()
    a,b=race('begin;'+issue+'select pg_sleep(2);commit;',c1,'P0001')
    assert b=='rejected:P0001' and state()=='0,0,0,0,0'
    print('PASS 5: original manual issue prevents worker double consumption')
    seed()
    a,b=race('begin;'+c1+'select pg_sleep(2);commit;',issue,'40001')
    assert b=='rejected:40001' and state()=='0,1,1,0,0'
    print('PASS 6: manual adjustment rejects stale revision after worker write')
    print('RESULT: 6 integrated PostgreSQL concurrency checks passed; fixture container only')

if __name__ == '__main__':
    main()
