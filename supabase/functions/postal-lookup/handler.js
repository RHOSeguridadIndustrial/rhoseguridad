const cors = {'Access-Control-Allow-Origin':'*','Access-Control-Allow-Headers':'authorization, x-client-info, apikey, content-type','Access-Control-Allow-Methods':'POST, OPTIONS'};
const json = (value,status=200)=>new Response(JSON.stringify(value),{status,headers:{...cors,'Content-Type':'application/json','Cache-Control':'no-store'}});

// API-key verification is performed here; JWT verification is not used for this
// public geography endpoint. No user identity, address, or order is stored.
export function createPostalHandler({allowedKey,loadShard}) {
  return async request=>{
    if(request.method==='OPTIONS')return new Response(null,{status:204,headers:cors});
    if(!allowedKey(request.headers.get('apikey')))return json({error:'unauthorized'},401);
    if(request.method!=='POST')return json({error:'method_not_allowed'},405);
    let code;
    try {
      if(Number(request.headers.get('content-length'))>256)return json({error:'invalid_request'},400);
      const body=await request.text();if(body.length>256)return json({error:'invalid_request'},400);
      const parsed=JSON.parse(body);code=parsed?.postalCode;
      if(typeof code!=='string'||!/^\d{5}$/.test(code)||Object.keys(parsed).some(key=>key!=='postalCode'))return json({error:'invalid_postal_code'},400);
    } catch{return json({error:'invalid_request'},400);}
    try {
      const shard=await loadShard(code.slice(0,2));
      const rows=shard?.postcodes?.[code]||[];
      const options=rows.map(([municipalityCode,settlementCode,settlement])=>({key:municipalityCode+':'+settlementCode,postalCode:code,stateCode:municipalityCode.slice(0,2),state:shard.states[municipalityCode.slice(0,2)],municipality:shard.municipalities[municipalityCode],settlement}));
      return json({schemaVersion:2,country:'MX',postalCode:code,sourceUpdatedOn:shard?.sourceUpdatedOn||null,options});
    } catch{return json({error:'postal_lookup_unavailable'},503);}
  };
}
