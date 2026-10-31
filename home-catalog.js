import { searchCatalog } from './search-catalog.js?v=20261008-4';

// Discovery modules use the same product names and photographs as site search.
// Prices, stock, variants and cart actions stay in the existing catalog flow.
const groups = [
  { title: 'Equipa tu jornada', subtitle: 'Protección de cabeza a pies', theme: 'navy', ids: ['casco-mundial-infra', 'lentes-al012cl-dermacare', 'guante-japones-latex', 'bota-industrial-dielectrica'] },
  { title: 'Cuida cada sentido', subtitle: 'Protección respiratoria, auditiva y visual', theme: 'green', ids: ['mascarilla-3m-8210-n95', 'tapones-3m-con-cordon', 'tapones-3m-sin-cordon', 'lente-steel-espejeado'] },
  { title: 'Prepara tu operación', subtitle: 'Visibilidad, manos y primeros auxilios', theme: 'orange', ids: ['chaleco-seguridad', 'guante-carnaza-vestimenta', 'guante-limpieza-rudo', 'botiquin-equipado'] }
];
// Compact labels keep the mobile mosaic readable; the complete catalog name
// remains the link's accessible name and is shown in the catalog destination.
const compactNames = {
  'casco-mundial-infra': 'Casco INFRA',
  'lentes-al012cl-dermacare': 'Lentes AL012CL',
  'guante-japones-latex': 'Guante látex',
  'bota-industrial-dielectrica': 'Bota de seguridad',
  'mascarilla-3m-8210-n95': 'N95 3M 8210',
  'tapones-3m-con-cordon': 'Tapones con cordón',
  'tapones-3m-sin-cordon': 'Tapones sin cordón',
  'lente-steel-espejeado': 'Lente Steel',
  'chaleco-seguridad': 'Chaleco',
  'guante-carnaza-vestimenta': 'Guante carnaza',
  'guante-limpieza-rudo': 'Guante uso rudo',
  'botiquin-equipado': 'Botiquín equipado'
};
const mobileProducts = new Set([
  'casco-mundial-infra', 'guante-japones-latex', 'bota-industrial-dielectrica',
  'mascarilla-3m-8210-n95', 'tapones-3m-con-cordon', 'lente-steel-espejeado',
  'chaleco-seguridad', 'guante-carnaza-vestimenta', 'botiquin-equipado'
]);
const node = (tag, className, text) => {
  const element = document.createElement(tag);
  if (className) element.className = className;
  if (text) element.textContent = text;
  return element;
};
const root = document.getElementById('rho-home-modules');
if (root) {
  const catalog = new Map(searchCatalog.map(product => [product.product_id, product]));
  for (const group of groups) {
    const card = node('article', `rho-home-card rho-home-card--${group.theme}`);
    card.append(node('p', 'rho-home-card__eyebrow', group.subtitle), node('h3', '', group.title));
    const grid = node('div', 'rho-home-card__grid');
    for (const id of group.ids) {
      const product = catalog.get(id);
      if (!product) continue;
      const link = node('a', 'rho-home-product');
      if (!mobileProducts.has(id)) link.classList.add('rho-home-product--desktop-only');
      link.href = 'portafolio.html?q=' + encodeURIComponent(product.product_id);
      link.setAttribute('aria-label', product.name);
      link.title = product.name;
      const photo = node('div', 'rho-home-product__photo');
      const img = node('img');
      // Refresh the repaired JPEG in browsers that cached its incomplete version.
      img.src = product.image + (id === 'tapones-3m-con-cordon' ? '&repair=20261031' : '');
      img.alt = ''; img.loading = 'lazy'; img.decoding = 'async';
      img.width = 200; img.height = 160;
      img.addEventListener('error', () => { img.hidden = true; photo.append(node('span', 'rho-home-product__fallback', 'Ver en catálogo')); }, { once: true });
      photo.append(img);
      const shortName = node('span', 'rho-home-product__short-name', compactNames[id] || product.name);
      shortName.setAttribute('aria-hidden', 'true');
      link.append(photo, node('span', 'rho-home-product__name', product.name), shortName, node('span', 'rho-home-product__action', 'Ver artículo →'));
      grid.append(link);
    }
    card.append(grid); root.append(card);
  }
  const controls = document.getElementById('rho-home-controls');
  const previous = controls.querySelector('[data-direction="previous"]');
  const next = controls.querySelector('[data-direction="next"]');
  function update() {
    const max = root.scrollWidth - root.clientWidth;
    controls.hidden = max < 2;
    previous.disabled = root.scrollLeft < 2;
    next.disabled = root.scrollLeft >= max - 2;
  }
  for (const button of [previous, next]) {
    button.addEventListener('click', () => {
      const step = root.firstElementChild.getBoundingClientRect().width + (parseFloat(getComputedStyle(root).columnGap) || 0);
      root.scrollBy({left: button === next ? step : -step, behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'instant' : 'smooth'});
    });
  }
  root.addEventListener('scroll', update, {passive:true});
  window.addEventListener('resize', update); update();
}
