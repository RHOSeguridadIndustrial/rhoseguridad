"""Synthetic concurrency tests. Only an isolated, disposable loopback PostgreSQL."""
import concurrent.futures as futures
import json
import os
from pathlib import Path
import subprocess
import time
import importlib.util
spec=importlib.util.spec_from_file_location('deployed_sandbox_concurrent',Path(__file__).with_name('deployed-sandbox-concurrent.py'))
module=importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)
connection_env=module.connection_env


def main():
    env = connection_env(os.environ.get('RHO_LOCAL_PG_URL', ''))
    def sql(statement, expected=None):
        p = subprocess.run(['psql', '-X', '-Atq', '-v', 'ON_ERROR_STOP=1', '-v', 'VERBOSITY=sqlstate'], input=statement, text=True, capture_output=True, env=env)
        if p.returncode:
            if expected and ('ERROR:  '+expected) in p.stderr:
                return 'rejected:'+expected
            raise RuntimeError('Synthetic PostgreSQL query failed: '+p.stderr[-300:])
        return p.stdout.strip()
    sql('create database rho_transfer_isolated')
    env['PGDATABASE'] = 'rho_transfer_isolated'
    try:
        setup='\n'.join(Path(p).read_text() for p in ['tests/fixtures/qw10-deployed-schema.sql','supabase/qw10-test-fulfillment-review.sql','supabase/qw10-test-integrity.sql','supabase/qw10-test-transfer-confirmation.sql','supabase/qw10-test-transfer-identity.sql'])
        sql('begin;'+setup+'commit;')
        owner='11111111-1111-4111-8111-111111111111'
        sql("insert into auth.users values('"+owner+"');")
        auth="set local role authenticated;select set_config('test.uid','"+owner+"',true);select set_config('test.aal','aal2',true);"
        def seed(name, deadline=1800):
            quote=json.dumps({'currency':'mxn','paymentMethod':'transfer','totalCents':100,'lines':[{'sku':name,'name':'Synthetic','quantity':1,'unitPriceCents':100,'lineTotalCents':100}]})
            sql("insert into qw10_test.stock values('"+name+"',2,true);insert into qw10_test.requests(id,total_cents,livemode,hold_until,hold_active,owner_id,quote,expires_at) values('"+name+"',100,false,now()+interval '1 hour',true,'"+owner+"','"+quote+"',extract(epoch from clock_timestamp())::bigint+"+str(deadline)+");insert into qw10_test.lines values('"+name+"','"+name+"',1);")
        def confirm(name, reference):
            return "select public.qw10_test_transfer('confirm','"+name+"','"+reference+"',100);"
        def race(a,b,expected=None):
            with futures.ThreadPoolExecutor(max_workers=2) as pool:
                first=pool.submit(sql,"set application_name='rho_transfer_first';"+a)
                deadline=time.monotonic()+8
                while sql("select count(*) from pg_stat_activity where application_name='rho_transfer_first' and wait_event='PgSleep'")!='1':
                    if first.done() or time.monotonic()>deadline:
                        first.result();raise RuntimeError('First transaction did not reach synchronization')
                    time.sleep(.03)
                second=pool.submit(sql,"set application_name='rho_transfer_second';"+b,expected)
                while sql("select count(*) from pg_stat_activity where application_name='rho_transfer_second' and wait_event_type='Lock'")!='1':
                    if second.done() or first.done() or time.monotonic()>deadline:raise RuntimeError('Actual lock contention was not observed')
                    time.sleep(.03)
                return first.result(),second.result()
        seed('double')
        a,b=race('begin;'+auth+confirm('double','BANKTEST-DOUBLE01')+'select pg_sleep(3);commit;', 'begin;'+auth+confirm('double','BANKTEST-DOUBLE01')+'commit;')
        assert '"repeated": false' in a and '"repeated": true' in b
        assert sql("select count(*) from qw10_test.purchase_orders where request_id='double'")=='1'
        assert sql("select quantity from qw10_test.stock where sku='double'")=='1'
        print('PASS 1: overlapping confirmations wait and produce one receipt, order and stock movement')
        seed('reference-a');seed('reference-b')
        a,b=race('begin;'+auth+confirm('reference-a','BANKTEST-UNIQUE01')+'select pg_sleep(3);commit;', 'begin;'+auth+confirm('reference-b','BANKTEST-UNIQUE01')+'commit;', '23505')
        assert b=='rejected:23505'
        assert sql("select count(*) from qw10_test.receipts where request_id='reference-b'")=='0'
        assert sql("select quantity from qw10_test.stock where sku='reference-b'")=='2'
        print('PASS 2: one reference cannot confirm two requests under contention')
        seed('expiry',1)
        race("begin;select 1 from qw10_test.stock where sku='expiry' for update;select pg_sleep(3);commit;", 'begin;'+auth+confirm('expiry','BANKTEST-EXPIRY01')+'commit;')
        assert sql("select state from qw10_test.receipts where request_id='expiry'")=='reconciliation_required'
        assert sql("select quantity from qw10_test.stock where sku='expiry'")=='2'
        print('PASS 3: deadline is checked after the actual stock-lock wait')
        seed('shared')
        race("begin;select 1 from qw10_test.stock where sku='shared' for update;insert into qw10_test.quote_holds values('other-channel','shared',2,now()+interval '1 hour',true);select pg_sleep(3);commit;", 'begin;'+auth+confirm('shared','BANKTEST-SHARED01')+'commit;')
        assert sql("select state from qw10_test.receipts where request_id='shared'")=='reconciliation_required'
        assert sql("select quantity from qw10_test.stock where sku='shared'")=='2'
        print('PASS 4: committed special-order hold is respected after waiting')
    finally:
        env['PGDATABASE']='postgres'
        sql('drop database rho_transfer_isolated with(force)')

if __name__=='__main__':
    main()
