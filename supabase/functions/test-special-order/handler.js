// Draft endpoint: caller authentication must include administrator MFA.
export function testSpecialOrderHandler({authorize,record}) {
 return async req=>{
  const headers={'Access-Control-Allow-Origin':'https://rhosegind.com','Vary':'Origin','Access-Control-Allow-Headers':'authorization,apikey,content-type,x-client-info','Access-Control-Allow-Methods':'POST,OPTIONS','Cache-Control':'no-store'};
  const reply=(body,status)=>Response.json(body,{status,headers});
  if(req.headers.get('origin')&&req.headers.get('origin')!=='https://rhosegind.com')return reply({error:'origin_not_allowed'},403);
  if(req.method==='OPTIONS')return new Response(null,{status:204,headers});
  if(req.method!=='POST')return reply({error:'method_not_allowed'},405);
  try{
   const token=/^Bearer (\S+)$/.exec(req.headers.get('authorization')||'');
   const owner=token&&await authorize(token[1]);if(!owner)return reply({error:'admin_session_required'},401);
   const raw=await req.text();if(raw.length>1024)return reply({error:'invalid_request'},400);
   let body;try{body=JSON.parse(raw)}catch{return reply({error:'invalid_request'},400)}
   if(body?.environment!=='test'||!/^[a-z0-9][a-z0-9-]{1,119}$/.test(body.sku||'')||!Number.isSafeInteger(body.quantity)||body.quantity<1||body.quantity>1000000||!/^[a-zA-Z0-9_-]{16,100}$/.test(body.retryKey||''))return reply({error:'invalid_request'},400);
   const result=await record(owner,body.retryKey,body.sku,body.quantity);if(result?.environment!=='test')throw Error();return reply(result,200);
  }catch{return reply({error:'special_order_unavailable'},503)}
 };
}
