import test from 'node:test';
import assert from 'node:assert/strict';
import {transferContact, transferMessage} from '../transfer-request-model.js';
import {calculateQuote} from '../quote-model.js';

const input={name:'Cliente de prueba',phone:'+52 55 0000 0000',email:'cliente@example.test',company:'Empresa de prueba',destination:'cdmx',postal:'02000',municipality:'Azcapotzalco',settlement:'Colonia de prueba',street:'Calle de prueba',exterior:'123',interior:'4',notes:'Referencia ficticia',invoice:true};
const catalog=[{sku:'fixture',name:'Artículo de prueba',unit:'pieza',unitCents:21050,stock:4}];
const contact=transferContact(input);
test('Conserva contacto y dirección; rechaza datos incompletos y destino incoherente',()=>{
 assert.equal(contact.state,'Ciudad de México');assert.equal(contact.invoice,true);
 for(const patch of [{phone:'123'},{name:' '},{postal:'75000'},{postal:'abcde'},{street:' '},{destination:'other',state:''},{email:'correo-invalido'}]) assert.throws(()=>transferContact({...input,...patch}));
 assert.equal(transferContact({...input,destination:'other',state:'Puebla',postal:'72000'}).state,'Puebla');
});
test('El ejemplo de carrito 210.50 suma 99 de envío sin duplicar el IVA',()=>{
 const q=calculateQuote([{sku:'fixture',quantity:1}],catalog,{registered:true,paymentMethod:'transfer',coverage:'cdmx'});
 assert.equal(q.productsCents,21050);assert.equal(q.shipping.totalCents,30950);
 const message=transferMessage(q,contact);
 for(const text of ['Total estimado: $309.50','Productos con IVA: $210.50','CP 02000','Requiere factura: sí','no reserva mercancía','recepción del dinero'])assert.ok(message.includes(text));
 assert.ok(!message.includes('CLABE'));assert.ok(!message.includes('Pago confirmado'));
});
test('La falta de registro o cobertura mantiene el envío pendiente',()=>{
 for(const options of [{registered:false,coverage:'cdmx'},{registered:true,coverage:'other'}]){
  const q=calculateQuote([{sku:'fixture',quantity:2}],catalog,{...options,paymentMethod:'transfer'});
  assert.equal(q.shipping.totalCents,null);
  assert.match(transferMessage(q,contact),/Total estimado: por confirmar/);
 }
});
test('No se prepara una solicitud ordinaria con faltantes o stock desconocido',()=>{
 for(const stock of [0,null]){
  const q=calculateQuote([{sku:'fixture',quantity:1}],[{...catalog[0],stock}],{registered:true,paymentMethod:'transfer',coverage:'cdmx'});
  assert.throws(()=>transferMessage(q,contact));
 }
});
test('Un beneficio estimado nunca se presenta como un pago acreditado',()=>{
 const q=calculateQuote([{sku:'fixture',quantity:2}],catalog,{registered:true,paymentMethod:'transfer',coverage:'cdmx'});
 assert.equal(q.shipping.shippingCents,0);assert.equal(q.shipping.totalCents,42100);
 assert.match(transferMessage(q,contact),/sujeto a validación/);
});
