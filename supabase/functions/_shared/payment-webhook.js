// Adapter uses Stripe SDK constructEventAsync on the unchanged request body.
export function paymentWebhook({verifyEvent,handleEvent,configured=false}) {
  return async req=>{
    if(req.method!=='POST') return Response.json({error:'method_not_allowed'},{status:405});
    if(!configured) return Response.json({error:'payment_not_configured'},{status:503});
    const signature=req.headers.get('stripe-signature');
    if(!signature) return Response.json({error:'invalid_signature'},{status:400});
    let event;
    try {event=await verifyEvent(await req.text(),signature);}
    catch {return Response.json({error:'invalid_signature'},{status:400});}
    try {
      const result=await handleEvent(event);
      return Response.json({received:true,status:result.status});
    } catch {
      // Never acknowledge an uncommitted payment; Stripe retries on non-2xx.
      return Response.json({error:'confirmation_failed'},{status:500});
    }
  };
}
