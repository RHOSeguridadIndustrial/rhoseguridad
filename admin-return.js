// Exact internal destinations only; never accept an arbitrary redirect URL.
const allowed=new Set(['admin.html','admin-precios.html','admin-pedidos.html','admin-inventario.html','admin-lealtad.html','admin-compras.html','admin-transfer-pruebas.html','checkout-prueba.html']);
export function adminReturnTarget(search){
 const requested=new URLSearchParams(search).get('next');
 return allowed.has(requested)?requested:'admin.html';
}
export function adminVerificationUrl(search){
 return 'admin-seguridad.html?next='+encodeURIComponent(adminReturnTarget(search));
}
