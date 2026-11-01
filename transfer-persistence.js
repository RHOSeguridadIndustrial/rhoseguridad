const tokenSlot='rho-transfer-submit-v1';
let cached;
export function validateReceipt(value) {
  if (!value || !/^SOL-\d{10}$/.test(value.reference) || value.status!=='awaiting_review' || value.payment_status!=='unconfirmed'
    || !Number.isSafeInteger(value.products_cents) || value.products_cents<1 || value.total_cents!==null || value.shipping_cents!==null
    || !Array.isArray(value.items) || !value.items.length || !Number.isFinite(Date.parse(value.created_at))) throw Error('invalid_receipt');
  let sum=0;
  for(const item of value.items){
    if(typeof item.sku!=='string' || typeof item.name!=='string' || !Number.isSafeInteger(item.quantity) || item.quantity<1
      || !Number.isSafeInteger(item.unit_cents) || item.unit_cents<1 || item.amount_cents!==item.unit_cents*item.quantity)throw Error('invalid_receipt');
    sum+=item.amount_cents;
  }
  if(sum!==value.products_cents)throw Error('invalid_receipt');
  return value;
}
export async function submitTransferRequest(client,{owner,contact,items,productsCents}) {
  const body={p_contact:contact,p_items:items,p_expected_cents:productsCents};
  const bytes=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(JSON.stringify({owner,body})));
  const signature=Array.from(new Uint8Array(bytes),b=>b.toString(16).padStart(2,'0')).join('');
  if(!cached){try{cached=JSON.parse(sessionStorage.getItem(tokenSlot));}catch{}}
  if(cached?.signature!==signature || !/^[a-f0-9]{8}(-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i.test(cached?.key||'')){
    cached={signature,key:crypto.randomUUID()};
    // Only a digest and retry UUID. Contact and address never enter browser storage.
    try{sessionStorage.setItem(tokenSlot,JSON.stringify(cached));}catch{}
  }
  const {data:identity,error:identityError}=await client.auth.getUser();
  if(identityError || identity?.user?.id!==owner)throw Error('transfer_auth_required');
  const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),15000);
  try{
    const {data,error}=await client.rpc('submit_transfer_request',{...body,p_key:cached.key}).abortSignal(controller.signal);
    if(error)throw error;
    return validateReceipt(data);
  }finally{clearTimeout(timer);}
}
export function transferError(error){
  const message=String(error?.message||'');
  if(error?.code==='42501'||message.includes('transfer_auth_required'))return 'Inicia sesión en tu cuenta RHO verificada para registrar la solicitud. Si eres administrador, verifica también el autenticador.';
  if(message.includes('transfer_price_changed'))return 'El precio cambió. Actualiza los precios y revisa nuevamente tu solicitud.';
  if(message.includes('transfer_availability_changed'))return 'Cambió la disponibilidad. Actualiza tu carrito antes de continuar.';
  if(message.includes('transfer_rate_limit'))return 'Alcanzaste el límite de solicitudes de esta hora. Consulta tus solicitudes registradas antes de intentar más tarde.';
  if(message.includes('transfer_invalid')||message.includes('transfer_duplicate'))return 'Revisa tus datos y las cantidades del carrito.';
  return 'No pudimos confirmar el registro. Consulta Mis solicitudes o reintenta sin cambiar los datos para evitar duplicados.';
}
