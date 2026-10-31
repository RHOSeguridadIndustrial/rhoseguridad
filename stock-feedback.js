// Transient availability feedback for catalog, search and quantity changes.
// The cart remains a quotation request; it does not reserve physical stock.
let connection = 'loading';
let inventory = new Map();
let hideTimer;
export const STOCK_NOTICE_MS = 3000;

export function setStockSnapshot(state, rows = []) {
  connection = state;
  inventory = new Map(rows.map(row => [row.sku, row]));
}

export function stockNoticeForRequest(state, item, previous, requested) {
  if (!Number.isFinite(requested) || requested <= previous || requested < 1) return null;
  if (state !== 'ready' || !item || !item.is_active ||
      !['tracked', 'pending'].includes(item.state) ||
      !Number.isInteger(item.quantity) || item.quantity < 0) {
    return { title: 'Disponibilidad por confirmar', message: 'Confirma las existencias al cotizar tu pedido.' };
  }
  if (requested <= item.quantity) return null;
  return item.quantity === 0
    ? { title: 'Sin existencias disponibles', message: 'Puedes cotizar este artículo como pedido especial.' }
    : { title: 'La cantidad supera las existencias', message: `Disponibles: ${item.quantity}. Cotiza el excedente como pedido especial.` };
}

export function notifyStockRequest(sku, previous, requested) {
  const notice = stockNoticeForRequest(connection, inventory.get(sku), previous, requested);
  if (!notice) return;
  let popup = document.getElementById('rho-stock-notice');
  if (!popup) {
    const style = document.createElement('style');
    style.textContent = '#rho-stock-notice{position:fixed;z-index:10000;top:50%;left:50%;transform:translate(-50%,-50%);box-sizing:border-box;width:calc(100vw - 32px);max-width:360px;padding:20px 22px;border:1px solid #dce7d5;border-top:4px solid #4ca500;border-radius:16px;background:#fff;color:#071a35;box-shadow:0 16px 60px #071a353b;font:400 16px/1.45 Arial,Helvetica,sans-serif;text-align:center;pointer-events:none;overflow-wrap:anywhere}#rho-stock-notice[hidden]{display:none!important}#rho-stock-notice strong{display:block;font-size:18px;line-height:1.3;margin-bottom:7px}#rho-stock-notice p{margin:0;font:inherit;color:#46566b}';
    document.head.append(style);
    popup = document.createElement('div');
    popup.id = 'rho-stock-notice';
    popup.setAttribute('role', 'status');
    popup.setAttribute('aria-live', 'polite');
    popup.setAttribute('aria-atomic', 'true');
    popup.hidden = true;
    popup.append(document.createElement('strong'), document.createElement('p'));
    document.body.append(popup);
    document.addEventListener('keydown', event => { if (event.key === 'Escape') popup.hidden = true; });
  }
  clearTimeout(hideTimer);
  popup.querySelector('strong').textContent = notice.title;
  popup.querySelector('p').textContent = notice.message;
  popup.hidden = false;
  hideTimer = setTimeout(() => { popup.hidden = true; }, STOCK_NOTICE_MS);
}
