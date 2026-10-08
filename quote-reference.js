import { supabase } from './supabase-client.js?v=20260918-card-checkout';

// The server assigns the shared consecutive number; the browser only retains a
// random retry token. This never creates a paid order or reserves inventory.
const storageKey = 'rho-whatsapp-request-reference-v3';
const referencePattern = /^RHO-\d{8}$/;
const tokenPattern = /^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i;
let lastRequest = null;

function persist(request) {
  try { sessionStorage.setItem(storageKey, JSON.stringify(request)); } catch { /* Storage is optional. */ }
}

export async function getQuoteReference({ items, name, company }) {
  const date = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Mexico_City' }).format(new Date());
  const snapshot = JSON.stringify({
    date, name: name.trim(), company: company.trim(),
    items: items.map(item => ({ id: item.id, name: item.name, qty: Number(item.qty), price: Number(item.price) }))
      .sort((a, b) => String(a.id).localeCompare(String(b.id)))
  });
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(snapshot));
  const signature = Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, '0')).join('');
  if (!lastRequest) {
    try { lastRequest = JSON.parse(sessionStorage.getItem(storageKey)); } catch { /* Storage is optional. */ }
  }
  if (lastRequest?.signature !== signature || !tokenPattern.test(lastRequest.requestKey)) {
    lastRequest = { signature, requestKey: crypto.randomUUID() };
    // Save before the network call so a lost response can be retried safely.
    persist(lastRequest);
  }
  const request = lastRequest;
  if (referencePattern.test(request.reference) && request.reference !== 'RHO-00000000') return request.reference;
  const { data, error } = await supabase.functions.invoke('quote-reference', {
    body: { request_key: request.requestKey, fingerprint: signature }
  });
  if (error || !referencePattern.test(data?.reference) || data.reference === 'RHO-00000000') {
    throw new Error('No pudimos preparar tu solicitud. Intenta de nuevo.');
  }
  request.reference = data.reference;
  if (lastRequest === request) persist(request);
  return request.reference;
}
