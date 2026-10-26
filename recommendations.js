import { supabase } from './supabase-client.js?v=20260913-loyalty';
import { searchCatalog } from './search-catalog.js?v=20261008-3';
import { recommendPurchases } from './recommendation-model.mjs?v=20261025-1';

const root = document.querySelector('[data-purchase-recommendations]');
const node = (tag, className, text) => {
  const element = document.createElement(tag);
  if (className) element.className = className;
  if (text) element.textContent = text;
  return element;
};
let generation = 0;
let owner = null;
let refreshedAt = 0;
let scheduled;
const money = value => new Intl.NumberFormat('es-MX', { style: 'currency', currency: 'MXN' }).format(value);
const date = value => new Intl.DateTimeFormat('es-MX', { day: 'numeric', month: 'short', year: 'numeric' }).format(value);

function shell() {
  root.replaceChildren();
  root.hidden = false;
  root.append(node('span', 'rho-recommendations__eyebrow', 'Recomendaciones para ti'));
  const heading = node('h2', '', 'Tus compras habituales');
  heading.id = 'purchase-recommendations-title';
  root.append(heading);
  root.append(node('p', 'rho-recommendations__intro', 'Encuentra de nuevo lo que compras, según tu historial de los últimos 12 meses.'));
}
function message(text, href, label) {
  shell();
  root.append(node('p', 'rho-recommendations__status', text));
  if (href) {
    const link = node('a', 'rho-recommendations__button', label);
    link.href = href;
    root.append(link);
  }
}
function clear() { generation++; owner = null; root.replaceChildren(); root.hidden = true; }
async function load() {
  const request = ++generation;
  try {
    const { data: { user }, error } = await supabase.auth.getUser();
    if (request !== generation) return;
    if (!user && (!error || error.name === 'AuthSessionMissingError' || error.status === 401)) {
      owner = null;
      message('Inicia sesión para ver los artículos que compras con frecuencia.', 'login.html', 'Iniciar sesión');
      return;
    }
    if (error || !user) throw error || new Error('No session');
    owner = user.id;
    message('Consultando tus compras…');
    const [history, products, inventory] = await Promise.all([
      supabase.rpc('get_my_purchase_history'),
      supabase.from('products').select('id,name,price,currency,is_active').eq('is_active', true),
      supabase.from('inventory_items').select('sku,product_id,name,quantity,unit,state,is_active')
    ]);
    if (request !== generation || owner !== user.id) return;
    if (history.error || products.error || inventory.error) throw new Error('History unavailable');
    if (!Array.isArray(history.data)) throw new Error('Invalid history');
    refreshedAt = Date.now();
    const recommendations = recommendPurchases({ purchases: history.data, products: products.data, inventory: inventory.data, catalog: searchCatalog });
    if (!recommendations.length) {
      message(history.data.length ? 'Por ahora no hay artículos de tus compras disponibles en el catálogo.' : 'Aún no tienes compras confirmadas para personalizar esta sección. Tus artículos aparecerán aquí conforme compres en RHO.', 'portafolio.html', 'Explorar productos');
      return;
    }
    shell();
    const grid = node('div', 'rho-recommendations__grid');
    const live = node('p', 'rho-recommendations__status');
    live.setAttribute('role', 'status');
    live.setAttribute('aria-live', 'polite');
    for (const item of recommendations) {
      const card = node('article', 'rho-recommendations__card');
      const image = node('img'); image.src = item.image || 'assets/rho-image-fallback.svg'; image.alt = item.name; image.loading = 'lazy';
      image.addEventListener('error', () => { image.src = 'assets/rho-image-fallback.svg'; }, { once: true });
      card.append(image, node('h3', '', item.name));
      card.append(node('p', 'rho-recommendations__reason', item.purchaseCount > 1 ? `Lo compraste en ${item.purchaseCount} pedidos` : 'Ya lo compraste'));
      card.append(node('p', 'rho-recommendations__muted', `Última compra: ${date(item.lastBought)}`));
      if (item.intervalDays) card.append(node('p', '', `Sueles comprarlo cada ${item.intervalDays} días aproximadamente.`));
      if (item.due) card.append(node('p', 'rho-recommendations__reason', 'Podría ser momento de reponerlo.'));
      card.append(node('p', 'rho-recommendations__price', `${money(item.price)} MXN`));
      card.append(node('p', 'rho-recommendations__muted', `IVA incluido · Precio por ${item.unit}`));
      const stockText = item.quantity === null ? 'Consulta las opciones y existencias del artículo.' : `Existencias en stock: ${item.quantity} ${item.quantity === 0 ? 'piezas' : item.unit === 'par' ? item.quantity === 1 ? 'par' : 'pares' : item.unit + (item.quantity === 1 ? '' : 's')}`;
      card.append(node('p', 'rho-recommendations__stock', stockText));
      if (item.available && item.sku) {
        const button = node('button', 'rho-recommendations__button', 'Agregar al carrito'); button.type = 'button';
        button.addEventListener('click', async () => {
          button.disabled = true;
          live.textContent = '';
          try {
            const identity = await supabase.auth.getUser();
            if (identity.error || identity.data.user?.id !== user.id || generation !== request) { clear(); scheduleLoad(); return; }
            const [stockNow, priceNow, cart] = await Promise.all([
              supabase.from('inventory_items').select('sku,product_id,quantity,state,is_active').eq('sku', item.sku).maybeSingle(),
              supabase.from('products').select('id,name,price,currency,is_active').eq('id', item.productId).maybeSingle(),
              import('./cart.js?v=20260914-account-isolation')
            ]);
            if (generation !== request) return;
            if (stockNow.error || priceNow.error) throw new Error('Unavailable');
            const stock = stockNow.data, product = priceNow.data;
            const existing = cart.getCart().find(row => row.id === item.sku)?.qty || 0;
            if (!stock?.is_active || stock.state !== 'tracked' || stock.product_id !== item.productId || !Number.isInteger(stock.quantity) || stock.quantity <= existing || !product?.is_active || !(Number(product.price) > 0)) {
              live.textContent = 'Las existencias cambiaron o ya tienes la cantidad disponible en el carrito. Revisa el artículo antes de agregar más.';
              return;
            }
            // Keep the existing cart price resolver in sync with the fresh public price.
            const aliases = JSON.parse(localStorage.getItem('rho-product-price-aliases-v1') || '{}');
            const key = value => value.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
            aliases[key(item.sku)] = Number(product.price); aliases[key(item.name)] = Number(product.price);
            localStorage.setItem('rho-product-price-aliases-v1', JSON.stringify(aliases));
            cart.addToCart({ id: item.sku, name: item.name, price: Number(product.price), image: item.image });
            if ((cart.getCart().find(row => row.id === item.sku)?.qty || 0) <= existing) throw new Error('Cart unavailable');
            live.textContent = `${item.name}: agregado al carrito.`;
          } catch { if (generation === request) live.textContent = 'No pudimos actualizar el carrito. Intenta nuevamente.'; }
          finally { button.disabled = false; }
        });
        card.append(button);
      } else {
        const link = node('a', 'rho-recommendations__button', item.quantity === 0 ? 'Ver artículo' : 'Ver opciones'); link.href = item.href; card.append(link);
      }
      grid.append(card);
    }
    root.append(grid, live, node('p', 'rho-recommendations__footer', 'Basado en tus compras confirmadas. La frecuencia es una estimación; precios y existencias se verifican al agregar al carrito.'));
  } catch {
    if (request !== generation) return;
    message('No pudimos consultar tus compras. Puedes reintentar o continuar explorando los productos.', 'portafolio.html', 'Ver productos');
    const retry = node('button', 'rho-recommendations__button', 'Reintentar'); retry.type = 'button'; retry.style.margin = '8px'; retry.addEventListener('click', load); root.append(retry);
  }
}
function scheduleLoad() { clearTimeout(scheduled); scheduled = setTimeout(load, 0); }
if (root) {
  supabase.auth.onAuthStateChange((event, session) => {
    if (event === 'SIGNED_OUT' || (owner && session?.user?.id !== owner)) { clear(); scheduleLoad(); }
    else if (event === 'SIGNED_IN' && session?.user?.id !== owner) scheduleLoad();
  });
  window.addEventListener('storage', event => { if (event.key === null || event.key === 'sb-mtpqpxcmngrsivntbgcc-auth-token') { clear(); scheduleLoad(); } });
  window.addEventListener('pageshow', event => { if (event.persisted) { clear(); scheduleLoad(); } });
  window.addEventListener('focus', () => { if (Date.now() - refreshedAt > 60000) scheduleLoad(); });
  load();
}
