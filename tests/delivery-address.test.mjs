import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {createDeliveryValidator,normalizeDeliveryAddress} from '../supabase/functions/_shared/delivery-address.js';
import {createDeliveryQuote} from '../supabase/functions/_shared/delivery-quote.js';
import {prepareDeliveryCatalog} from '../scripts/prepare-delivery-catalog.mjs';
const day=86400000,at=Date.parse('2026-10-25T00:00:00Z');
// Entirely synthetic records; no test fixture is an operational postal catalog.
const rows=Array.from({length:16},(_,i)=>({postalCode:String(1000+i).padStart(5,'0'),municipalityCode:String(i+2).padStart(3,'0'),settlementCode:'0001',municipality:`Municipio ficticio ${i+2}`,settlement:`Colonia ficticia ${i+2}`}));
const base=()=>({schemaVersion:1,purpose:'delivery',country:'MX',state:'CMX',sourceUrl:'https://www.correosdemexico.gob.mx/SSLServicios/ConsultaCP/CodigoPostal_Exportar.aspx',sourceSha256:'a'.repeat(64),verifiedAt:new Date(at-day).toISOString(),validUntil:new Date(at+day).toISOString(),entries:structuredClone(rows)});
const addr=()=>({country:'MX',state:'CMX',postalCode:'01000',municipalityCode:'002',settlementCode:'0001',street:'Calle Ficticia',exterior:'12 A'});
const digest=s=>createHash('sha256').update(s).digest('hex');
const config=c=>{const catalogText=JSON.stringify(c);return {catalogText,pinnedSha256:digest(catalogText),now:()=>at};};
test('normalizes only text while preserving postal/municipality/settlement zeroes',()=>{
 assert.deepEqual(normalizeDeliveryAddress({...addr(),street:'  Calle   Ficticia  ',interior:' 3 '}),{...addr(),interior:'3',reference:''});
});
for(const [name,patch] of Object.entries({numericPostal:{postalCode:1000},shortPostal:{postalCode:'1000'},stateSpoof:{state:'MEX'},countrySpoof:{country:'US'},missingStreet:{street:''},noExterior:{exterior:''},html:{street:'<img src=x>'},control:{street:'Calle\u0000x'},bidi:{reference:'\u202etest'},huge:{reference:'x'.repeat(241)},clientCoverage:{coverage:true},clientNames:{settlement:'Colonia falsa'},missingMunicipality:{municipalityCode:undefined},wrongSettlement:{settlementCode:1}})){
 test(`invalid address: ${name}`,async()=>{const check=await createDeliveryValidator(config(base()));assert.equal(check({...addr(),...patch}).status,'invalid_address');});
}
test('matches the exact triple; authoritative names and provenance are returned',async()=>{
 const check=await createDeliveryValidator(config(base()));const r=check(addr());
 assert.equal(r.status,'postal_match');assert.equal(r.assurance,'postal_catalog_only');assert.equal(r.address.settlement,rows[0].settlement);assert.equal(r.catalogSha256,config(base()).pinnedSha256);
 for(const patch of [{postalCode:'99999'},{municipalityCode:'003'},{settlementCode:'0002'}])assert.equal(check({...addr(),...patch}).status,'outside_coverage');
});
for(const [name,change] of Object.entries({candidate:c=>c.purpose='candidate',missingMunicipality:c=>c.entries.pop(),duplicate:c=>c.entries.push(c.entries[0]),inconsistentMunicipality:c=>c.entries.push({...c.entries[0],postalCode:'01099',municipality:'Otro nombre'}),badCode:c=>c.entries[0].postalCode=1000,invalidName:c=>c.entries[0].settlement='<b>x</b>',foreignSource:c=>c.sourceUrl='https://example.com/catalog',badDigest:c=>c.sourceSha256='',future:c=>c.verifiedAt=new Date(at+100).toISOString(),longValidity:c=>c.validUntil=new Date(at+100*day).toISOString()})){
 test(`unavailable catalog: ${name}`,async()=>{const c=base();change(c);assert.equal((await createDeliveryValidator(config(c)))(addr()).status,'coverage_unavailable');});
}
test('absent, malformed, tampered, expired or supersized catalog fails closed',async()=>{
 for(const c of [{},{catalogText:'{}',pinnedSha256:'b'.repeat(64)},{catalogText:'{',pinnedSha256:digest('{')},{...config(base()),catalogText:JSON.stringify({...base(),purpose:'candidate'})},{...config(base()),now:()=>at+2*day},{catalogText:'x'.repeat(4000001),pinnedSha256:'a'.repeat(64)}])assert.equal((await createDeliveryValidator(c))(addr()).status,'coverage_unavailable');
 let clock=at;const check=await createDeliveryValidator({...config(base()),now:()=>clock});assert.equal(check(addr()).status,'postal_match');clock=at+day;assert.equal(check(addr()).status,'coverage_unavailable');
});
test('private snapshot cannot be changed through returned results or original config object',async()=>{
 const c=base(),check=await createDeliveryValidator(config(c));c.entries[0].settlement='Changed';check(addr()).address.settlement='Changed';assert.equal(check(addr()).address.settlement,rows[0].settlement);
});
test('delivery quote rejects before loading prices and never trusts client coverage or price',async()=>{
 let loads=0;const loadVariant=async sku=>{loads++;return {sku,active:true,name:'Artículo ficticio',priceCents:2470};};
 const input={items:[{sku:'test-sku',quantity:1}],address:addr(),paymentMethod:'transfer',registered:true,shippingCents:0,coverage:true};
 for(const [cfg,address,code] of [[{},addr(),'coverage_unavailable'],[config(base()),{...addr(),street:''},'invalid_address'],[config(base()),{...addr(),postalCode:'99999'},'outside_coverage']]){
  const quote=await createDeliveryQuote({...cfg,loadVariant,registered:true});await assert.rejects(quote({...input,address}),e=>e.code===code);
 }
 assert.equal(loads,0);
 const quote=await createDeliveryQuote({...config(base()),loadVariant,registered:true}),result=await quote(input);
 assert.equal(result.totalCents,12370);assert.equal(result.delivery.assurance,'postal_catalog_only');assert.equal(result.delivery.address.postalCode,'01000');assert.equal(loads,1);
});
const header='d_codigo|d_asenta|D_mnpio|c_estado|c_mnpio|id_asenta_cpcons';
const source=()=>new TextEncoder().encode('Aviso de origen\r\n'+header+'\r\n'+rows.map(r=>[r.postalCode,r.settlement,r.municipality,'09',r.municipalityCode,r.settlementCode].join('|')).join('\r\n'));
const meta=()=>({sourceUrl:base().sourceUrl,verifiedAt:base().verifiedAt,validUntil:base().validUntil});
test('official-format importer preserves zeroes, source hash and creates only inactive candidates',async()=>{
 const raw=source(),candidate=prepareDeliveryCatalog(raw,meta());assert.equal(candidate.purpose,'candidate');assert.equal(candidate.entries.length,16);assert.equal(candidate.sourceSha256,digest(raw));assert.equal(candidate.entries[0].postalCode,'01000');
 assert.equal((await createDeliveryValidator(config(candidate)))(addr()).status,'coverage_unavailable');
});
test('importer rejects incomplete, duplicate, malformed and nonofficial sources',()=>{
 const raw=new TextDecoder().decode(source());for(const s of [raw.split('\r\n').slice(0,-1).join('\r\n'),raw+'\r\n'+raw.split('\r\n')[2],raw+'\r\ntruncated','not a catalog'])assert.throws(()=>prepareDeliveryCatalog(new TextEncoder().encode(s),meta()));
 assert.throws(()=>prepareDeliveryCatalog(source(),{...meta(),sourceUrl:'https://attacker.example/'}));
});

test('catalog expiring while prices load cannot produce a delivery quote',async()=>{
 let clock=at;const quote=await createDeliveryQuote({...config(base()),now:()=>clock,registered:true,loadVariant:async sku=>{clock=at+day;return {sku,name:'Ficticio',active:true,priceCents:100};}});
 await assert.rejects(quote({items:[{sku:'test-sku',quantity:1}],address:addr(),paymentMethod:'transfer'}),e=>e.code==='coverage_unavailable');
});
