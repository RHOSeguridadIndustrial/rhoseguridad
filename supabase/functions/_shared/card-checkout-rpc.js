// Service client only. No credential or payment state is provided by the browser.
export function cardCheckoutRpc(service) {
  const rpc = async(name,parameters={})=>{
    const {data,error}=await service.rpc(name,parameters);
    if(error) throw Error('Card database unavailable');
    return data;
  };
  const requireLive = value=>{if(value.livemode!==true)throw Error('Live payment required');};
  return {
    configuration:()=>rpc('card_checkout_config'),
    loadVariant:sku=>rpc('card_checkout_variant',{p_sku:sku}),
    loadReservation:({ownerId,retryKey})=>rpc('card_checkout_load',{p_owner:ownerId,p_retry:retryKey}),
    reserve:value=>{
      requireLive(value);
      if(value.environment!=='live'||value.integrationVersion!=='card-checkout-v1')throw Error('Live reservation required');
      return rpc('card_checkout_reserve',{p_owner:value.ownerId,p_retry:value.retryKey,
        p_quote:value.quote,p_identity:value.checkoutIdentity});
    },
    bindSession:value=>{
      requireLive(value);
      return rpc('card_checkout_bind',{p_request:value.requestId,p_owner:value.ownerId,p_session:value.sessionId});
    },
    loadRequest:sessionId=>rpc('card_checkout_load_payment',{p_session:sessionId}),
    commitPaid:value=>{
      requireLive(value);
      return rpc('card_checkout_commit',{p_request:value.requestId,p_session:value.sessionId,
        p_payment:value.paymentIntentId,p_amount:value.amountCents,p_currency:value.currency,p_event:value.eventId});
    }
  };
}
