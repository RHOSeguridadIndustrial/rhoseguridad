import { supabase } from './supabase-client.js?v=20261007-inventory';
import { inventoryVariants } from './inventory-catalog.js?v=20261007-1';

const $ = id => document.getElementById(id);
const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
let items = [], proposed = new Map(), products = [], activeItem = null, authorized = false, loading = false;
const stateOf = item => !item.is_active ? 'paused' : item.state === 'pending' ? 'pending' : item.quantity <= item.minimum_stock ? 'low' : 'available';
const labelOf = item => !item.is_active ? 'No disponible' : item.state === 'pending' ? 'Próximamente' : item.quantity === 0 ? 'Agotado' : item.quantity <= item.minimum_stock ? 'Existencia baja' : 'Disponible';

function lock(message) {
  authorized = false; items = []; activeItem = null;
  $('app').hidden = true; $('logout').hidden = true; $('access').textContent = message;
  for (const dialog of document.querySelectorAll('dialog[open]')) dialog.close();
  $('items').replaceChildren(); $('history').replaceChildren();
}
async function init() {
  try {
    const {data: {user}, error} = await supabase.auth.getUser();
    if (error || !user) { lock('Inicia sesión con tu cuenta de administrador para continuar.'); const a=document.createElement('a'); a.href='login.html'; a.textContent=' Iniciar sesión'; $('access').append(a); return; }
    const {data: profile, error: profileError} = await supabase.from('profiles').select('role').eq('id',user.id).single();
    if (profileError || profile?.role !== 'admin') { lock('Este panel está reservado para administradores.'); return; }
    authorized = true; $('access').textContent=''; $('logout').hidden=false; $('app').hidden=false;
    await load();
  } catch { lock('No fue posible verificar tu acceso. Recarga la página.'); }
}
async function load() {
  if (!authorized || loading) return;
  loading=true; $('refresh').disabled=true; $('message').textContent='Actualizando inventario…';
  try {
    const [inventory,imports,catalog,history,people] = await Promise.all([
      supabase.from('inventory_items').select('*').order('name'),
      supabase.from('inventory_import').select('sku,proposed_quantity'),
      supabase.from('products').select('id,name,category').order('name'),
      supabase.from('inventory_history').select('sku,old_quantity,new_quantity,old_state,new_state,reason,changed_by,changed_at').order('changed_at',{ascending:false}).limit(30),
      supabase.from('profiles').select('id,full_name').eq('role','admin')
    ]);
    if (!authorized) return;
    for (const result of [inventory,imports,catalog,history,people]) if(result.error) throw result.error;
    items=inventory.data; products=catalog.data; proposed=new Map(imports.data.map(i=>[i.sku,i.proposed_quantity]));
    render(); renderHistory(history.data,people.data); renderNewProducts();
    $('message').className=''; $('message').textContent='Actualizado: '+new Date().toLocaleTimeString('es-MX');
  } catch { $('message').className='error'; $('message').textContent='No se pudo actualizar el inventario. Inténtalo nuevamente.'; }
  finally { loading=false; $('refresh').disabled=false; }
}
function render() {
  $('item-count').textContent=items.length;
  $('available-count').textContent=items.filter(i=>i.is_active&&i.state==='tracked'&&i.quantity>0).length;
  $('pending-count').textContent=items.filter(i=>i.state==='pending').length;
  $('low-count').textContent=items.filter(i=>i.is_active&&i.state==='tracked'&&i.quantity<=i.minimum_stock).length;
  const query=$('search').value.trim().toLocaleLowerCase('es'), filter=$('filter').value;
  const visible=items.filter(i=>(!query||(i.name+' '+i.sku).toLocaleLowerCase('es').includes(query))&&(!filter||(filter==='available'?i.is_active&&i.state==='tracked'&&i.quantity>0:stateOf(i)===filter)));
  $('items').innerHTML=visible.length?visible.map(i=>`<tr><td><strong>${esc(i.name)}</strong><small>${esc(i.sku)}</small></td><td>${proposed.has(i.sku)?proposed.get(i.sku):'—'}</td><td><strong>${i.quantity} ${esc(i.unit)}</strong><small>Mínimo: ${i.minimum_stock}</small></td><td><span class="pill ${stateOf(i)}">${labelOf(i)}</span></td><td><button data-edit="${esc(i.sku)}">Administrar</button></td></tr>`).join(''):'<tr><td colspan="5">No hay artículos con este filtro.</td></tr>';
}
function renderHistory(history,people) {
  const names=new Map(items.map(i=>[i.sku,i.name])), admins=new Map(people.map(p=>[p.id,p.full_name||'Administrador']));
  $('history').innerHTML=history.length?history.map(h=>`<tr><td>${esc(new Date(h.changed_at).toLocaleString('es-MX'))}</td><td>${esc(names.get(h.sku)||h.sku)}</td><td>${h.old_quantity??'Alta'} → ${h.new_quantity}${h.old_state!==h.new_state?'<small>'+esc(h.new_state==='tracked'?'Existencia confirmada':'Pendiente de compra')+'</small>':''}</td><td>${esc(h.reason)}</td><td>${esc(admins.get(h.changed_by)||'Administrador')}</td></tr>`).join(''):'<tr><td colspan="5">La propuesta de compra está cargada. Aún no hay entradas ni salidas.</td></tr>';
}
function edit(sku) {
  activeItem=items.find(i=>i.sku===sku); if(!activeItem) return;
  const form=$('edit-form'), item=activeItem;
  form.reset(); $('edit-title').textContent=item.name; $('edit-current').textContent=`Existencia actual: ${item.quantity} ${item.unit}. ${labelOf(item)}.`;
  form.elements.quantity.value=''; form.elements.minimum.value=item.minimum_stock; form.elements.unit.value=item.unit; form.elements.active.checked=item.is_active;
  $('edit-message').textContent=''; $('quantity-label').hidden=false; form.elements.quantity.disabled=false;
  $('edit-dialog').showModal(); form.elements.quantity.focus();
}
$('edit-form').elements.action.addEventListener('change',e=>{
  const form=$('edit-form'), details=['details','pending'].includes(e.target.value);
  $('quantity-label').hidden=details; form.elements.quantity.disabled=details;
  form.elements.quantity.min=['receive','issue'].includes(e.target.value)?'1':'0';
});
$('edit-form').addEventListener('submit',async e=>{
  e.preventDefault(); if(!authorized||!activeItem) return;
  const form=e.currentTarget, data=new FormData(form), action=data.get('action');
  const quantity=['details','pending'].includes(action)?0:Number(data.get('quantity')), minimum=Number(data.get('minimum'));
  if(!Number.isInteger(quantity)||!Number.isInteger(minimum)||quantity<0||minimum<0) return;
  $('save').disabled=true; $('edit-message').className=''; $('edit-message').textContent='Guardando…';
  try {
    const {error}=await supabase.rpc('inventory_adjust',{p_sku:activeItem.sku,p_action:action,p_quantity:quantity,p_minimum:minimum,p_unit:data.get('unit'),p_active:form.elements.active.checked,p_reason:data.get('reason').trim(),p_revision:activeItem.revision});
    if(error) throw error;
    $('edit-dialog').close(); await load(); $('message').className='success'; $('message').textContent='Movimiento guardado. La disponibilidad ya está actualizada.';
  } catch(error) {
    $('edit-message').className='error';
    $('edit-message').textContent=error.code==='40001'?'Otro movimiento cambió este artículo. Cierra la ventana, actualiza y vuelve a intentar.':error.message||'No se pudo guardar el movimiento.';
  } finally { $('save').disabled=false; }
});
function renderNewProducts() {
  const eligible=new Set(inventoryVariants.filter(v=>!items.some(i=>i.sku===v.sku)).map(v=>v.product_id));
  $('product-select').innerHTML=products.filter(p=>eligible.has(p.id)).map(p=>`<option value="${esc(p.id)}">${esc(p.name)}</option>`).join(''); renderVariants();
}
function renderVariants() {
  const variants=inventoryVariants.filter(v=>v.product_id===$('product-select').value&&!items.some(i=>i.sku===v.sku));
  $('variant-select').innerHTML=variants.map(v=>`<option value="${esc(v.sku)}">${esc(v.name)}</option>`).join('');
  $('new-form').querySelector('button:not([type])').disabled=!variants.length;
}
$('new-form').addEventListener('submit',async e=>{
  e.preventDefault(); const variant=inventoryVariants.find(v=>v.sku===$('variant-select').value); if(!authorized||!variant) return;
  const button=e.currentTarget.querySelector('button:not([type])'); button.disabled=true; $('new-message').textContent='Creando…';
  try {
    const {error}=await supabase.rpc('inventory_create',{p_sku:variant.sku,p_product_id:variant.product_id,p_name:variant.name,p_unit:variant.unit||'unidad'}); if(error) throw error;
    $('new-dialog').close(); await load();
  } catch { $('new-message').textContent='No se pudo crear el artículo. Actualiza la lista y vuelve a intentar.'; }
  finally { button.disabled=false; }
});
$('new-item').onclick=()=>{renderNewProducts();$('new-message').textContent='';$('new-dialog').showModal();};
$('product-select').onchange=renderVariants;
$('items').addEventListener('click',e=>{const button=e.target.closest('[data-edit]');if(button)edit(button.dataset.edit);});
$('search').addEventListener('input',render); $('filter').addEventListener('change',render); $('refresh').onclick=load;
document.querySelectorAll('[data-close]').forEach(b=>b.onclick=()=>$(b.dataset.close).close());
$('logout').onclick=async()=>{lock('Cerrando sesión…');await supabase.auth.signOut({scope:'local'});location.replace('login.html');};
supabase.auth.onAuthStateChange((event,session)=>{if(event==='SIGNED_OUT'||(!session&&authorized))lock('Tu sesión terminó. Vuelve a iniciar sesión.');});
window.addEventListener('pageshow',e=>{if(e.persisted)location.reload();});
init();
