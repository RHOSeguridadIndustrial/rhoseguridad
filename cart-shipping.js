import {getCart} from './cart.js?v=20260914-account-isolation';
import {shippingForSubtotal} from './shipping-policy.js?v=20261009-modes';
const money=c=>new Intl.NumberFormat('es-MX',{style:'currency',currency:'MXN'}).format(c/100);
let mode='standard';
function mount(){
 const summary=document.querySelector('#cart-content .summary');
 if(!summary||summary.querySelector('[data-shipping-estimate]'))return;
 const panel=document.createElement('section');panel.dataset.shippingEstimate='';
 const label=document.createElement('label');label.className='guest-field';label.textContent='Modalidad de envío';
 const select=document.createElement('select');select.setAttribute('aria-label','Modalidad de envío');
 for(const [value,text] of [['standard','Estándar · 2 a 3 días hábiles'],['express','Express · 24 hrs']]){const option=document.createElement('option');option.value=value;option.textContent=text;select.append(option);}
 select.value=mode;label.append(select);panel.append(label);
 const output=document.createElement('p');output.className='summary-note';output.setAttribute('role','status');output.setAttribute('aria-live','polite');panel.append(output);
 const note=document.createElement('p');note.className='summary-note';note.textContent='Estimación para Ciudad de México. Los pedidos especiales requieren cotización de envío y total final antes del pago.';panel.append(note);
 const link=document.createElement('a');link.href='envios-entregas.html';link.textContent='Consultar política de envío';panel.append(link);
 const form=summary.querySelector('form');summary.insertBefore(panel,form);
 function update(){mode=select.value;const cart=getCart();const valid=cart.length&&cart.every(i=>Number.isFinite(Number(i.price))&&Number(i.price)>0&&Number.isSafeInteger(i.qty)&&i.qty>0);const cents=valid?cart.reduce((s,i)=>s+Math.round(Number(i.price)*100)*i.qty,0):null;const result=shippingForSubtotal(cents,mode);output.textContent=result.status==='blocked'?(mode==='express'&&Number.isSafeInteger(cents)?'Express aplica en compras mayores a $1,200 MXN. Elige estándar.':'No pudimos calcular el total estimado.'):'Envío estimado: '+(result.shippingCents===0?'Gratis':money(result.shippingCents))+' · Total estimado: '+money(result.totalCents);}
 select.addEventListener('change',update);update();
}
const content=document.getElementById('cart-content');
if(content)new MutationObserver(mount).observe(content,{childList:true});
mount();
