import {advancePickup,newPickupJob} from './pickup-workflow.mjs';

// withTransaction(fn) MUST use one dedicated connection: BEGIN, fn, COMMIT;
// on any error ROLLBACK, then release. Never share a connection concurrently.
// Only a trusted server may call this module. It performs no transport calls.
export function pickupStore({withTransaction,environment='test'}) {
 if(environment!=='test') throw Error('Live pickup queue is not enabled');
 const identity=x=>({orderId:String(x.orderId),revision:x.revision,environment});
 async function lock(tx,id) {
  const initial=newPickupJob(id);
  await tx.query(`insert into rho_pickup.jobs(job_key,environment,order_id,revision,state)
   values($1,$2,$3,$4,$5::jsonb) on conflict(environment,order_id) do nothing`,
   [initial.key,id.environment,id.orderId,id.revision,JSON.stringify(initial)]);
  const {rows}=await tx.query(`select * from rho_pickup.jobs where environment=$1 and order_id=$2 for update`,[environment,id.orderId]);
  if(rows[0].revision!==id.revision) throw Error('Order already has another shipment revision; review required');
  return rows[0].state;
 }
 async function apply(tx,job,event) {
  if(event.environment!==job.environment||event.orderId!==job.orderId||event.revision!==job.revision)
   throw Error('Event identity mismatch');
  const {rows}=await tx.query(`select payload=$3::jsonb as same from rho_pickup.events where job_key=$1 and event_id=$2`,
   [job.key,event.id,JSON.stringify(event)]);
  if(rows.length) {
   if(!rows[0].same) throw Error('Event retry payload changed');
   return {state:job,repeated:true};
  }
  const next=advancePickup({...job,seenEvents:[]},event);
  // Event IDs live in a unique table rather than a growing JSON array.
  next.seenEvents=[];
  await tx.query(`insert into rho_pickup.events(job_key,event_id,payload) values($1,$2,$3::jsonb)`,[job.key,event.id,JSON.stringify(event)]);
  await tx.query(`update rho_pickup.jobs set state=$2::jsonb,version=version+1,updated_at=clock_timestamp() where job_key=$1`,[job.key,JSON.stringify(next)]);
  return {state:next,repeated:false};
 }
 return {
  // The producer reads paid evidence from QW10, never a browser payment flag.
  // Polling is replayable: no cursor can permanently skip a committed order.
  async syncPaidOrders({limit=100}={}) {
   if(!Number.isInteger(limit)||limit<1||limit>500) throw Error('Invalid batch size');
   return withTransaction(async tx=>{
    const {rows}=await tx.query(`select o.id::text as order_id,r.id as request_id
     from qw10_test.purchase_orders o
     join qw10_test.requests r on r.id=o.request_id and r.session_id=o.session_id
     join qw10_test.receipts p on p.request_id=r.id and p.session_id=o.session_id
     where r.livemode=false and p.state='paid' and p.amount_cents=r.total_cents
      and not exists(select 1 from rho_pickup.jobs j where j.environment='test' and j.order_id=o.id::text)
     order by o.id limit $1`,[limit]);
    const results=[];
    for(const row of rows) {
     const id=identity({orderId:row.order_id,revision:'initial'});
     const job=await lock(tx,id);
     results.push(await apply(tx,job,{...id,id:'qw10-paid:'+row.request_id,type:'payment_confirmed'}));
    }
    return results;
   });
  },
  async applyEvent(event) {
   if(event?.environment!==environment) throw Error('Event environment mismatch');
   if(event.type==='package_prepared') throw Error('Use verified preparation entry point');
   return withTransaction(async tx=>{
    // Applying an event cannot manufacture an unpaid/unrecognized order.
    const {rows}=await tx.query(`select state from rho_pickup.jobs where environment=$1 and order_id=$2 for update`,[environment,event.orderId]);
    if(!rows.length) throw Error('Paid order is not queued');
    return apply(tx,rows[0].state,event);
   });
  },
  // actorId must come from a freshly verified administrator session/MFA.
  // shipment must combine canonical order address, measured package and a
  // server-verified route. Never pass an unvalidated browser JSON object.
  async recordPreparation({orderId,revision,eventId,actorId,shipment}) {
   if(typeof actorId!=='string'||!actorId.trim()) throw Error('Verified administrator required');
   return withTransaction(async tx=>{
    const {rows}=await tx.query(`select j.state from rho_pickup.jobs j
     join qw10_test.purchase_orders o on o.id::text=j.order_id
     join qw10_test.requests r on r.id=o.request_id and r.session_id=o.session_id
     join qw10_test.receipts p on p.request_id=r.id and p.session_id=o.session_id
     join qw10_test.preparation_events e on e.request_id=r.id and e.action='prepare' and e.actor=$3
     where j.environment=$1 and j.order_id=$2 and r.owner_id=$3 and r.livemode=false
      and p.state='paid' and p.amount_cents=r.total_cents
      and not exists(select 1 from qw10_test.preparation_events d where d.request_id=r.id and d.action='dispatch')
     for update of j`,[environment,orderId,actorId]);
    if(rows.length!==1) throw Error('Verified paid preparation required');
    return apply(tx,rows[0].state,{id:eventId,type:'package_prepared',orderId,revision,environment,actorId,shipment});
   });
  },
  async list({status,limit=100}) {
   if(typeof status!=='string'||!Number.isInteger(limit)||limit<1||limit>500) throw Error('Invalid queue filter');
   return withTransaction(async tx=>(await tx.query(`select state,version,updated_at from rho_pickup.jobs
    where environment=$1 and state->>'status'=$2 order by updated_at,job_key limit $3`,[environment,status,limit])).rows);
  }
 };
}
