// Compatibility for older cached consumers; fixed special-order panels are removed.
export function addSpecialOrderMessage(card) {
  card.querySelectorAll('.rho-special-order').forEach(node => node.remove());
}
