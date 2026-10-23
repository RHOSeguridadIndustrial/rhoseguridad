import {paymentWebhook} from './payment-webhook.js';
import {confirmPayment} from './payment-confirmation.js';

// Server-only composition. Database adapter remains a deployment prerequisite.
// Explicit opt-in prevents accidentally activating the legacy payment functions.
export function paymentRuntime({Stripe, apiKey, signingSecret, enabled = false,
  loadRequest, commitPaid, cryptoProvider}) {
  const configured = enabled === true && /^rk_test_/.test(apiKey || '') &&
    /^whsec_/.test(signingSecret || '') && typeof loadRequest === 'function' &&
    typeof commitPaid === 'function';
  if (!configured) return paymentWebhook({configured:false});
  const stripe = new Stripe(apiKey, {apiVersion:'2026-08-26.dahlia',
    maxNetworkRetries:2, timeout:10000});
  return paymentWebhook({configured:true,
    verifyEvent:(raw, signature)=>stripe.webhooks.constructEventAsync(
      raw, signature, signingSecret, undefined, cryptoProvider),
    handleEvent:event=>confirmPayment(event, {
      livemode:false,
      retrieveSession:id=>stripe.checkout.sessions.retrieve(id),
      loadRequest, commitPaid
    })
  });
}

