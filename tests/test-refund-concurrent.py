"""Exercise the actual deployed schema plus upgrade in a fresh loopback-only DB."""
import concurrent.futures as futures
import json
import os
from pathlib import Path
import subprocess
import time
from urllib.parse import urlsplit, unquote

def main():
    uri=urlsplit(os.environ.get('RHO_LOCAL_PG_URL',''))
    if uri.scheme not in ('postgres','postgresql') or uri.hostname not in ('localhost','127.0.0.1','::1') or uri.query or uri.fragment:
        raise ValueError('Only a disposable loopback database is allowed')
    env={k:v for k,v in os.environ.items() if not k.startswith('PG')}
    env.update(PGHOST=uri.hostname,PGPORT=str(uri.port or 5432),PGDATABASE=unquote(uri.path[1:]),PGUSER=unquote(uri.username or 'postgres'),PGPASSWORD=unquote(uri.password or ''),PGCONNECT_TIMEOUT='5',PGOPTIONS='-c statement_timeout=15000 -c lock_timeout=10000')
    def query(sql,expected=None):
        p=subprocess.run(['psql','-X','-Atq','-v','ON_ERROR_STOP=1','-v','VERBOSITY=sqlstate'],input=sql,text=True,capture_output=True,env=env)
        if p.returncode:
            if expected and 'ERROR:  '+expected in p.stderr:return 'rejected:'+expected
            raise RuntimeError('Local fixture query failed: '+p.stderr[-800:])
        return p.stdout.strip()
    assert query("select count(*) from pg_namespace where nspname in ('qw10_test','private','auth')")=='0'
    query(Path('/tmp/qw10-refund-schema.sql').read_text())
    def race(first,second,expected=None):
        with futures.ThreadPoolExecutor(max_workers=2) as pool:
            a=pool.submit(query,"set application_name='qw10_first';"+first)
            deadline=time.monotonic()+8
            while query("select count(*) from pg_stat_activity where application_name='qw10_first' and wait_event='PgSleep'")!='1':
                if a.done() or time.monotonic()>deadline:raise RuntimeError('First session did not hold locks: '+str(a.result()))
                time.sleep(.03)
            b=pool.submit(query,"set application_name='qw10_second';"+second,expected)
            deadline=time.monotonic()+5
            while query("select count(*) from pg_stat_activity where application_name='qw10_second' and wait_event_type='Lock'")!='1':
                if a.done() or b.done() or time.monotonic()>deadline:raise RuntimeError('No concurrent lock wait observed')
                time.sleep(.02)
            return a.result(),b.result()
    def record(event,status,created=1792800000,payment='pi_fixture'):
        return f"set role service_role;select public.qw10_test_record_refund('{event}','re_fixture','{payment}',100,'mxn','{status}','refund.updated',{created},false)->>'repeated';"
    a,b=race('begin;'+record('evt_one','succeeded')+'select pg_sleep(2);commit;',record('evt_one','succeeded'))
    assert b.splitlines()[-1]=='true' and query('select count(*) from qw10_test.refund_events')=='1'
    print('PASS 1: concurrent redelivery stores one immutable event')
    a,b=race('begin;'+record('evt_failure','failed',1792800002)+'select pg_sleep(2);commit;',record('evt_older','succeeded',1792800001))
    assert query("select qw10_test.refund_snapshot('no-order','pi_fixture',100)->>'state'")=='unresolved'
    print('PASS 2: older success delivered after failure cannot close the case')
    a,b=race('begin;'+record('evt_bound','failed',1792800003)+'select pg_sleep(2);commit;',record('evt_conflict','succeeded',1792800004,'pi_foreign'),'P0001')
    assert b=='rejected:P0001' and query("select count(*) from qw10_test.refund_events where payment_intent_id='pi_foreign'")=='0'
    assert query('select count(*) from qw10_test.purchase_orders')=='0' and query('select count(*) from qw10_test.movements')=='0'
    print('PASS 3: conflicting payment binding rejects under contention with no orders or movements')
    print('RESULT: 3 PostgreSQL refund contention checks passed')

if __name__=='__main__':main()
