import {test} from 'node:test';
import assert from 'node:assert/strict';
import {postgresTransaction} from '../logistics/postgres-transaction.mjs';
import {pickupWorker} from '../logistics/pickup-worker.mjs';

test('transaction commits before releasing its exclusive connection',async()=>{
 const calls=[];const client={query:async sql=>calls.push(sql),release:error=>calls.push(error?'destroy':'release')};
 const result=await postgresTransaction({connect:async()=>client})(async tx=>{assert.equal(tx,client);await tx.query('work');return 7;});
 assert.equal(result,7);assert.deepEqual(calls,['BEGIN ISOLATION LEVEL READ COMMITTED',"SET LOCAL lock_timeout = '5s'","SET LOCAL statement_timeout = '15s'",'work','COMMIT','release']);
});
test('failure rolls back and destroys a connection whose rollback fails',async()=>{
 const calls=[];const original=Error('operation failed');
 const client={query:async sql=>{calls.push(sql);if(sql==='ROLLBACK')throw Error('connection lost');},release:error=>calls.push(error?'destroy':'release')};
 await assert.rejects(postgresTransaction({connect:async()=>client})(async()=>{throw original;}),error=>error===original);
 assert.deepEqual(calls.slice(-2),['ROLLBACK','destroy']);assert.ok(!calls.includes('COMMIT'));
});
test('lost commit acknowledgement is never retried automatically',async()=>{
 let calls=0,connects=0;const client={query:async sql=>{if(sql==='COMMIT')throw Error('ack lost');},release:()=>{}};
 await assert.rejects(postgresTransaction({connect:async()=>{connects++;return client;}})(async()=>{calls++;}),/ack lost/);
 assert.equal(calls,1);assert.equal(connects,1);
});
test('worker defaults to disabled and limits each run',async()=>{
 let n=0;const store={syncPaidOrders:async()=>{n++;return [{repeated:false},{repeated:true}];}};
 assert.equal((await pickupWorker({store}).runOnce()).status,'disabled');assert.equal(n,0);
 assert.deepEqual(await pickupWorker({store,enabled:true,batchSize:2,maxBatches:2}).runOnce(),{status:'batch_limit',created:2,batches:2});
});
test('worker prevents overlapping runs and accepts a stop between batches',async()=>{
 let resolve;const pending=new Promise(r=>resolve=r);const controller=new AbortController();
 const worker=pickupWorker({enabled:true,batchSize:1,store:{syncPaidOrders:()=>pending}});
 const first=worker.runOnce({signal:controller.signal});
 assert.equal((await worker.runOnce()).status,'already_running');
 controller.abort();resolve([{repeated:false}]);assert.equal((await first).status,'stopped');
});
test('worker releases busy flag after failure so polling can recover',async()=>{
 let n=0;const worker=pickupWorker({enabled:true,store:{syncPaidOrders:async()=>{if(n++===0)throw Error('offline');return [];}}});
 await assert.rejects(worker.runOnce(),/offline/);assert.equal((await worker.runOnce()).status,'drained');
});
