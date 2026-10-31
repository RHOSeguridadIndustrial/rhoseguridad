import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile,readdir} from 'node:fs/promises';
import {createPostalHandler} from '../supabase/functions/postal-lookup/handler.js';
import {postalOptions} from '../postal-address-model.js';

const fixture=JSON.parse(await readFile(new URL('./fixtures/postal-examples.json',import.meta.url),'utf8'));
const request=(postalCode,extra={})=>new Request('https://example.test/postal-lookup',{method:'POST',headers:{apikey:'test-public-key'},body:JSON.stringify({postalCode,...extra})});
const handler=createPostalHandler({allowedKey:key=>key==='test-public-key',loadShard:async()=>fixture});
test('CP nacional completa estado, municipio y colonia usando los datos oficiales',async()=>{
 for(const [code,state,municipality,settlement] of [['44100','Jalisco','Guadalajara','Guadalajara Centro'],['50000','México','Toluca','Toluca de Lerdo Centro'],['02140','Ciudad de México','Azcapotzalco','Santa Inés']]){
  const response=await handler(request(code));assert.equal(response.status,200);
  const options=postalOptions(await response.json(),code);assert.equal(options.length,1);
  assert.equal(options[0].state,state);assert.equal(options[0].municipality,municipality);assert.equal(options[0].settlement,settlement);
 }
});
test('CP compartido conserva todas las colonias y devuelve solo ese CP',async()=>{
 const data=await(await handler(request('72000'))).json();
 assert.deepEqual(postalOptions(data,'72000').map(o=>o.settlement),['Puebla Centro','San Francisco']);
 assert.ok(data.options.every(o=>o.postalCode==='72000'));
 assert.equal(data.postcodes,undefined);assert.equal(data.municipalities,undefined);
 assert.throws(()=>postalOptions(data,'64000'));
});
test('CP ausente devuelve lista vacía para permitir captura manual',async()=>{
 assert.deepEqual(postalOptions(await(await handler(request('99999'))).json(),'99999'),[]);
});
test('Rechaza código inválido, parámetros adicionales y llamadas sin clave antes de consultar',async()=>{
 let calls=0;const strict=createPostalHandler({allowedKey:key=>key==='test-public-key',loadShard:async()=>{calls++;return fixture;}});
 for(const code of [2140,'0214','021400','02%40',null])assert.equal((await strict(request(code))).status,400);
 assert.equal((await strict(request('02140',{name:'extra'}))).status,400);
 assert.equal((await strict(new Request('https://example.test'))).status,401);
 assert.equal(calls,0);
});
test('Fallo del catálogo no filtra errores internos',async()=>{
 const failed=createPostalHandler({allowedKey:()=>true,loadShard:async()=>{throw new Error('private-database-error');}});
 const response=await failed(request('64000'));assert.equal(response.status,503);
 assert.deepEqual(await response.json(),{error:'postal_lookup_unavailable'});
});
test('Preflight de navegador es compatible con el cliente de Supabase',async()=>{
 const response=await handler(new Request('https://example.test',{method:'OPTIONS'}));
 assert.equal(response.status,204);assert.match(response.headers.get('access-control-allow-headers'),/apikey/);
});
test('Respuesta postal corrupta no llena domicilio',()=>{
 const option={key:'14139:0001',postalCode:'44100',stateCode:'14',state:'Jalisco',municipality:'Guadalajara',settlement:'Centro'};
 const data={schemaVersion:2,country:'MX',postalCode:'44100',options:[option]};
 for(const patch of [{state:null},{stateCode:'09'},{postalCode:'50000'},{key:'bad'},{municipality:''}])assert.throws(()=>postalOptions({...data,options:[{...option,...patch}]},'44100'));
});
test('Importación nacional: todos los CP son interpretables y hay 32 estados',{skip:!process.env.POSTAL_IMPORT_DIR},async()=>{
 const root=process.env.POSTAL_IMPORT_DIR;let postcodes=0,settlements=0;const states=new Set();
 for(const file of await readdir(root)){
  if(!/^\d{2}\.json$/.test(file))continue;
  const shard=JSON.parse(await readFile(root+'/'+file,'utf8'));
  const serve=createPostalHandler({allowedKey:()=>true,loadShard:async()=>shard});
  for(const code of Object.keys(shard.postcodes)){
   const options=postalOptions(await(await serve(request(code))).json(),code);assert.ok(options.length);
   options.forEach(o=>states.add(o.stateCode));postcodes++;settlements+=shard.postcodes[code].length;
  }
 }
 assert.equal(states.size,32);assert.equal(postcodes,31866);assert.equal(settlements,159437);
});
