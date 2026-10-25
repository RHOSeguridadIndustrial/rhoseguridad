import {createTestCheckout} from '../_shared/create-test-checkout.js';
import {ExpiredTestTransfer} from '../_shared/test-checkout-rpc.js';
export function testCheckoutHandler({authorize,quoteDeps,reserve,loadReservation,bindSession,stripe,configured}) {
 return async req=>{
  const origin=req.headers.get('origin');
  const headers={'Access-Control-Allow-Origin':'https://rhosegind.com','Vary':'Origin',
   'Access-Control-Allow-Headers':'authorization,apikey,content-type,x-client-info',
   'Access-Control-Allow-Methods':'POST,OPTIONS','Cache-Control':'no-store'};
  const respond=(data,status)=>Response.json(data,{status,headers});
  if(origin && origin!=='https://rhosegind.com') return respond({error:'origin_not_allowed'},403);
  if(req.method==='OPTIONS') return new Response(null,{status:204,headers});
  if(req.method!=='POST') return respond({error:'method_not_allowed'},405);
  if(!configured) return respond({error:'test_checkout_disabled'},503);
  const match=/^Bearer (\S+)$/.exec(req.headers.get('authorization')||'');
  const owner=match && await authorize(match[1]);
  if(!owner) return respond({error:'admin_session_required'},401);
  let body;
  try {const raw=await req.text();if(raw.length>20000) throw Error();body=JSON.parse(raw);}
  catch {return respond({error:'invalid_request'},400);}
  if(!['card','transfer'].includes(body?.paymentMethod ?? 'card')) return respond({error:'invalid_payment_method'},400);
  if(body?.environment!=='test' || body?.address?.postalCode!=='02000')
   return respond({error:'test_fixture_required'},400);
  try {
   const result=await createTestCheckout(body,{ownerId:owner,retryKey:body.retryKey,
    stripe,reserve,bindSession,...quoteDeps,loadReservation});
   return respond(result,200);
  } catch(error) {
   if(error instanceof ExpiredTestTransfer && body.paymentMethod==='transfer')
    return respond({error:'test_transfer_expired'},410);
   return respond({error:'test_checkout_not_created'},409);
  }
 };
}

