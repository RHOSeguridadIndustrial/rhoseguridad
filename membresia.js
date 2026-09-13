import { supabase } from './supabase-client.js?v=20260913-loyalty';
import QRCode from 'https://cdn.jsdelivr.net/npm/qrcode@1.5.4/+esm';

const loading=document.getElementById('loading'),content=document.getElementById('memberContent'),noCard=document.getElementById('noCard');
const {data:{session}}=await supabase.auth.getSession();
if(!session){location.replace('login.html');}
else{await loadMember();}

async function loadMember(){
  const response=await fetch('https://mtpqpxcmngrsivntbgcc.supabase.co/functions/v1/loyalty-my-card',{headers:{Authorization:`Bearer ${session.access_token}`,apikey:'sb_publishable_5Dan5EdjEHyfPDG30opQ8Q_d-Kkp72_'}});
  const result=await response.json();loading.hidden=true;
  if(!response.ok){loading.hidden=false;loading.textContent=result.error||'No fue posible cargar la membresía.';return}
  if(!result.card){noCard.hidden=false;return}
  const card=result.card,tier=card.tier||{};content.hidden=false;
  const cardElement=document.getElementById('digitalCard'),darkInk=['oro','platino'].includes(card.tier_code);cardElement.style.setProperty('--tier',tier.color_hex||'#01283b');cardElement.style.color=darkInk?'#071a35':'#ffffff';if(darkInk){cardElement.querySelector('.watermark').style.color='rgba(7,26,53,.12)';cardElement.querySelector('.back-copy p').style.color='#071a35';}
  document.getElementById('tierName').textContent=tier.display_name||card.tier_code;
  document.getElementById('backTier').textContent=tier.display_name||card.tier_code;
  document.getElementById('cardNumber').textContent=card.card_number.replace(/(.{4})/g,'$1 ').trim();
  document.getElementById('points').textContent=card.points_balance.toLocaleString('es-MX');
  document.getElementById('lifetime').textContent=card.lifetime_points.toLocaleString('es-MX');
  document.getElementById('expiry').textContent=card.expires_at?new Date(card.expires_at).toLocaleDateString('es-MX'):'Sin límite';
  document.getElementById('benefits').innerHTML=(tier.benefits||[]).map(x=>`<li>${escapeHtml(x)}</li>`).join('');
  if(card.validation_url)await QRCode.toCanvas(document.getElementById('qrCanvas'),card.validation_url,{width:180,margin:1,errorCorrectionLevel:'M'});
  else document.querySelector('.qr-wrap').textContent='QR pendiente de regeneración';
  const [details,activity,purchases,redemptions]=await Promise.all([
    supabase.from('loyalty_customer_details').select('*').eq('user_id',session.user.id).maybeSingle(),
    supabase.from('loyalty_points_ledger').select('created_at,description,event_type,points_delta').eq('card_id',card.id).order('created_at',{ascending:false}).limit(20),
    supabase.from('loyalty_transactions').select('occurred_at,external_folio,branch_name,total,currency').eq('card_id',card.id).order('occurred_at',{ascending:false}).limit(20),
    supabase.from('loyalty_redemptions').select('issued_at,status,loyalty_rewards(name)').eq('card_id',card.id).order('issued_at',{ascending:false}).limit(20)
  ]);
  const d=details.data||{},form=document.getElementById('detailsForm');form.birth_date.value=d.birth_date||'';form.anniversary_date.value=d.anniversary_date||'';form.preferred_categories.value=(d.preferred_categories||[]).join(', ');form.privacy_consent.checked=!!d.privacy_consented_at;form.marketing_consent.checked=!!d.marketing_consent;
  const rows=activity.data||[];document.getElementById('activityBody').innerHTML=rows.length?rows.map(r=>`<tr><td>${new Date(r.created_at).toLocaleDateString('es-MX')}</td><td>${escapeHtml(r.description||labelEvent(r.event_type))}</td><td>${r.points_delta>0?'+':''}${r.points_delta}</td></tr>`).join(''):'<tr><td colspan="3">Aún no hay movimientos.</td></tr>';
  const purchaseRows=purchases.data||[];document.getElementById('purchasesBody').innerHTML=purchaseRows.length?purchaseRows.map(r=>`<tr><td>${new Date(r.occurred_at).toLocaleDateString('es-MX')}</td><td>${escapeHtml(r.external_folio)}</td><td>${escapeHtml(r.branch_name||'—')}</td><td>${new Intl.NumberFormat('es-MX',{style:'currency',currency:(r.currency||'MXN').trim()}).format(r.total)}</td></tr>`).join(''):'<tr><td colspan="4">Aún no hay compras asociadas.</td></tr>';
  const rewardRows=redemptions.data||[];document.getElementById('rewardsBody').innerHTML=rewardRows.length?rewardRows.map(r=>`<tr><td>${escapeHtml(r.loyalty_rewards?.name||'Recompensa')}</td><td>${escapeHtml(r.status)}</td><td>${new Date(r.issued_at).toLocaleDateString('es-MX')}</td></tr>`).join(''):'<tr><td colspan="3">Aún no hay recompensas canjeadas.</td></tr>';
}

document.querySelectorAll('[data-side]').forEach(button=>button.addEventListener('click',()=>{const back=button.dataset.side==='back';document.querySelector('.card-front').classList.toggle('hidden',back);document.querySelector('.card-back').classList.toggle('active',back);document.querySelectorAll('[data-side]').forEach(x=>x.classList.toggle('active',x===button));}));
document.getElementById('detailsForm').addEventListener('submit',async event=>{event.preventDefault();const form=event.currentTarget,status=document.getElementById('detailsStatus'),f=new FormData(form);status.textContent='Guardando…';status.className='status';const payload={user_id:session.user.id,birth_date:f.get('birth_date')||null,anniversary_date:f.get('anniversary_date')||null,preferred_categories:String(f.get('preferred_categories')||'').split(',').map(x=>x.trim()).filter(Boolean),privacy_consented_at:new Date().toISOString(),privacy_notice_version:'1.0',marketing_consent:f.get('marketing_consent')==='on',marketing_consented_at:f.get('marketing_consent')==='on'?new Date().toISOString():null};const{error}=await supabase.from('loyalty_customer_details').upsert(payload,{onConflict:'user_id'});status.className=`status ${error?'error':'ok'}`;status.textContent=error?'No fue posible guardar tus preferencias.':'Preferencias guardadas.';});
document.getElementById('logoutBtn').addEventListener('click',async()=>{await supabase.auth.signOut();location.replace('login.html');});
function labelEvent(value){return({earn:'Puntos acumulados',redeem:'Canje',adjust:'Ajuste',expire:'Vencimiento',bonus:'Bono'})[value]||'Movimiento'}
function escapeHtml(value){return String(value).replace(/[&<>'"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[c]));}
