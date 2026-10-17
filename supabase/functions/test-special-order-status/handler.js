export function specialOrderStatusHandler({authorize,load}){
 return async req=>{
  const headers={'Access-Control-Allow-Origin':'https://rhosegind.com','Vary':'Origin','Access-Control-Allow-Headers':'authorization,apikey,content-type,x-client-info','Access-Control-Allow-Methods':'POST,OPTIONS','Cache-Control':'no-store'};
  const reply=(body,status)=>Response.json(body,{status,headers});
  if(req.headers.get('origin')&&req.headers.get('origin')!=='https://rhosegind.com')return reply({error:'origin_not_allowed'},403);
  if(req.method==='OPTIONS')return new Response(null,{status:204,headers});
  if(req.method!=='POST')return reply({error:'method_not_allowed'},405);
  try{
   const token=/^Bearer (\S+)$/.exec(req.headers.get('authorization')||'');
   const owner=token&&await authorize(token[1]);if(!owner)return reply({error:'admin_session_required'},401);
   const raw=await req.text();if(raw.length>512)return reply({error:'invalid_request'},400);
   let body;try{body=JSON.parse(raw)}catch{return reply({error:'invalid_request'},400)}
   if(body?.environment!=='test'||!/^test-special-[a-f0-9-]{36}$/.test(body.reference||''))return reply({error:'invalid_request'},400);
   const result=await load(owner,body.reference);
   if(!result)return reply({error:'not_found'},404);
   if(result.environment!=='test')throw Error();return reply(result,200);
  }catch{return reply({error:'status_unavailable'},503)}
 };
}
