// Convert an operator-supplied official SEPOMEX TXT into an INACTIVE candidate.
// This script does not download, publish, approve or activate coverage.
import {readFile,writeFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {pathToFileURL} from 'node:url';
export function prepareDeliveryCatalog(bytes,{sourceUrl,verifiedAt,validUntil}){
 const source=new URL(sourceUrl);
 if(source.protocol!=='https:'||source.hostname!=='www.correosdemexico.gob.mx'||source.username||source.password)throw Error('Official HTTPS source required');
 const start=Date.parse(verifiedAt),end=Date.parse(validUntil);
 if(!Number.isFinite(start)||!Number.isFinite(end)||end<=start||end-start>90*86400000)throw Error('Invalid catalog validity');
 if(bytes.length>50000000)throw Error('Catalog too large');
 let text;try{text=new TextDecoder('utf-8',{fatal:true}).decode(bytes);}catch{text=new TextDecoder('windows-1252',{fatal:true}).decode(bytes);}
 const lines=text.replace(/^\uFEFF/,'').split(/\r?\n/),header=lines.findIndex(l=>l.startsWith('d_codigo|'));
 if(header<0)throw Error('SEPOMEX header missing');
 const names=lines[header].split('|'),required=['d_codigo','d_asenta','D_mnpio','c_estado','c_mnpio','id_asenta_cpcons'];
 if(new Set(names).size!==names.length||required.some(n=>!names.includes(n)))throw Error('Invalid SEPOMEX columns');
 const entries=[],keys=new Set();
 for(const line of lines.slice(header+1)){
  if(!line.trim())continue;
  const cells=line.split('|');if(cells.length!==names.length)throw Error('Truncated or malformed row');
  const r=Object.fromEntries(names.map((name,i)=>[name,cells[i].trim().normalize('NFC')]));
  if(!/^\d{2}$/.test(r.c_estado))throw Error('Invalid state code');
  if(r.c_estado!=='09')continue;
  if(!/^\d{5}$/.test(r.d_codigo)||!/^\d{3}$/.test(r.c_mnpio)||!/^\d{4}$/.test(r.id_asenta_cpcons)||!r.d_asenta||!r.D_mnpio)throw Error('Invalid CDMX row');
  const key=[r.d_codigo,r.c_mnpio,r.id_asenta_cpcons].join(':');if(keys.has(key))throw Error('Duplicate CDMX settlement');keys.add(key);
  entries.push({postalCode:r.d_codigo,municipalityCode:r.c_mnpio,settlementCode:r.id_asenta_cpcons,municipality:r.D_mnpio,settlement:r.d_asenta});
 }
 if(new Set(entries.map(r=>r.municipalityCode)).size!==16)throw Error('Missing CDMX municipalities');
 entries.sort((a,b)=>JSON.stringify(a).localeCompare(JSON.stringify(b)));
 return {schemaVersion:1,purpose:'candidate',country:'MX',state:'CMX',sourceUrl:source.href,
  sourceSha256:createHash('sha256').update(bytes).digest('hex'),verifiedAt,validUntil,entries};
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){
 const [input,output,sourceUrl,verifiedAt,validUntil]=process.argv.slice(2);
 if(!input||!output||!sourceUrl||!verifiedAt||!validUntil)throw Error('Usage: node scripts/prepare-delivery-catalog.mjs INPUT.txt OUTPUT.json SOURCE_URL VERIFIED_AT VALID_UNTIL');
 const artifact=JSON.stringify(prepareDeliveryCatalog(await readFile(input),{sourceUrl,verifiedAt,validUntil}),null,2)+'\n';
 await writeFile(output,artifact,{flag:'wx'});
 console.log(JSON.stringify({status:'inactive_candidate',rows:JSON.parse(artifact).entries.length,sha256:createHash('sha256').update(artifact).digest('hex')}));
}
