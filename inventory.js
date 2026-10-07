import { supabase } from './supabase-client.js?v=20261007-inventory';

let inventory=new Map(), connection='loading';
const page=(location.pathname.split('/').pop()||'').replace(/\.html$/,'');
function selectedSku(article) {
  if(page==='cabeza') return 'casco-mundial-infra-sin-matraca-'+(document.querySelector('[name="helmet-color"]:checked')?.value||'amarillo');
  if(page==='ropa') return 'chaleco-seguridad-'+(document.querySelector('[name="color"]:checked')?.value||'naranja');
  if(page==='pies') return 'bota-van-vien-blu-negro-talla-'+(document.querySelector('[name="boot-size"]:checked')?.value||'23');
  return article.dataset.inventorySku;
}
export function availability(sku) {
  if(connection==='loading') return {state:'loading',text:'Cargando existencias…'};
  if(connection!=='ready') return {state:'unknown',text:'No fue posible cargar las existencias. Intenta de nuevo.'};
  const item=inventory.get(sku);
  // A variant without a stock record has no pieces registered for sale.
  if(!item) return {state:'unregistered',text:'0 piezas disponibles',quantity:0};
  const quantity=item.is_active?item.quantity:0;
  const count=`${quantity} ${quantity===1?'pieza disponible':'piezas disponibles'}`;
  if(!item.is_active) return {state:'unavailable',text:count,quantity};
  if(item.state==='pending') return {state:'pending',text:count,quantity};
  if(quantity===0) return {state:'empty',text:count,quantity};
  return {state:'available',text:count,quantity};
}
function render() {
  for(const article of document.querySelectorAll('article[data-inventory-sku]')) {
    // Stock is shown when reviewing the order, not on the product page.
    article.querySelectorAll('.inventory-badge').forEach(badge=>badge.remove());
    const result=availability(selectedSku(article));
    // The current store accepts quote requests; adding to a quote never reserves stock.
    const button=article.querySelector('.cart-action,.buy,button.btn');
    if(button) button.textContent='Agregar al carrito';
    for(const node of article.querySelectorAll('[data-inventory-delivery]')) node.textContent=result.state==='available'?'Entrega estimada de 24 a 48 hrs':'Entrega por confirmar';
  }
  for(const row of document.querySelectorAll('.cart-card')) {
    const sku=row.querySelector('[data-qty]')?.dataset.qty; if(!sku)continue;
    let badge=row.querySelector('.inventory-badge');if(!badge){badge=document.createElement('p');badge.className='inventory-badge';badge.setAttribute('role','status');badge.setAttribute('aria-live','polite');row.querySelector('.unit-price')?.after(badge);}
    const result=availability(sku);badge.textContent=result.text;badge.dataset.state=result.state;
  }
}
let inflight;
export async function refreshInventory() {
  if(inflight)return inflight;
  inflight=(async()=>{
    try {const {data,error}=await supabase.from('inventory_items').select('sku,quantity,unit,state,is_active');if(error)throw error;inventory=new Map(data.map(i=>[i.sku,i]));connection='ready';}
    catch {connection='error';inventory=new Map();}
    finally {render();inflight=null;}
  })();return inflight;
}
document.addEventListener('change',e=>{if(e.target.matches('[name="helmet-color"],[name="color"],[name="boot-size"]'))render();});
window.addEventListener('rho-cart-changed',()=>queueMicrotask(render));
window.addEventListener('rho-prices-updated',()=>queueMicrotask(render));
document.addEventListener('visibilitychange',()=>{if(!document.hidden)refreshInventory();});
window.addEventListener('focus',refreshInventory);
setInterval(()=>{if(!document.hidden)refreshInventory();},30000);
render();refreshInventory();

// Signage cards previously had no cart listener; use their exact inventory SKU.
if(page==='senalizacion') {
  import('./cart.js?v=20260914-account-isolation').then(({addToCart})=>{
    document.querySelectorAll('article[data-inventory-sku]').forEach(article=>{
      const button=article.querySelector('button.btn');if(!button)return;
      button.addEventListener('click',()=>{
        const price=Number(article.dataset.rhoPrice??article.querySelector('.price')?.textContent.replace(/[^0-9.]/g,''));
        if(!Number.isFinite(price))return;
        addToCart({id:article.dataset.inventorySku,name:article.querySelector('h2').textContent,price,image:article.querySelector('img')?.getAttribute('src')||'logo-rho.jpeg'});
        button.textContent='Agregado a tu cotización';setTimeout(render,1600);
      });
    });
  }).catch(()=>{});
}
