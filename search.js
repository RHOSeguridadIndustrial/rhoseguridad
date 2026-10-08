import { searchCatalog } from './search-catalog.js?v=20261008-3';
import { supabase } from './supabase-client.js?v=20260918-pricing-db';
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
    price.textContent = 'Precio por confirmar';
    const tax = document.createElement('p');
    tax.className = 'search-tax';
    tax.textContent = product.unit ? `1 ${product.unit} · IVA incluido` : 'IVA incluido';
    const stock = document.createElement('p');
    stock.className = 'search-stock';
    stock.textContent = 'Consultando inventario…';
    const delivery = document.createElement('p');
    delivery.textContent = 'Fecha de entrega: por confirmar según código postal.';
    article.append(image, category, heading, price, tax, stock, delivery, link);
    results.append(article);
  }
  loadDetails(products, results).catch(() => {});
}

async function loadDetails(products, results) {
  const responses = await Promise.allSettled([
    supabase.from('products').select('id,price,currency').eq('is_active', true),
    supabase.from('inventory_items').select('sku,quantity,unit,state,is_active')
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
      article.querySelector('.search-price').textContent = `$${Number(price.price).toLocaleString('es-MX', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} MXN`;
    }
    const variants = inventoryVariants.filter(row => row.product_id === product.product_id);
    const stock = article.querySelector('.search-stock');
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
