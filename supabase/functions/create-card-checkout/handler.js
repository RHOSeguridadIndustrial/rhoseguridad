import {createCardCheckout,quoteCardCheckout} from '../_shared/create-card-checkout.js';
const origins=new Set(['https://rhosegind.com','https://www.rhosegind.com']);
export function cardCheckoutHandler({configured=false,authorize,loadDelivery,stripe,persistence}) {
  return async request=>{
    const origin=request.headers.get('origin');
    const headers={'Access-Control-Allow-Origin':origins.has(origin)?origin:'https://rhosegind.com',
      Vary:'Origin','Access-Control-Allow-Headers':'authorization,apikey,content-type,x-client-info',
      'Access-Control-Allow-Methods':'POST,OPTIONS','Cache-Control':'no-store'};
    const reply=(body,status)=>Response.json(body,{status,headers});
    if(origin&&!origins.has(origin))return reply({error:'origin_not_allowed'},403);
    if(request.method==='OPTIONS')return new Response(null,{status:204,headers});
    if(request.method!=='POST')return reply({error:'method_not_allowed'},405);
    if(configured!==true)return reply({error:'card_checkout_disabled'},503);
    const jwt=/^Bearer (\S+)$/.exec(request.headers.get('authorization')||'')?.[1];
    let owner;
    try{owner=jwt&&await authorize(jwt);}catch{}
    if(!owner)return reply({error:'customer_session_required'},401);
    let body;
    try{
      const raw=await request.text();if(raw.length>20000)throw Error();body=JSON.parse(raw);
      if(!body||Array.isArray(body)||typeof body!=='object')throw Error();
    }catch{return reply({error:'invalid_request'},400);}
    if(body.environment!==undefined&&body.environment!=='live')return reply({error:'invalid_environment'},400);
    if(!['postal_lookup','quote','create'].includes(body.action))return reply({error:'invalid_action'},400);
    let delivery;
    try{delivery=await loadDelivery();}catch{}
    if(!delivery)return reply({error:'card_checkout_unavailable'},503);
    if(body.action==='postal_lookup'){
      const value=delivery.lookup(body.postalCode);
      return reply(value,value.status==='invalid_address'?400:value.status==='coverage_unavailable'?503:200);
    }
    try{
      if(body.action==='quote')return reply(await quoteCardCheckout(body,{quoteBuilder:delivery.quote}),200);
      return reply(await createCardCheckout(body,{...persistence,enabled:true,ownerId:owner,
        retryKey:body.retryKey,stripe,quoteBuilder:delivery.quote}),200);
    }catch(error){
      if(['invalid_address','outside_coverage','coverage_unavailable'].includes(error?.code))
        return reply({error:error.code},error.code==='coverage_unavailable'?503:422);
      if(error?.message==='Card total changed')return reply({error:'card_total_changed'},409);
      return reply({error:'card_checkout_not_created'},409);
    }
  };
}
