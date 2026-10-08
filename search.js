import { searchCatalog } from './search-catalog.js?v=20261008-2';

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
    const category = document.createElement('p');
    category.textContent = product.category;
    const heading = document.createElement('h2');
    heading.textContent = product.name;
    const link = document.createElement('a');
    link.href = product.href;
    link.textContent = 'Ver en catálogo';
    article.append(category, heading, link);
    results.append(article);
  }
}
