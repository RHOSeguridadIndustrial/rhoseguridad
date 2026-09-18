import { supabase } from './supabase-client.js?v=20260918-pricing-db';

const CACHE_KEY='rho-product-prices-v1';
const ALIAS_KEY='rho-product-price-aliases-v1';
const normalize=value=>String(value||'').normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase().replace(/[^a-z0-9]+/g,' ').trim();
const money=value=>Number(value).toLocaleString('es-MX',{minimumFractionDigits:2,maximumFractionDigits:2});

export function cachedProducts(){
  try{
    const parsed=JSON.parse(localStorage.getItem(CACHE_KEY)||'{}');
    return Array.isArray(parsed.items)?parsed.items:[];
  }catch{return[]}
}

export async function refreshProductPrices(){
  const {data,error}=await supabase.from('products').select('id,name,category,price,currency,is_active').eq('is_active',true);
  if(error||!Array.isArray(data)) return cachedProducts();
  localStorage.setItem(CACHE_KEY,JSON.stringify({updatedAt:Date.now(),items:data}));
  const byName=new Map(data.map(p=>[normalize(p.name),p]));
  const aliases={};
  for(const article of document.querySelectorAll('article')){
    const title=article.querySelector('h2');
    if(!title) continue;
    const product=byName.get(normalize(title.textContent));
    if(!product) continue;
    const price=Number(product.price);
    article.dataset.rhoProductId=product.id;
    article.dataset.rhoPrice=String(price);
    aliases[normalize(product.id)]=price;
    aliases[normalize(product.name)]=price;
    const priceEl=article.querySelector('.product-price,.price');
    if(priceEl){
      if(priceEl.classList.contains('product-price')) priceEl.innerHTML='$'+money(price)+' <small>MXN</small>';
      else priceEl.textContent='$'+money(price);
    }
    article.querySelectorAll('[data-price]').forEach(el=>el.dataset.price=String(price));
    article.querySelectorAll('[data-product-id],[data-id]').forEach(el=>{
      const key=el.dataset.productId||el.dataset.id;
      if(key) aliases[normalize(key)]=price;
    });
    article.querySelectorAll('[data-name]').forEach(el=>{if(el.dataset.name) aliases[normalize(el.dataset.name)]=price;});
  }
  localStorage.setItem(ALIAS_KEY,JSON.stringify(aliases));
  window.dispatchEvent(new CustomEvent('rho-prices-updated',{detail:{products:data}}));
  return data;
}

refreshProductPrices().catch(()=>{});
