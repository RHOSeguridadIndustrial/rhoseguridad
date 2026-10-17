// Draft: text preview only. Does not open WhatsApp, reserve stock, or send messages.
export function specialOrderMessage(result){
 if(result?.environment!=='test'||!/^test-special-[a-f0-9-]{36}$/.test(result.reference||'')||!/^[a-z0-9][a-z0-9-]{1,119}$/.test(result.sku||'')||!['active','expired','inactive','quote_only'].includes(result.state)||![result.requested,result.reserved,result.additional].every(Number.isSafeInteger)||result.requested<1||result.reserved<0||result.additional<0||result.reserved+result.additional!==result.requested)throw Error('Invalid test result');
 if(!Number.isFinite(Date.parse(result.checkedAt)))throw Error('Missing server verification');
 const active=result.state==='active';
 return ['PRUEBA · Sin compra, cobro ni entrega real.',`Referencia: ${result.reference}`,`SKU: ${result.sku}`,`Cantidad solicitada: ${result.requested}`,`Piezas con reserva vigente al consultar: ${active?result.reserved:0}`,`Adicionales de la solicitud original por cotizar: ${result.additional}`,
 active?'La reserva está sujeta a su vencimiento.': 'La solicitud no tiene reserva vigente. Es necesario confirmar nuevamente la disponibilidad.',
 'Solicito cotización de pedido especial con descuento adicional, precio final y fecha de entrega.',
 'Este texto no confirma una compra ni renueva la reserva.'].join('\n');
}
