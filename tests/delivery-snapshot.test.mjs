import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {deliverySnapshot,deliverySnapshotText} from '../delivery-snapshot.js';
import {transferRecord,transferList} from '../test-transfer-model.js';
const frozen=JSON.parse(await readFile(new URL('./fixtures/delivery-snapshot.json',import.meta.url),'utf8'));
const row=delivery=>({requestId:'fixture-a',totalCents:12370,expiresAt:1892896885,expired:false,state:'awaiting_confirmation',orderId:null,receiptReference:null,recordedAt:null,preparation:'none',items:[{sku:'fixture-a',name:'Item',quantity:1,unitPriceCents:2470,lineTotalCents:2470}],delivery});
test('frozen postal address stays readable after catalog expiry without claiming new coverage',()=>{
 const copy=structuredClone(frozen);assert.deepEqual(deliverySnapshot(frozen),frozen.address);
 assert.equal(deliverySnapshotText(frozen),'Domicilio de prueba: Calle Ficticia 123 · Interior 2, Centro de Azcapotzalco, Azcapotzalco, CP 02000. Referencias: Portón ficticio azul. Coincidencia postal guardada al cotizar; sin entrega real.');
 assert.deepEqual(frozen,copy);transferRecord(row(frozen));
});
test('legacy quick tests are explicitly missing an address, rather than inventing one',()=>{
 for(const x of [null,undefined]){assert.equal(deliverySnapshot(x),null);assert.match(deliverySnapshotText(x),/sin domicilio postal registrado/);transferRecord(row(x));}
});
test('malformed or contradictory postal evidence blocks the full transfer report',()=>{
 const changes=[{status:'physical_verified'},{assurance:'carrier_approved'},{catalogSha256:'wrong'},{sourceSha256:null},
 {validUntil:frozen.verifiedAt},{verifiedAt:'invalid'},{validUntil:'2030-01-01T00:00:00Z'},
 ...[{street:'<script>'},{reference:'x\u202ey'},{municipality:'<img>'},{settlement:''},{postalCode:2000},{municipalityCode:'001'},{street:'  unnormalized  '},{exterior:''}].map(x=>({address:{...frozen.address,...x}}))];
 for(const change of changes){const bad={...frozen,...change};assert.throws(()=>deliverySnapshotText(bad));assert.throws(()=>transferList({environment:'test',limited:false,transfers:[row(bad)]}));}
});
