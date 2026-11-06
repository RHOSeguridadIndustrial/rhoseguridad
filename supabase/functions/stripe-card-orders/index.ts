import Stripe from 'npm:stripe@22.6.0';
import {createClient} from 'npm:@supabase/supabase-js@2.112.4';
import {cardCheckoutRpc} from '../_shared/card-checkout-rpc.js';
import {cardPaymentRuntime} from '../_shared/card-payment-runtime.js';
const url=Deno.env.get('SUPABASE_URL')||'',key=Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')||'';
const service=url&&key?createClient(url,key,{auth:{persistSession:false,autoRefreshToken:false}}):null;
// A checkout shutdown must not stop receipt of already completed payments.
// Receipt processing has a separate explicit gate from new checkout creation.
Deno.serve(cardPaymentRuntime({Stripe,enabled:Deno.env.get('CARD_WEBHOOK_ENABLED')==='true'&&Boolean(service),
 apiKey:Deno.env.get('STRIPE_LIVE_RESTRICTED_KEY'),signingSecret:Deno.env.get('STRIPE_LIVE_ORDERS_SIGNING_SECRET'),
 cryptoProvider:Stripe.createSubtleCryptoProvider(),...(service?cardCheckoutRpc(service):{})}));
