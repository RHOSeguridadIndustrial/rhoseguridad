import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {cardPostalOptions} from '../card-postal.js';
const catalog=JSON.parse(readFileSync('assets/postal-cdmx.json','utf8'));
test('02140 resolves Santa Inés using only the public catalog, without credentials',async()=>{
 const options=await cardPostalOptions('02140',async(url,init)=>{
  assert.equal(url,'./assets/postal-cdmx.json?v=20261025');
  assert.equal(init.credentials,'omit');assert.equal(init.headers,undefined);
  return {ok:true,json:async()=>catalog};
 });
 assert.ok(options.some(r=>r.municipality==='Azcapotzalco'&&r.settlement==='Santa Inés'));
 for(const r of options){assert.match(r.municipalityCode,/^\d{3}$/);assert.match(r.settlementCode,/^\d{4}$/);assert.equal(r.postalCode,'02140');}
});
test('invalid, missing and unavailable postal data fail without fabricating coverage',async()=>{
 await assert.rejects(cardPostalOptions('2140',()=>{throw Error('must not fetch');}),/invalid_postal_code/);
 assert.deepEqual(await cardPostalOptions('99999',async()=>({ok:true,json:async()=>catalog})),[]);
 await assert.rejects(cardPostalOptions('02140',async()=>({ok:false})),/postal_catalog_unavailable/);
 await assert.rejects(cardPostalOptions('02140',async()=>({ok:true,json:async()=>({country:'XX'})})),/invalid_postal_catalog/);
});
