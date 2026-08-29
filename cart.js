const CART_KEY='rho_cart_v1';

export function getCart(){
  try{return JSON.parse(localStorage.getItem(CART_KEY)||'[]')}catch{return []}
}

export function saveCart(cart){
  localStorage.setItem(CART_KEY,JSON.stringify(cart));
  updateCartBadges();
}

export function addToCart(product){
  const cart=getCart();
  const found=cart.find(item=>item.id===product.id);
  if(found){found.qty+=1}else{cart.push({...product,qty:1})}
  saveCart(cart);
  return cart;
}

export function updateQuantity(id,qty){
  const cart=getCart();
  const item=cart.find(item=>item.id===id);
  if(!item) return cart;
  item.qty=Math.max(1,Number(qty)||1);
  saveCart(cart);
  return cart;
}

export function removeFromCart(id){
  const cart=getCart().filter(item=>item.id!==id);
  saveCart(cart);
  return cart;
}

export function clearCart(){saveCart([])}

export function cartCount(){return getCart().reduce((sum,item)=>sum+item.qty,0)}
export function cartTotal(){return getCart().reduce((sum,item)=>sum+(item.price*item.qty),0)}

function ensureIconWrap(cartBtn){
  let wrap=cartBtn.querySelector('.cart-icon-wrap');
  const icon=cartBtn.querySelector('.cart-icon');
  if(!wrap&&icon){
    wrap=document.createElement('span');
    wrap.className='cart-icon-wrap';
    icon.parentNode.insertBefore(wrap,icon);
    wrap.appendChild(icon);
  }
  if(wrap){
    Object.assign(wrap.style,{position:'relative',display:'inline-flex',alignItems:'center',justifyContent:'center',width:'28px',height:'28px',overflow:'visible'});
  }
  return wrap||cartBtn;
}

function ensureBadge(cartBtn){
  const wrap=ensureIconWrap(cartBtn);
  let badge=cartBtn.querySelector('[data-cart-count]');
  if(!badge){
    badge=document.createElement('b');
    badge.className='cart-badge';
    badge.setAttribute('data-cart-count','');
    badge.setAttribute('aria-label','Artículos en el carrito');
  }
  if(badge.parentNode!==wrap) wrap.appendChild(badge);
  Object.assign(badge.style,{position:'absolute',top:'-9px',right:'-13px',zIndex:'30',minWidth:'22px',height:'22px',margin:'0',padding:'0 6px',border:'2px solid #fff',borderRadius:'999px',background:'#4ca500',color:'#fff',fontSize:'12px',fontWeight:'800',lineHeight:'18px',textAlign:'center',boxShadow:'0 2px 6px rgba(7,26,53,.18)'});
  return badge;
}

export function updateCartBadges(){
  const count=cartCount();
  document.querySelectorAll('.cart-btn').forEach(cartBtn=>{
    const badge=ensureBadge(cartBtn);
    badge.textContent=String(count);
    badge.hidden=count===0;
    cartBtn.classList.toggle('has-items',count>0);
    cartBtn.setAttribute('aria-label',count>0?`Ver carrito, ${count} artículo${count===1?'':'s'}`:'Ver carrito');
  });
}

document.addEventListener('DOMContentLoaded',updateCartBadges);
window.addEventListener('storage',updateCartBadges);
