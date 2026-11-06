// Scheduler callback for paid-order ingestion only. No carrier side effects.
// Use a private scheduler to invoke runOnce; this module exposes no HTTP route.
export function pickupWorker({store,enabled=false,batchSize=100,maxBatches=5}) {
 if(typeof store?.syncPaidOrders!=='function'||!Number.isInteger(batchSize)||batchSize<1||batchSize>500||
    !Number.isInteger(maxBatches)||maxBatches<1||maxBatches>20) throw Error('Invalid worker configuration');
 let running=false;
 return {
  async runOnce({signal}={}) {
   if(!enabled) return {status:'disabled',created:0};
   if(running) return {status:'already_running',created:0};
   running=true;let created=0,batches=0;
   try {
    while(batches<maxBatches&&!signal?.aborted) {
     const results=await store.syncPaidOrders({limit:batchSize});batches++;
     created+=results.filter(x=>!x.repeated).length;
     if(results.length<batchSize) return {status:'drained',created,batches};
    }
    return {status:signal?.aborted?'stopped':'batch_limit',created,batches};
   } finally {running=false;}
  }
 };
}
