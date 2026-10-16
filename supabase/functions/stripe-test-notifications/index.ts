import Stripe from 'npm:stripe@22.6.0';
import {stripeTestNotification} from '../_shared/stripe-test-notification.js';
// Intentionally separate from the future payment-confirmation endpoint.
Deno.serve(stripeTestNotification({Stripe,
  apiKey:Deno.env.get('STRIPE_TEST_RESTRICTED_KEY'),
  signingSecret:Deno.env.get('STRIPE_TEST_DIAGNOSTIC_SIGNING_SECRET'),
  cryptoProvider:Stripe.createSubtleCryptoProvider()
}));
