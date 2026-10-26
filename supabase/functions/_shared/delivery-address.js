// Server-only. The pinned digest comes from deployment configuration, never a request.
// Postal agreement is not proof of a physical address or carrier serviceability.
const fields=['country','state','postalCode','municipalityCode','settlementCode','street','exterior','interior','reference'];
const bad=/[\u0000-\u001f\u007f-\u009f<>\u202a-\u202e\u2066-\u2069]/u;
function clean(value,min,max){
 if(typeof value!=='string'||bad.test(value))return null;
 const text=value.normalize('NFC').trim().replace(/\s+/gu,' ');
 return text.length>=min&&text.length<=max?text:null;
}
export function normalizeDeliveryAddress(input){
 if(!input||typeof input!=='object'||Array.isArray(input)||Object.keys(input).some(k=>!fields.includes(k)))return null;
 if(input.country!=='MX'||input.state!=='CMX'||typeof input.postalCode!=='string'||!/^\d{5}$/.test(input.postalCode)||
  typeof input.municipalityCode!=='string'||!/^\d{3}$/.test(input.municipalityCode)||
  typeof input.settlementCode!=='string'||!/^\d{4}$/.test(input.settlementCode))return null;
 const street=clean(input.street,2,120),exterior=clean(input.exterior,1,20),
  interior=clean(input.interior??'',0,20),reference=clean(input.reference??'',0,240);
 if(street===null||exterior===null||interior===null||reference===null)return null;
 return {country:'MX',state:'CMX',postalCode:input.postalCode,municipalityCode:input.municipalityCode,
  settlementCode:input.settlementCode,street,exterior,interior,reference};
}
const key=r=>[r.postalCode,r.municipalityCode,r.settlementCode].join(':');
export async function createDeliveryValidator({catalogText,pinnedSha256,now=()=>Date.now()}={}){
 const unavailable=()=>({status:'coverage_unavailable'});
 try{
  if(typeof catalogText!=='string'||catalogText.length>4000000||!/^([a-f0-9]{64})$/.test(pinnedSha256||''))return unavailable;
  const bytes=new TextEncoder().encode(catalogText),digest=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',bytes)),b=>b.toString(16).padStart(2,'0')).join('');
  if(digest!==pinnedSha256)return unavailable;
  const catalog=JSON.parse(catalogText),source=new URL(catalog.sourceUrl);
  if(catalog.schemaVersion!==1||catalog.country!=='MX'||catalog.state!=='CMX'||catalog.purpose!=='delivery'||
   source.protocol!=='https:'||source.hostname!=='www.correosdemexico.gob.mx'||source.username||source.password||
   !/^[a-f0-9]{64}$/.test(catalog.sourceSha256||'')||!Array.isArray(catalog.entries)||!catalog.entries.length||catalog.entries.length>10000)return unavailable;
  const checked=Date.parse(catalog.verifiedAt),expires=Date.parse(catalog.validUntil);
  if(!Number.isFinite(checked)||!Number.isFinite(expires)||checked>now()||expires<=checked||expires-checked>90*86400000)return unavailable;
  const entries=new Map(),municipalities=new Map();
  for(const r of catalog.entries){
   if(!r||!/^\d{5}$/.test(r.postalCode||'')||!/^\d{3}$/.test(r.municipalityCode||'')||!/^\d{4}$/.test(r.settlementCode||'')||
    typeof r.postalCode!=='string'||typeof r.municipalityCode!=='string'||typeof r.settlementCode!=='string'||
    Number(r.municipalityCode)<2||Number(r.municipalityCode)>17||clean(r.municipality,2,100)!==r.municipality||
    clean(r.settlement,1,150)!==r.settlement||entries.has(key(r)))return unavailable;
   if(municipalities.has(r.municipalityCode)&&municipalities.get(r.municipalityCode)!==r.municipality)return unavailable;
   municipalities.set(r.municipalityCode,r.municipality);
   entries.set(key(r),{municipality:r.municipality,settlement:r.settlement});
  }
  if(municipalities.size!==16)return unavailable;
  const validate=input=>{
   if(now()<checked||now()>=expires)return unavailable();
   const address=normalizeDeliveryAddress(input);
   if(!address)return {status:'invalid_address'};
   const match=entries.get(key(address));
   if(!match)return {status:'outside_coverage'};
   return {status:'postal_match',assurance:'postal_catalog_only',catalogSha256:digest,sourceSha256:catalog.sourceSha256,
    verifiedAt:catalog.verifiedAt,validUntil:catalog.validUntil,address:{...address,...match}};
  };
  validate.lookup=postalCode=>{
   if(now()<checked||now()>=expires)return unavailable();
   if(typeof postalCode!=='string'||!/^\d{5}$/.test(postalCode))return {status:'invalid_address'};
   const options=catalog.entries.filter(r=>r.postalCode===postalCode).map(r=>({...r}));
   return {status:options.length?'postal_options':'outside_coverage',postalCode,options,catalogSha256:digest};
  };
  return validate;
 }catch{return unavailable;}
}
