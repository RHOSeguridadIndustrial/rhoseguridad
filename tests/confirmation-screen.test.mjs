import {test} from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFile} from 'node:fs/promises';
const source=(await readFile(new URL('../confirmacion-prueba.js',import.meta.url),'utf8')).replace(/^import .*;\n/,'');
async function render(mode,total,shipping,changes={}){
 const nodes=new Map();const node=id=>{if(!nodes.has(id))nodes.set(id,{textContent:'',hidden:true,addEventListener(){},replaceChildren(){}});return nodes.get(id)};
 const quote={currency:'mxn',mode,subtotalCents:total,shippingCents:shipping,totalCents:total+shipping,lines:[{name:'Producto de prueba',quantity:1,unitPriceCents:total,lineTotalCents:total}],...changes};
 const client={auth:{getSession:async()=>({data:{session:{user:{id:'owner'},access_token:'fixture'}}}),onAuthStateChange(fn){fn('INITIAL_SESSION')}},functions:{invoke:async()=>({data:{environment:'test',state:'paid',orderId:'3',quote}})}};
 vm.runInContext(source,vm.createContext({supabase:client,document:{getElementById:node,createElement:()=>({textContent:''})},location:{href:'https://rhosegind.com/confirmacion-prueba.html?session_id=cs_test_fixture'},URL,Intl,Number,setTimeout}));
 await new Promise(r=>setTimeout(r,10));return node;
}
test('paid standard order keeps shipping fee and approved state',async()=>{
 const n=await render('standard',19200,9900);assert.equal(n('result-title').textContent,'Pago de prueba aprobado');assert.equal(n('result-shipping-label').textContent,'Envío estándar simulado');assert.equal(n('result-total').textContent,'$291.00');assert.equal(n('result-detail').hidden,false);
});
test('paid express order renders without changing validated amount',async()=>{
 const n=await render('express',130000,0);assert.equal(n('result-title').textContent,'Pago de prueba aprobado');assert.equal(n('result-shipping-label').textContent,'Envío express simulado');assert.equal(n('result-shipping').textContent,'$0.00');assert.equal(n('result-total').textContent,'$1,300.00');assert.equal(n('result-detail').hidden,false);
});
test('unknown shipping mode and inconsistent totals never approve',async()=>{
 for(const [mode,changes] of [['unknown',{}],['express',{totalCents:1}]]){
  const n=await render(mode,130000,0,changes);assert.equal(n('result-title').textContent,'No se pudo verificar la prueba');assert.equal(n('result-detail').hidden,true);
 }
});
