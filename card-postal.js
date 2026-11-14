import {postalOptions} from './postal-address-model.js?v=20261031-mx';

// Public address suggestions only. The authenticated quote still validates
// these codes against the server's pinned, current delivery catalog.
export async function cardPostalOptions(code, fetcher=fetch) {
 if(!/^\d{5}$/.test(code))throw Error('invalid_postal_code');
 const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),10000);
 try{
  const response=await fetcher('./assets/postal-cdmx.json?v=20261025',{credentials:'omit',signal:controller.signal});
  if(!response.ok)throw Error('postal_catalog_unavailable');
  return postalOptions(await response.json(),code).map(row=>({
   postalCode:code,municipalityCode:row.key.slice(2,5),settlementCode:row.key.slice(6),
   municipality:row.municipality,settlement:row.settlement
  }));
 }finally{clearTimeout(timer);}
}
