import { searchCatalog } from './search-catalog.js?v=20261008-4';
import { inventoryVariants } from './inventory-catalog.js?v=20261008-1';

export function findProducts(query) {
  const normalize = value => value.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
  const tokens = normalize(query).split(' ').filter(Boolean).map(token => token.length > 3 ? token.replace(/s$/, '') : token);
  if (!tokens.length) return [];
  return searchCatalog.filter(product => {
    const searchable = normalize([product.name, product.category, product.keywords].join(' '));
    return tokens.every(token => searchable.includes(token));
  });
}

const query = new URLSearchParams(location.search).get('q');
if (query !== null && query.trim()) {
  const section = document.getElementById('productSearch');
  section.hidden = false;
  document.querySelector('.portfolio-visual').hidden = true;
  document.getElementById('productQuery').value = query;
  const products = findProducts(query);
  document.getElementById('searchSummary').textContent = products.length
    ? `${products.length} ${products.length === 1 ? 'producto encontrado' : 'productos encontrados'} para “${query}”.`
    : `No encontramos productos para “${query}”. Prueba con otro nombre o revisa el portafolio.`;
  const results = document.getElementById('searchResults');
  for (const product of products) {
    const article = document.createElement('article');
    article.dataset.productId = product.product_id;
    article.dataset.price = String(product.price);
    const image = document.createElement('img');
    image.src = product.image;
    image.alt = product.name;
    image.loading = 'lazy';
    image.className = 'search-image';
    const category = document.createElement('p');
    category.textContent = product.category;
    const heading = document.createElement('h2');
    heading.textContent = product.name;
    const link = document.createElement('a');
    link.href = product.href;
    link.textContent = 'Ver en catálogo';
    const price = document.createElement('p');
    price.className = 'search-price';
    price.textContent = formatPrice(product.price);
    const tax = document.createElement('p');
    tax.className = 'search-tax';
    tax.textContent = product.unit ? `1 ${product.unit} · IVA incluido` : 'IVA incluido';
    const stock = document.createElement('p');
    stock.className = 'search-stock';
    stock.textContent = 'Consultando inventario…';
    const delivery = document.createElement('p');
    delivery.textContent = 'Fecha de entrega: por confirmar según código postal.';
    article.append(image, category, heading, price, tax, stock, delivery, link);
    addCartControls(article, product);
    results.append(article);
  }
  loadDetails(products, results).catch(() => {
    for (const stock of results.querySelectorAll('.search-stock')) stock.textContent = 'No fue posible consultar el inventario. Intenta nuevamente.';
  });
}

function formatPrice(price) {
  return `$${Number(price).toLocaleString('es-MX', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} MXN`;
}

async function loadDetails(products, results) {
  const { supabase } = await withTimeout(import('./supabase-client.js?v=20260918-pricing-db'));
  const responses = await Promise.allSettled([
    withTimeout(supabase.from('products').select('id,price,currency').eq('is_active', true)),
    withTimeout(supabase.from('inventory_items').select('sku,quantity,unit,state,is_active'))
  ]);
  const rows = index => responses[index].status === 'fulfilled' && !responses[index].value.error
    ? responses[index].value.data || [] : [];
  const prices = new Map(rows(0).map(row => [row.id, row]));
  const inventory = new Map(rows(1).map(row => [row.sku, row]));
  for (const product of products) {
    const article = [...results.children].find(row => row.dataset.productId === product.product_id);
    if (!article) continue;
    const price = prices.get(product.product_id);
    if (price && price.price !== null && Number.isFinite(Number(price.price)) && Number(price.price) >= 0 && price.currency === 'MXN') {
      article.querySelector('.search-price').textContent = formatPrice(price.price);
      article.dataset.price = String(Number(price.price));
    }
    const variants = inventoryVariants.filter(row => row.product_id === product.product_id);
    const stock = article.querySelector('.search-stock');
    if (responses[1].status !== 'fulfilled' || responses[1].value.error) {
      stock.textContent = 'No fue posible consultar el inventario. Intenta nuevamente.';
      continue;
    }
    const records = variants.map(variant => ({variant, item:inventory.get(variant.sku)}));
    stock.textContent = '';
    for (const {variant, item} of records) {
      const line = document.createElement('span');
      line.style.display = 'block';
      const prefix = variants.length > 1 ? `${variant.name}: ` : '';
      if (item?.is_active && Number.isInteger(item.quantity) && item.quantity >= 0) {
        const words = product.unit === 'par' ? ['par', 'pares'] : ['pieza', 'piezas'];
        line.textContent = `${prefix}${item.quantity} ${words[item.quantity === 1 ? 0 : 1]} en inventario`;
      } else {
        line.textContent = `${prefix}Sin registro de inventario disponible`;
      }
      stock.append(line);
    }
  }
}

