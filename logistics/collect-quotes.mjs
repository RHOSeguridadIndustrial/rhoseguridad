import {selectProvider} from './select-provider.mjs';

// Server-side adapters expose quote(order,{signal}) and return normalized quotes.
// They must verify service rules, costs, coverage and operator approval before
// returning. This coordinator has no booking method and performs no retries.
export async function collectQuotes({order,policy,adapters,timeoutMs=5000,signal,now=Date.now}) {
 if(!Array.isArray(adapters)||adapters.length<1||adapters.length>5||
    !Number.isInteger(timeoutMs)||timeoutMs<1||timeoutMs>30000||typeof now!=='function')
  throw Error('Invalid quotation configuration');
 const ids=new Set();
 for(const a of adapters) {
  if(typeof a?.id!=='string'||!a.id.trim()||ids.has(a.id)||typeof a.quote!=='function')
   throw Error('Invalid or duplicate quotation adapter');
  ids.add(a.id);
 }
 // Fail before sharing an address with a provider when the order cannot ship.
 const preflight=selectProvider(order,[],policy,now());
 if(preflight.reason!=='no_eligible_provider') return {decision:preflight,sources:[],quotes:[]};
 if(signal?.aborted) return {decision:{status:'review_required',reason:'quotation_cancelled'},sources:[],quotes:[]};
 const results=await Promise.all(adapters.map(async a=>{
  const controller=new AbortController();let timer,abortHandler;
  const stopped=new Promise(resolve=>{
   const stop=status=>{resolve({source:a.id,status,quotes:[]});controller.abort();};
   timer=setTimeout(()=>stop('timeout'),timeoutMs);
   abortHandler=()=>stop('cancelled');
   signal?.addEventListener('abort',abortHandler,{once:true});
   if(signal?.aborted)abortHandler();
  });
  const task=Promise.resolve().then(()=>{
   if(controller.signal.aborted)return [];
   return a.quote(structuredClone(order),{signal:controller.signal});
  }).then(quotes=>{
   if(!Array.isArray(quotes)||quotes.length>100||quotes.some(q=>!q||q.quoteSourceId!==a.id))
    return {source:a.id,status:'invalid_response',quotes:[]};
   // Source responses cannot change the canonical order/revision/environment.
   if(quotes.some(q=>q.orderId!==order.id||q.shipmentRevision!==order.shipmentRevision||q.environment!==order.environment))
    return {source:a.id,status:'invalid_response',quotes:[]};
   return {source:a.id,status:'ok',quotes:structuredClone(quotes)};
  }).catch(()=>({source:a.id,status:'unavailable',quotes:[]}));
  try {return await Promise.race([task,stopped]);}
  finally {clearTimeout(timer);signal?.removeEventListener('abort',abortHandler);}
 }));
 const sources=results.map(({source,status,quotes})=>({source,status,count:quotes.length}));
 const quotes=results.flatMap(r=>r.quotes);
 if(signal?.aborted) return {decision:{status:'review_required',reason:'quotation_cancelled'},sources,quotes:[]};
 if(results.some(r=>r.status!=='ok')) {
  // Do not claim the cheapest option when a configured source is missing.
  return {decision:{status:'review_required',reason:'incomplete_comparison'},sources,quotes};
 }
 return {decision:selectProvider(order,quotes,policy,now()),sources,quotes};
}
