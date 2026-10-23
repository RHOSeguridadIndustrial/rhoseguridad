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
    query(Path('/tmp/qw10-deployed-upgraded.sql').read_text())
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
    def seed():
        query('truncate qw10_test.reconciliation_reviews,qw10_test.fulfillment_events,qw10_test.preparation_events,qw10_test.movements,qw10_test.purchase_orders,qw10_test.receipts,qw10_test.lines,qw10_test.requests,qw10_test.quote_holds,qw10_test.special_requests,qw10_test.stock;')
        query("insert into qw10_test.stock values('fixture-sku',1,true);")
    def request(id):
        query(f"insert into qw10_test.requests(id,session_id,total_cents,livemode,hold_until,owner_id) values('{id}','cs_test_{id}',100,false,clock_timestamp()+interval '1 hour','fixture-owner');insert into qw10_test.lines values('{id}','fixture-sku',1);")
    def pay(id):return f"set role service_role;select public.qw10_test_commit_payment('{id}','cs_test_{id}','pi_{id}',100,'mxn','evt_{id}')->>'status';"
    def state():return query("select (select quantity from qw10_test.stock)||','||(select count(*) from qw10_test.purchase_orders)||','||(select count(*) from qw10_test.movements)||','||(select count(*) from qw10_test.fulfillment_events)")
    seed();request('one')
    a,b=race('begin;'+pay('one')+'select pg_sleep(2);commit;',pay('one'))
    assert b.splitlines()[-1]=='paid' and state()=='0,1,1,1'
    print('PASS 1: duplicate concurrent payment yields one order, movement and actor event')
    seed();request('one');request('two')
    a,b=race('begin;'+pay('one')+'select pg_sleep(2);commit;',pay('two'))
    assert state()=='0,1,1,2'
    assert query("select count(*) from qw10_test.receipts where state='reconciliation_required'")=='1'
    print('PASS 2: competing paid requests preserve one unit and reconcile the other')
    seed()
    special="set role service_role;select public.qw10_test_special_order('fixture-owner','special-retry-key-1234','fixture-sku',1)->>'reserved';"
    quote=json.dumps({'currency':'mxn','totalCents':100,'lines':[{'sku':'fixture-sku','quantity':1}]})
    web="set role service_role;select public.qw10_test_reserve('fixture-owner','web-retry-key-1234','"+quote+"'::jsonb);"
    a,b=race('begin;'+special+'select pg_sleep(2);commit;',web,'P0001')
    assert b=='rejected:P0001' and query('select count(*) from qw10_test.requests')=='0'
    print('PASS 3: special hold blocks a competing web reservation under the same stock lock')
    seed()
    a,b=race('begin;'+web+'select pg_sleep(2);commit;',special)
    assert b.splitlines()[-1]=='0' and query('select additional from qw10_test.special_requests')=='1'
    print('PASS 4: web hold makes competing special demand a quote without over-reservation')
    seed();request('late')
    query("update qw10_test.requests set hold_until=clock_timestamp()+interval '1 second' where id='late'")
    a,b=race("begin;select sku from qw10_test.stock for update;select pg_sleep(2);commit;",pay('late'))
    assert b.splitlines()[-1]=='reconciliation_required' and state()=='1,0,0,1'
    assert query("select reason from qw10_test.fulfillment_events where request_id='late'")=='reservation_expired'
    print('PASS 5: reservation expiring during a stock-lock wait records review without discount')
    print('RESULT: 5 PostgreSQL contention checks passed on deployed schema plus upgrade')

if __name__=='__main__':main()
