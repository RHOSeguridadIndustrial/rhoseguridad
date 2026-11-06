import Stripe from 'npm:stripe@22.6.0';
import {createClient} from 'npm:@supabase/supabase-js@2.112.4';
import {cardCheckoutHandler} from './handler.js';
import {cardCheckoutRpc} from '../_shared/card-checkout-rpc.js';
import {createDeliveryValidator} from '../_shared/delivery-address.js';
import {createDeliveryQuote} from '../_shared/delivery-quote.js';
const url=Deno.env.get('SUPABASE_URL')||'';
const serviceKey=Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')||'';
const publicKey=Deno.env.get('SUPABASE_ANON_KEY')||'';
const stripeKey=Deno.env.get('STRIPE_LIVE_RESTRICTED_KEY')||'';
const signingSecret=Deno.env.get('STRIPE_LIVE_ORDERS_SIGNING_SECRET')||'';
const configured=Deno.env.get('CARD_PAYMENTS_ENABLED')==='true'&&Boolean(url&&serviceKey&&publicKey)&&
 /^rk_live_/.test(stripeKey)&&/^whsec_/.test(signingSecret);
const service=url&&serviceKey?createClient(url,serviceKey,{auth:{persistSession:false,autoRefreshToken:false}}):null;
const persistence=service?cardCheckoutRpc(service):null;
Deno.serve(cardCheckoutHandler({configured,persistence,
 stripe:configured?new Stripe(stripeKey,{apiVersion:'2026-08-26.dahlia',maxNetworkRetries:2,timeout:10000,
  httpClient:Stripe.createFetchHttpClient()}):null,
 authorize:async(jwt:string)=>{
  const caller=createClient(url,publicKey,{global:{headers:{Authorization:`Bearer ${jwt}`}},
   auth:{persistSession:false,autoRefreshToken:false}});
  const {data,error}=await caller.rpc('card_checkout_identity');
  return !error&&typeof data==='string'&&/^[a-f0-9-]{36}$/.test(data)?data:null;
 },
 loadDelivery:async()=>{
  const config=await persistence!.configuration();
  if(config?.enabled!==true)return null;
  const validate=await createDeliveryValidator(config);
  if(!validate.lookup)return null;
  return {lookup:validate.lookup,quote:await createDeliveryQuote({...config,registered:true,
   loadVariant:persistence!.loadVariant})};
 }
}));
