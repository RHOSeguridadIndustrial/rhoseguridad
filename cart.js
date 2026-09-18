// Separate local carts by authenticated user. Never import the ownerless v1 cart.
const AUTH_KEY = 'sb-mtpqpxcmngrsivntbgcc-auth-token';
const PREFIX = 'rho_cart_v2:';
let owner = null;
let ready = false;
function storedOwner() {
  try {
    const raw = localStorage.getItem(AUTH_KEY);
    if (!raw) return 'guest';
    const session = JSON.parse(raw);
    return session?.user?.id ? 'user:' + session.user.id : null;
  } catch { return null; }
}
function activeKey() { return ready && owner && storedOwner() === owner ? PREFIX + owner : null; }
function announce() { updateCartBadges(); window.dispatchEvent(new Event('rho-cart-changed')); }
try {
  const { supabase } = await import('./supabase-client.js?v=20260913-loyalty');
  const { data: { session }, error } = await supabase.auth.getSession();
  if (!error) { owner = session?.user?.id ? 'user:' + session.user.id : 'guest'; ready = true; }
  supabase.auth.onAuthStateChange((_event, session) => {
    const next = session?.user?.id ? 'user:' + session.user.id : 'guest';
    if (next !== owner || !ready) { owner = next; ready = true; announce(); }
  });
} catch { if (storedOwner() === 'guest') { owner = 'guest'; ready = true; } }
export function getCart(){ const key=activeKey(); if(!key)return[]; try{const cart=JSON.parse(localStorage.getItem(key)||'[]');return Array.isArray(cart)?cart:[]}catch{return[]} }
export function saveCart(cart){const key=activeKey();if(!key){alert('Tu sesión cambió. Recarga la página antes de modificar el carrito.');return}localStorage.setItem(key,JSON.stringify(cart));announce()}
export function addToCart(product){const cart=getCart();const found=cart.find(item=>item.id===product.id);if(found){found.qty+=1}else{cart.push({...product,qty:1})}saveCart(cart);return cart}
export function updateQuantity(id,qty){const cart=getCart();const item=cart.find(item=>item.id===id);if(!item)return cart;item.qty=Math.max(1,Number(qty)||1);saveCart(cart);return cart}
export function removeFromCart(id){const cart=getCart().filter(item=>item.id!==id);saveCart(cart);return cart}
export function clearCart(){saveCart([])}
export function cartCount(){return getCart().reduce((sum,item)=>sum+item.qty,0)}
export function cartTotal(){return getCart().reduce((sum,item)=>sum+(item.price*item.qty),0)}
function ensureIconWrap(cartBtn){let wrap=cartBtn.querySelector('.cart-icon-wrap');const icon=cartBtn.querySelector('.cart-icon');if(!wrap&&icon){wrap=document.createElement('span');wrap.className='cart-icon-wrap';icon.parentNode.insertBefore(wrap,icon);wrap.appendChild(icon)}if(wrap){Object.assign(wrap.style,{position:'relative',display:'inline-flex',alignItems:'center',justifyContent:'center',width:'28px',height:'28px',overflow:'visible'})}return wrap||cartBtn}
function ensureBadge(cartBtn){const wrap=ensureIconWrap(cartBtn);let badge=cartBtn.querySelector('[data-cart-count]');if(!badge){badge=document.createElement('b');badge.className='cart-badge';badge.setAttribute('data-cart-count','');badge.setAttribute('aria-label','Artículos en el carrito')}if(badge.parentNode!==wrap)wrap.appendChild(badge);Object.assign(badge.style,{position:'absolute',top:'-9px',right:'-13px',zIndex:'30',minWidth:'22px',height:'22px',margin:'0',padding:'0 6px',border:'2px solid #fff',borderRadius:'999px',background:'#4ca500',color:'#fff',fontSize:'12px',fontWeight:'800',lineHeight:'18px',textAlign:'center',boxShadow:'0 2px 6px rgba(7,26,53,.18)'});return badge}
export function updateCartBadges(){const count=cartCount();document.querySelectorAll('.cart-btn').forEach(cartBtn=>{const badge=ensureBadge(cartBtn);badge.textContent=String(count);badge.hidden=count===0;cartBtn.classList.toggle('has-items',count>0);cartBtn.setAttribute('aria-label',count>0?`Ver carrito, ${count} artículo${count===1?'':'s'}`:'Ver carrito')})}
function fixPortfolioWideCards(){
  if(!/portafolio\.html$/.test(location.pathname) && location.pathname!=='/portafolio' && location.pathname!=='/') return;
  const cards=document.querySelectorAll('.wide-card');
  if(cards.length!==2) return;
  const positions=['4.51% 85.0%','96.62% 85.0%'];
  cards.forEach((card,i)=>{
    const media=card.querySelector('.media');
    const body=card.querySelector('.body');
    if(body) body.style.display='none';
    if(media){media.style.aspectRatio='2.85 / 1';media.style.height='auto';media.style.backgroundSize='325.08% auto';media.style.backgroundPosition=positions[i];media.style.backgroundRepeat='no-repeat';}
    card.style.minHeight='0';
  });
}
function removeSpeedReducer(){
  if(!/senalizacion\.html$/.test(location.pathname)) return;
  document.querySelectorAll('.card').forEach(card=>{
    const title=card.querySelector('h2')?.textContent?.toLowerCase()||'';
    if(title.includes('reductor de velocidad')) card.remove();
  });
}
document.addEventListener('DOMContentLoaded',()=>{updateCartBadges();fixPortfolioWideCards();removeSpeedReducer()});
window.addEventListener('storage',event=>{if(event.key===AUTH_KEY||event.key===null){ready=false;announce();location.reload();return}if(event.key===activeKey())announce()});
window.addEventListener('pageshow',event=>{if(event.persisted)location.reload()});
