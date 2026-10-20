"""Synthetic checkout retry concurrency; disposable loopback Postgres only."""
import concurrent.futures as futures
import json
import os
from pathlib import Path
import shutil
import subprocess
import time
import runpy

def main():
    root=Path(__file__).resolve().parent.parent
    helpers=runpy.run_path(str(root/'tests/operational-consumption-concurrent.py'))
    env=helpers['connection_env'](os.environ.get('RHO_LOCAL_PG_URL',''))
    if not shutil.which('psql'): raise RuntimeError('psql required')
    def query(sql,reject=False):
        p=subprocess.run(['psql','-X','-v','ON_ERROR_STOP=1','-v','VERBOSITY=sqlstate','-Atq'],input=sql,text=True,capture_output=True,env=env)
        if reject and p.returncode and 'ERROR:  P0001' in p.stderr:return 'rejected'
        if p.returncode: raise RuntimeError('Synthetic SQL failed: '+p.stderr)
        return p.stdout.strip()
    def sqlval(v):return "'"+str(v).replace("'","''")+"'"
    def reserve(key,price=19200,quantity=1):
        quote={'currency':'mxn','lines':[{'sku':'fixture-cone','name':'Fixture','quantity':quantity,'unitPriceCents':price,'lineTotalCents':price*quantity}],'subtotalCents':price*quantity,'shippingCents':9900,'totalCents':price*quantity+9900}
        identity=json.dumps({'address':{'postalCode':'02000'},'items':[{'quantity':quantity,'sku':'fixture-cone'}]},sort_keys=True,separators=(',',':'))
        return 'select public.qw10_test_reserve_v2(\'owner\','+sqlval(key)+','+sqlval(json.dumps(quote))+'::jsonb,'+sqlval(identity)+');'
    def race(first,second,reject=False):
        with futures.ThreadPoolExecutor(max_workers=2) as pool:
            a=pool.submit(query,"set application_name='rho_retry_first';"+first)
            deadline=time.monotonic()+10
            while query("select count(*) from pg_stat_activity where application_name='rho_retry_first' and wait_event='PgSleep'")!='1':
                if a.done():a.result();raise RuntimeError('No observed overlap')
                if time.monotonic()>deadline:raise RuntimeError('Overlap timeout')
                time.sleep(.05)
            b=pool.submit(query,second,reject)
            return a.result(),b.result()
    assert query("select count(*) from pg_namespace where nspname='qw10_test'")=='0'
    query('create role anon;create role authenticated;create role service_role bypassrls;')
    for f in ['supabase/qw10-isolated-test-order-store.sql','supabase/qw10-test-reservation-adapter.sql','prototypes/test-checkout-identity.sql']:
        query((root/f).read_text())
    try:
        query("grant usage on schema qw10_test to service_role;grant select on all tables in schema qw10_test to service_role;grant update on qw10_test.stock,qw10_test.requests to service_role;insert into qw10_test.stock values('fixture-cone',5,true)")
        key='concurrent_retry_same_123'
        a,b=race('begin;set role service_role;'+reserve(key)+'select pg_sleep(2);commit;','set role service_role;'+reserve(key,35000))
        first=json.loads(a.splitlines()[0]);second=json.loads(b)
        assert first==second and first['quote']['totalCents']==29100
        assert query('select count(*) from qw10_test.requests')=='1'
        # Different input under the same identity races the existing winner.
        a,b=race("begin;select pg_advisory_xact_lock(hashtextextended('owner:"+key+"',0));select pg_sleep(2);commit;",'set role service_role;'+reserve(key,19200,2),True)
        assert b=='rejected'
        # A retry waits past its original expiration and must fail, not renew.
        query("update qw10_test.requests set expires_at=floor(extract(epoch from clock_timestamp()))::bigint+1 where retry_key="+sqlval(key))
        a,b=race("begin;select pg_advisory_xact_lock(hashtextextended('owner:"+key+"',0));select pg_sleep(2);commit;",'set role service_role;'+reserve(key),True)
        assert b=='rejected'
        assert query("select json_build_object('requests',(select count(*) from qw10_test.requests),'lines',(select count(*) from qw10_test.lines),'orders',(select count(*) from qw10_test.purchase_orders),'stock',(select sum(quantity) from qw10_test.stock))")=='{"requests" : 1, "lines" : 1, "orders" : 0, "stock" : 5}'
        print(json.dumps({'status':'passed','scope':'independent local PostgreSQL 17 connections; no Stripe/Supabase','cases':['same-key simultaneous attempts return original quote and deadline','changed cart under lock rejected','expiry while waiting rejected without renewal'],'requests':1,'lines':1,'orders':0,'fixture_stock':5}))
    finally:query('drop schema qw10_test cascade;')

if __name__=='__main__':main()
