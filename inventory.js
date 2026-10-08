import { purchaseChannel } from './purchase-channel.js?v=20261008-1';
import { addSpecialOrderMessage } from './special-order.js?v=20261008-1';
import { supabase } from './supabase-client.js?v=20261007-inventory';
import { describeAvailability } from './inventory-availability.js?v=20261008-3';
import { inventoryVariants } from './inventory-catalog.js?v=20261008-1';

const salesUnits = new Map(inventoryVariants.filter(item => item.unit).map(item => [item.sku,item.unit]));

let inventory=new Map(), connection='loading';
const page=(location.pathname.split('/').pop()||'').replace(/\.html$/,'');
export function availability(sku) {
  return describeAvailability(connection, inventory.get(sku), salesUnits.get(sku));
}
function render() {
  for(const article of document.querySelectorAll('article[data-inventory-sku]')) {
    let sku=article.dataset.inventorySku;
    const helmet=article.querySelector('[name="helmet-color"]:checked');
    const boot=article.querySelector('[name="boot-size"]:checked');
    const vest=article.querySelector('[name="color"]:checked');
    if(helmet)sku=`casco-mundial-infra-sin-matraca-${helmet.value}`;
    if(boot)sku=`bota-van-vien-blu-negro-talla-${boot.value}`;
    if(vest)sku=`chaleco-seguridad-${vest.value}`;
    const price=article.querySelector('.product-price,.price');
    let tax=article.querySelector('.tax-note') || [...article.querySelectorAll('p,small,div')].find(node=>node.children.length===0 && node.textContent.trim()==='IVA incluido');
    if(!tax && price){tax=document.createElement('p');tax.className='tax-note';price.after(tax);}
    if(tax)tax.textContent='IVA incluido';
    let unit=article.querySelector('.rho-sale-unit');
    if(!unit && tax){unit=document.createElement('p');unit.className='rho-sale-unit';tax.after(unit);}
    if(unit)unit.textContent=`Precio por: 1 ${salesUnits.get(sku)||'pieza'}`;
    for(const node of article.querySelectorAll('.product-meta li')) {
      if(/^(1 (pieza|par)|Unidad de venta: 1 (pieza|par))$/.test(node.textContent.trim()))node.remove();
    }
    let badge=article.querySelector('.inventory-badge');
    if(!badge && unit){badge=document.createElement('p');badge.className='inventory-badge';badge.setAttribute('role','status');badge.setAttribute('aria-live','polite');unit.after(badge);}
    const result=availability(sku);if(badge){badge.textContent=result.text;badge.dataset.state=result.state;}
    addSpecialOrderMessage(article, article.querySelector('h2,h3')?.textContent, badge);
    const special=article.querySelector('.rho-special-order');if(badge&&special)badge.after(special);
    // The current store accepts quote requests; adding to a quote never reserves stock.
    const button=article.querySelector('.cart-action,.buy,button.btn');
    if(button) button.textContent='Agregar al carrito';
    for(const node of article.querySelectorAll('[data-inventory-delivery]')) node.textContent='Entrega por confirmar';
  }
  for(const row of document.querySelectorAll('.cart-card')) {
    const sku=row.querySelector('[data-qty]')?.dataset.qty; if(!sku)continue;
    let badge=row.querySelector('.inventory-badge');if(!badge){badge=document.createElement('p');badge.className='inventory-badge';badge.setAttribute('role','status');badge.setAttribute('aria-live','polite');row.querySelector('.rho-sale-unit')?.after(badge);}
    const result=availability(sku);badge.textContent=result.text;badge.dataset.state=result.state;
    addSpecialOrderMessage(row, row.querySelector('.item-name')?.textContent, badge);
  }
  const checkout=document.getElementById('checkout');
  const note=document.getElementById('purchaseChannelNote');
  if(checkout && note) {
    const items=[...document.querySelectorAll('.cart-card [data-qty]')].map(node=>({sku:node.dataset.qty,quantity:Number(node.value)}));
    const channel=purchaseChannel(items,[...inventory.values()],connection);
    note.hidden=channel.action==='special';
    note.textContent=channel.action==='special'?'':connection==='loading'?'Consultando existencias para tu pedido…':channel.message;
    checkout.disabled=channel.action!=='special';
    checkout.textContent=channel.action==='special'?'Cotizar pedido especial por WhatsApp':channel.action==='onsite_pending'?'Compra en la página: próximamente':'Confirmar existencias';
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
