import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {postalOptions} from '../postal-address-model.js';
const catalog=JSON.parse(await readFile(new URL('../assets/postal-cdmx.json',import.meta.url),'utf8'));
test('02140 conserva el cero inicial y resuelve Santa Inés, Azcapotzalco',()=>{
 const options=postalOptions(catalog,'02140');assert.equal(options.length,1);
 assert.deepEqual(options[0],{key:'002:0392',postalCode:'02140',municipality:'Azcapotzalco',settlement:'Santa Inés'});
});
test('Un CP compartido ofrece todas las colonias sin elegir por el cliente',()=>{
 const options=postalOptions(catalog,'02010');
 assert.deepEqual(options.map(option=>option.settlement),['Los Reyes','Nuevo Barrio San Rafael','San Rafael']);
 assert.ok(options.every(option=>option.municipality==='Azcapotzalco'));
});
test('El catálogo cubre las 16 alcaldías y todas sus entradas son interpretables',()=>{
 assert.equal(Object.keys(catalog.municipalities).length,16);
 for(const code of Object.keys(catalog.postcodes))assert.ok(postalOptions(catalog,code).length>0);
});
test('Un CP desconocido no produce domicilio inventado',()=>{
 assert.deepEqual(postalOptions(catalog,'99999'),[]);
 for(const input of [2140,'2140','0214a',null,'021400'])assert.throws(()=>postalOptions(catalog,input));
});
test('Una colonia duplicada con otro identificador no duplica opciones visibles',()=>{
 const copy=structuredClone(catalog);copy.postcodes['02140'].push(['002','9999','Santa Inés']);
 assert.equal(postalOptions(copy,'02140').length,1);
});
test('Una respuesta incompleta no ofrece datos de domicilio',()=>{
 for(const patch of [{municipalities:{}},{postcodes:{'02140':[['002','0392',null]]}},{schemaVersion:2}])assert.throws(()=>postalOptions({...catalog,...patch},'02140'));
});
