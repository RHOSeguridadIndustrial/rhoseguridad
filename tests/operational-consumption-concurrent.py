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

    def query(sql):
        result = subprocess.run(['psql', '-X', '-v', 'ON_ERROR_STOP=1', '-Atq'], input=sql, text=True, capture_output=True, env=env)
        if result.returncode:
            # Do not print connection diagnostics or credential-bearing URLs.
            raise RuntimeError('Local PostgreSQL query failed')
        return result.stdout.strip()

    def race(first, second):
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
            b = pool.submit(query, second)
            return a.result(), b.result()

    # Refuse an existing lab; never delete a schema that this run did not create.
    assert query("select count(*) from pg_namespace where nspname='consumption_lab'") == '0', 'Existing lab schema: use a fresh disposable database'
    source = (Path(__file__).resolve().parent.parent / 'prototypes/operational-consumption-lab.sql').read_text()
    query('begin;'+source+'commit;')
    try:
        query("""insert into consumption_lab.stock values('a',2),('b',2);
        insert into consumption_lab.holds values('web','owner','web',200,clock_timestamp()+interval '30 minutes','active'),('special','owner','special',200,clock_timestamp()+interval '30 minutes','active');
        insert into consumption_lab.hold_lines values('web','a',1),('web','b',1),('special','a',1),('special','b',1);
        insert into consumption_lab.receipts values('pay-web','web','owner',200,'mxn',true,false),('pay-special','special','owner',200,'mxn',true,false);""")
        web = "select consumption_lab.consume('owner','web','pay-web');"
        special = "select consumption_lab.consume('owner','special','pay-special');"
        locked_web = "begin;select * from consumption_lab.stock order by sku for update;select pg_sleep(3);"+web+'commit;'
        race(locked_web, web)
        assert query('select count(*) from consumption_lab.orders') == '1'
        assert query('select sum(quantity) from consumption_lab.stock') == '2'
        assert query('select count(*) from consumption_lab.movements') == '2'
        # The second channel consumes its own hold while a replay retains the web reference lock.
        race('begin;'+web+'select pg_sleep(3);commit;', special)
        assert query('select count(*) from consumption_lab.orders') == '2'
        assert query('select sum(quantity) from consumption_lab.stock') == '0'
        assert query('select count(*) from consumption_lab.movements') == '4'
        # A hold expires while consumption waits for a stock lock.
        query("insert into consumption_lab.stock values('late',1);insert into consumption_lab.holds values('late','owner','web',100,clock_timestamp()+interval '1 second','active');insert into consumption_lab.hold_lines values('late','late',1);insert into consumption_lab.receipts values('pay-late','late','owner',100,'mxn',true,false);")
        _, late = race("begin;select * from consumption_lab.stock where sku='late' for update;select pg_sleep(3);commit;", "select consumption_lab.consume('owner','late','pay-late');")
        assert late.endswith('reconciliation')
        assert query("select quantity from consumption_lab.stock where sku='late'") == '1'
        assert query('select count(*) from consumption_lab.orders') == '2'
        print(json.dumps({'status': 'passed', 'scope': 'local independent PostgreSQL connections', 'cases': ['simultaneous replay', 'shared multi-SKU holds', 'expiry after waiting for stock lock']}))
    finally:
        query('drop schema consumption_lab cascade;')


if __name__ == '__main__':
    main()
