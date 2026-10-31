const money = cents => new Intl.NumberFormat('es-MX', {style:'currency', currency:'MXN'}).format(cents / 100);
const clean = (value, max) => String(value || '').replace(/[\r\n\t]+/g, ' ').trim().slice(0, max);

export function transferContact(values) {
  const data = Object.fromEntries(Object.entries({name:100,phone:25,email:160,company:120,postal:5,state:80,municipality:100,settlement:100,street:120,exterior:20,interior:20,notes:240}).map(([key,max])=>[key,clean(values[key],max)]));
  data.destination = values.destination;
  data.invoice = values.invoice === true;
  if (data.name.length < 2) throw new Error('Escribe tu nombre completo.');
  const phone = data.phone.replace(/[\s()+.-]/g,'');
  if (!/^(?:52)?\d{10}$/.test(phone)) throw new Error('Revisa tu teléfono: usa 10 dígitos o +52 seguido de 10 dígitos.');
  if (data.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(data.email)) throw new Error('Revisa el correo electrónico.');
  if (!['cdmx','other'].includes(data.destination)) throw new Error('Selecciona el destino.');
  if (!/^\d{5}$/.test(data.postal)) throw new Error('Escribe un código postal de 5 dígitos.');
  // A syntactic CDMX postal range is only an input check, never delivery verification.
  if (data.destination === 'cdmx' && (Number(data.postal) < 1000 || Number(data.postal) >= 17000)) throw new Error('Revisa el código postal y el destino: no corresponde al rango de CDMX.');
  data.state = data.destination === 'cdmx' ? 'Ciudad de México' : data.state;
  if (['state','municipality','settlement','street','exterior'].some(key=>!data[key])) throw new Error('Completa el domicilio de entrega.');
  return data;
}

export function deliveryText(contact) {
  return `${contact.street} ${contact.exterior}${contact.interior ? ', interior '+contact.interior : ''}, ${contact.settlement}, ${contact.municipality}, ${contact.state}, CP ${contact.postal}`;
}

export function transferMessage(quote, contact) {
  if (!quote?.lines?.length || quote.specialOrder || quote.stockUnknown) throw new Error('Confirma las existencias con RHO antes de continuar.');
  return [
    'Hola RHO, quiero solicitar una compra por transferencia bancaria.',
    `Nombre: ${contact.name}`, `Teléfono: ${contact.phone}`,
    contact.email && `Correo: ${contact.email}`, contact.company && `Empresa: ${contact.company}`,
    '', 'Artículos solicitados:',
    ...quote.lines.map(line=>`${line.quantity} ${line.unit === 'par' ? 'par(es)' : 'pieza(s)'} · ${line.name} (${line.sku}) · ${money(line.unitCents)} c/u · ${money(line.amountCents)}`),
    `Productos con IVA: ${money(quote.productsCents)} MXN`,
    `Envío estimado: ${quote.shipping.shippingCents === null ? 'por confirmar' : money(quote.shipping.shippingCents)+' MXN'}`,
    `Total estimado: ${quote.shipping.totalCents === null ? 'por confirmar' : money(quote.shipping.totalCents)+' MXN'}`,
    quote.shipping.status === 'eligible' && 'Beneficio de envío estimado con registro RHO, sujeto a validación.',
    '', `Entrega solicitada: ${deliveryText(contact)}`,
    contact.notes && `Referencias: ${contact.notes}`,
    `Requiere factura: ${contact.invoice ? 'sí' : 'no'}`,
    '', 'Solicito confirmar existencias, cobertura, envío, total final y fecha de entrega, y después recibir los datos bancarios y referencia para transferir.',
    'Esta solicitud no reserva mercancía ni confirma un pedido o pago. El pago quedará pendiente hasta que RHO confirme la recepción del dinero.'
  ].filter(line=>line !== false).join('\n');
}
