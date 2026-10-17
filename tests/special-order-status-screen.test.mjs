import {test} from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {specialOrderMessage} from '../special-order-preview.js';
import {readFile} from 'node:fs/promises';
const source=(await readFile(new URL('../pedido-especial-estado.js',import.meta.url),'utf8')).replace(/^import .*;\n/gm,'');
const reference='test-special-fb1dc793-a070-4133-9b7d-6d88758e46d2';
async function render({state='expired',code=null,changes={},ownerChanges=false}={}){
 const nodes=new Map();const node=id=>{if(!nodes.has(id))nodes.set(id,{hidden:true,value:reference,textContent:'',addEventListener(event,fn){this.submit=fn;}});return nodes.get(id)};
 let sessions=0;const calls=[];
 const supabase={auth:{getSession:async()=>({data:{session:{user:{id:ownerChanges&&sessions++?'other':'owner'},access_token:'fixture'}}}),onAuthStateChange(){}},functions:{invoke:async(name,args)=>{calls.push({name,args});return code?{error:{context:{status:code}}}:{data:{environment:'test',reference,state,sku:'test-special-module-20261017',requested:3,reserved:1,additional:2,checkedAt:'2026-10-17T17:08:12Z',expiresAt:'2026-10-17T11:45:47Z',...changes}};}}};
 vm.runInNewContext(source,{specialOrderMessage,supabase,document:{getElementById:node},Intl,Date,Number,Object});
 await node('special-query-form').submit({preventDefault(){}});
 assert.equal(calls.length,1);assert.equal(calls[0].name,'test-special-order-status');
 assert.deepEqual(Object.keys(calls[0].args.body).sort(),['environment','reference']);
 assert.equal(node('special-query').disabled,false);return node;
}
test('expired reservation uses server timestamps in CDMX',async()=>{
 const n=await render();assert.equal(n('special-preview').hidden,false);assert.match(n('special-preview-text').value,/reserva vigente al consultar: 0/);assert.match(n('special-query-status').textContent,/vencida: ya no aparta existencias/);assert.match(n('special-query-status').textContent,/5:45:47/);assert.match(n('special-query-status').textContent,/11:08:12/);
});
test('all server states are distinguished',async()=>{
 for(const [state,label] of [['active','vigente'],['quote_only','sin piezas reservadas'],['inactive','no vigente']])assert.ok((await render({state}))('special-query-status').textContent.includes(label));
});
test('authentication, ownership and service errors do not confirm a reservation',async()=>{
 for(const code of [401,404,503]){const n=await render({code});assert.equal(n('special-query-help').hidden,code!==401);assert.doesNotMatch(n('special-query-status').textContent,/Reserva de prueba (vigente|vencida)/);}
});
test('invalid response and changed account cannot display a confirmed state',async()=>{
 for(const options of [{state:'unknown'},{changes:{environment:'live'}},{changes:{reference:'other'}},{changes:{checkedAt:'invalid'}},{ownerChanges:true}])assert.match((await render(options))('special-query-status').textContent,/No se pudo consultar/);
});
