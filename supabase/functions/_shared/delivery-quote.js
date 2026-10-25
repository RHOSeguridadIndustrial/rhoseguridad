import {createDeliveryValidator} from './delivery-address.js';
import {quoteCheckout} from './checkout-quote.js';
export class DeliveryValidationError extends Error {
 constructor(code){super(code);this.name='DeliveryValidationError';this.code=code;}
}
// Instantiate with reviewed server configuration. Never pass request data as deps.
// No request, reservation, order, Stripe session or shipment is created here.
export async function createDeliveryQuote({catalogText,pinnedSha256,now,loadVariant,registered=false}={}){
 const validate=await createDeliveryValidator({catalogText,pinnedSha256,now});
 return async input=>{
  const request=structuredClone(input);
  const delivery=validate(request?.address);
  if(delivery.status!=='postal_match')throw new DeliveryValidationError(delivery.status);
  const quote=await quoteCheckout(request,{loadVariant,registered,validateCoverage:async()=>true});
  if(validate(request.address).status!=='postal_match')throw new DeliveryValidationError('coverage_unavailable');
  return {...quote,delivery};
 };
}