function addCartControls(article, product) {
  let variants = inventoryVariants.filter(row => row.product_id === product.product_id);
  if (product.product_id === 'chaleco-seguridad') variants = variants.filter(row => row.sku !== 'chaleco-seguridad');
  const controls = document.createElement('div');
  controls.className = 'search-cart-controls';
  let select;
  if (variants.length > 1) {
    const label = document.createElement('label');
    label.textContent = product.product_id === 'bota-industrial-dielectrica' ? 'Elige talla' : 'Elige color';
    select = document.createElement('select');
    select.id = `variant-${product.product_id}`;
    label.htmlFor = select.id;
    const placeholder = document.createElement('option');
    placeholder.value = '';
    placeholder.textContent = 'Selecciona una opción';
    select.append(placeholder);
    for (const variant of variants) {
      const option = document.createElement('option');
      option.value = variant.sku;
      option.textContent = variant.name;
      select.append(option);
    }
    controls.append(label, select);
  }
  const button = document.createElement('button');
  button.type = 'button';
  button.textContent = 'Agregar al carrito';
  const status = document.createElement('p');
  status.setAttribute('role', 'status');
  status.setAttribute('aria-live', 'polite');
  button.addEventListener('click', async () => {
    const variant = select ? variants.find(row => row.sku === select.value) : variants[0];
    if (!variant) { status.textContent = 'Selecciona talla o color antes de agregar.'; select?.focus(); return; }
    button.disabled = true;
    status.textContent = 'Agregando…';
    try {
      const { addToCart, getCart } = await withTimeout(import('./cart.js?v=20260914-account-isolation'));
      const before = getCart().find(row => row.id === variant.sku)?.qty || 0;
      // Keep the same sales price for the selected variant when the cart resolves aliases.
      try {
        const aliases = JSON.parse(localStorage.getItem('rho-product-price-aliases-v1') || '{}');
        const normalize = value => value.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
        aliases[normalize(variant.sku)] = Number(article.dataset.price);
        localStorage.setItem('rho-product-price-aliases-v1', JSON.stringify(aliases));
      } catch {}
      addToCart({ id:variant.sku, name:variants.length > 1 ? variant.name : product.name, price:Number(article.dataset.price), image:product.image, unit:product.unit || 'pieza' });
      const after = getCart().find(row => row.id === variant.sku)?.qty || 0;
      if (after !== before + 1) throw new Error('Cart was not saved');
      button.textContent = 'Agregar otra unidad';
      status.textContent = 'Agregado al carrito.';
      const count = getCart().reduce((total, row) => total + row.qty, 0);
      for (const badge of document.querySelectorAll('[data-cart-count]')) { badge.textContent = String(count); badge.hidden = count === 0; }
    } catch { status.textContent = 'No se pudo agregar. Intenta nuevamente.'; }
    finally { button.disabled = false; }
  });
  controls.append(button, status);
  article.append(controls);
}

function withTimeout(request) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('Request timeout')), 10000);
    Promise.resolve(request).then(resolve, reject).finally(() => clearTimeout(timer));
  });
}
