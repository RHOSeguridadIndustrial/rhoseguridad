// Retired public verifier. Payment writes belong only to signed webhooks;
// customers read their own purchase through card_checkout_status.
export function retiredCardVerification(request){
 const origin=request.headers.get('origin'),allowed=new Set(['https://rhosegind.com','https://www.rhosegind.com']);
 const headers={'Access-Control-Allow-Origin':allowed.has(origin)?origin:'https://rhosegind.com',Vary:'Origin',
  'Access-Control-Allow-Headers':'authorization,apikey,content-type,x-client-info','Access-Control-Allow-Methods':'POST,OPTIONS','Cache-Control':'no-store'};
 if(origin&&!allowed.has(origin))return Response.json({error:'origin_not_allowed'},{status:403,headers});
 if(request.method==='OPTIONS')return new Response(null,{status:204,headers});
 return Response.json({error:'legacy_payment_verification_retired'},{status:410,headers});
}
