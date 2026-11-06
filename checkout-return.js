// A small allowlist preserves checkout after login without accepting open redirects.
export function checkoutReturnTarget(search) {
 const target=new URLSearchParams(search).get('next');
 if(target==='checkout-tarjeta.html')return target;
 const match=/^pago-exitoso\.html\?session_id=(cs_live_[A-Za-z0-9_]{1,240})$/.exec(target||'');
 return match?'pago-exitoso.html?session_id='+match[1]:null;
}
export function customerReturnTarget(search){return checkoutReturnTarget(search)||'cuenta.html';}
