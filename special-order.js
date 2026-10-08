// Shared customer copy for catalog, search and cart product cards.
export function addSpecialOrderMessage(card, productName, anchor) {
  if (card.querySelector('.rho-special-order')) return;
  if (!document.getElementById('rho-special-order-style')) {
    const style = document.createElement('style');
    style.id = 'rho-special-order-style';
    style.textContent = '.rho-special-order{margin:14px 0;padding:12px;border:1px solid #dce7d5;border-radius:10px;background:#f5f9f1;color:#071a35;font-size:14px;line-height:1.5;overflow-wrap:anywhere}.rho-special-order p{margin:0 0 8px}.rho-special-order a{display:inline-block;color:#235b13;font-weight:700;text-decoration:underline;min-height:24px}';
    document.head.append(style);
  }
  const box = document.createElement('div');
  box.className = 'rho-special-order';
  const title = document.createElement('p');
  const strong = document.createElement('strong');
  strong.textContent = '¿Necesitas más piezas de las disponibles?';
  title.append(strong);
  const copy = document.createElement('p');
  copy.textContent = 'Gestionamos la cantidad adicional como pedido especial con un descuento adicional. Solicita tu cotización por WhatsApp para conocer el precio final y la fecha de entrega.';
  const link = document.createElement('a');
  link.textContent = 'Cotizar pedido especial';
  link.href = 'https://wa.me/525545683441?text=' + encodeURIComponent(`Hola RHO, quisiera cotizar un pedido especial con descuento adicional para: ${productName || 'este artículo'}. Necesito más piezas de las disponibles. ¿Me ayudan a confirmar cantidad, precio final y fecha de entrega?`);
  link.target = '_blank';
  link.rel = 'noopener noreferrer';
  box.append(title, copy, link);
  if (anchor) anchor.after(box); else card.append(box);
}
