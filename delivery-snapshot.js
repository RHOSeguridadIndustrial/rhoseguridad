import {normalizeDeliveryAddress} from './supabase/functions/_shared/delivery-address.js';

// Display a frozen server quote. This is not a fresh coverage check or delivery approval.
export function deliverySnapshot(value){
 if(value==null)return null;
 const invalid=()=>{throw Error('Invalid delivery snapshot');};
 const a=value.address;
 if(value.status!=='postal_match'||value.assurance!=='postal_catalog_only'||
  !/^[a-f0-9]{64}$/.test(value.catalogSha256||'')||!/^[a-f0-9]{64}$/.test(value.sourceSha256||'')||
  !a||typeof a!=='object'||Array.isArray(a))invalid();
 const fields=['country','state','postalCode','municipalityCode','settlementCode','street','exterior','interior','reference'];
 const input=Object.fromEntries(fields.map(k=>[k,a[k]])),normalized=normalizeDeliveryAddress(input);
 if(!normalized||fields.some(k=>normalized[k]!==a[k])||Number(a.municipalityCode)<2||Number(a.municipalityCode)>17)invalid();
 const clean=(s,min,max)=>typeof s==='string'&&s.length>=min&&s.length<=max&&
  s.normalize('NFC').trim().replace(/\s+/gu,' ')===s&&!/[\u0000-\u001f\u007f-\u009f<>\u202a-\u202e\u2066-\u2069]/u.test(s);
 if(!clean(a.municipality,2,100)||!clean(a.settlement,1,150))invalid();
 const checked=Date.parse(value.verifiedAt),expires=Date.parse(value.validUntil);
 if(typeof value.verifiedAt!=='string'||typeof value.validUntil!=='string'||!Number.isFinite(checked)||
  !Number.isFinite(expires)||expires<=checked||expires-checked>90*86400000)invalid();
 // Old snapshots remain readable after the catalog expires; no new eligibility is inferred.
 return {...normalized,municipality:a.municipality,settlement:a.settlement};
}

export function deliverySnapshotText(value){
 const a=deliverySnapshot(value);
 if(!a)return 'Prueba rápida sin domicilio postal registrado. No autoriza una entrega real.';
 return `Domicilio de prueba: ${a.street} ${a.exterior}${a.interior?' · Interior '+a.interior:''}, ${a.settlement}, ${a.municipality}, CP ${a.postalCode}.`+
  `${a.reference?' Referencias: '+a.reference+'.':''} Coincidencia postal guardada al cotizar; sin entrega real.`;
}
