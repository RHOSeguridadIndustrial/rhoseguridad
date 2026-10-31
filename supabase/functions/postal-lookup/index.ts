import {createPostalHandler} from './handler.js';

const publishableKeys=Object.values(JSON.parse(Deno.env.get('SUPABASE_PUBLISHABLE_KEYS')||'{}'));
const legacyAnon=Deno.env.get('SUPABASE_ANON_KEY');
if(legacyAnon)publishableKeys.push(legacyAnon);
const secretKeys=JSON.parse(Deno.env.get('SUPABASE_SECRET_KEYS')||'{}');
const serverKey=secretKeys.default||Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
const cache=new Map();

async function loadShard(prefix:string){
  const cached=cache.get(prefix);
  if(cached&&cached.until>Date.now())return cached.value;
  if(!serverKey)throw new Error('configuration');
  const headers:Record<string,string>={apikey:serverKey};
  if(serverKey.startsWith('eyJ'))headers.Authorization='Bearer '+serverKey;
  const response=await fetch(Deno.env.get('SUPABASE_URL')+'/rest/v1/checkout_postal_catalog?prefix=eq.'+prefix+'&select=compressed_payload,source_updated_on&limit=1',{headers,signal:AbortSignal.timeout(8000)});
  if(!response.ok)throw new Error('catalog_unavailable');
  const [record]=await response.json();
  if(!record)return null;
  const compressed=Uint8Array.from(atob(record.compressed_payload),c=>c.charCodeAt(0));
  const stream=new Blob([compressed]).stream().pipeThrough(new DecompressionStream('gzip'));
  const value=JSON.parse(await new Response(stream).text());
  value.sourceUpdatedOn=record.source_updated_on;
  if(cache.size>=20)cache.delete(cache.keys().next().value);
  cache.set(prefix,{value,until:Date.now()+300000});
  return value;
}

Deno.serve(createPostalHandler({allowedKey:(key:string)=>!!key&&publishableKeys.includes(key),loadShard}));
