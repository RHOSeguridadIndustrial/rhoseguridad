import {paymentWebhook} from './payment-webhook.js';
// Connectivity diagnostic only. No database imports, orders or stock writes.
// This endpoint must never be used as the fulfillment webhook.
export function stripeTestNotification({Stripe,apiKey,signingSecret,cryptoProvider}) {
  if (!/^rk_test_/.test(apiKey||'') || !/^whsec_/.test(signingSecret||''))
    return paymentWebhook({configured:false});
  const stripe=new Stripe(apiKey,{apiVersion:'2026-08-26.dahlia',
    httpClient:Stripe.createFetchHttpClient?.(),maxNetworkRetries:2,timeout:10000});
  return paymentWebhook({configured:true,
    verifyEvent:async(raw,signature)=>{
      const event=await stripe.webhooks.constructEventAsync(raw,signature,signingSecret,undefined,cryptoProvider);
      if(event.livemode!==false) throw Error('Only sandbox notifications accepted');
      return event;
    },
    handleEvent:async event=>{
      if(!['checkout.session.completed','checkout.session.async_payment_succeeded'].includes(event.type))
        return {status:'ignored_test_notification'};
      const object=event.data?.object;
      if(object?.object!=='checkout.session' || !/^cs_test_[A-Za-z0-9_]+$/.test(object.id||''))
        throw Error('Invalid test session');
      const session=await stripe.checkout.sessions.retrieve(object.id);
      if(session.id!==object.id || session.livemode!==false || session.mode!=='payment')
        throw Error('Invalid test session state');
      return {status:'verified_test_notification_no_fulfillment'};
    }
  });
}
