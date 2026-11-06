import {paymentWebhook} from './payment-webhook.js';
import {confirmPayment} from './payment-confirmation.js';

// Production composition only. No environment is selected by a request body.
// Deliberately separate from paymentRuntime: test/refund behavior is unchanged.
export function cardPaymentRuntime({Stripe,apiKey,signingSecret,enabled = false,
  loadRequest,commitPaid,cryptoProvider}) {
  const configured = enabled === true && typeof Stripe === 'function' && /^rk_live_\S+$/.test(apiKey || '') &&
    /^whsec_\S+$/.test(signingSecret || '') && typeof loadRequest === 'function' &&
    typeof commitPaid === 'function';
  if (!configured) return paymentWebhook({configured:false});
  const stripe = new Stripe(apiKey,{apiVersion:'2026-08-26.dahlia',maxNetworkRetries:2,timeout:10000});
  return paymentWebhook({configured:true,
    verifyEvent:(raw,signature)=>stripe.webhooks.constructEventAsync(raw,signature,signingSecret,
      undefined,cryptoProvider),
    handleEvent:event=>{
      if (event?.livemode !== true || !/^evt_[A-Za-z0-9_]{1,250}$/.test(event?.id || ''))
        throw Error('Invalid live event');
      return confirmPayment(event,{livemode:true,
        retrieveSession:async id=>{
          if (!/^cs_live_[A-Za-z0-9_]+$/.test(id)) throw Error('Invalid live session');
          const session = await stripe.checkout.sessions.retrieve(id);
          if (session.metadata?.environment !== 'live') throw Error('Invalid live metadata');
          return session;
        },
        loadRequest:async id=>{
          const request = await loadRequest(id);
          if (request?.environment !== 'live' || request.integrationVersion !== 'card-checkout-v1')
            throw Error('Invalid live request');
          return request;
        },
        commitPaid
      });
    }
  });
}
