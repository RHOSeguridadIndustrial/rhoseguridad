// RHO global footer — standard approved 2026-09-21
(function(){
  function renderRhoFooter(){
    if(!document.getElementById('rho-global-footer-style')){
      const style=document.createElement('style');
      style.id='rho-global-footer-style';
      style.textContent=`
        .rho-global-footer{box-sizing:border-box!important;display:block!important;width:100%!important;max-width:none!important;margin:28px 0 0!important;padding:38px 18px 34px!important;background:#051a38!important;color:#fff!important;text-align:center!important;font-family:Arial,Helvetica,sans-serif!important}
        .rho-global-footer *{box-sizing:border-box!important}
        .rho-global-footer__logo{margin:0!important;padding:0!important;font-size:clamp(54px,8vw,86px)!important;font-weight:800!important;line-height:.95!important;letter-spacing:.01em!important}
        .rho-global-footer__logo .r{color:#fff}.rho-global-footer__logo .h{color:#f15a24}.rho-global-footer__logo .o{color:#4ca500}
        .rho-global-footer__sub{margin:14px 0 0!important;padding:0!important;font-size:clamp(18px,2.6vw,28px)!important;line-height:1.2!important;font-weight:400!important}
        .rho-global-footer__copy{margin:24px 0 0!important;padding:0!important;font-size:clamp(14px,2.3vw,24px)!important;line-height:1.35!important;font-weight:400!important}
        .rho-global-footer__privacy{display:inline-block!important;margin:22px 0 0!important;padding:0!important;color:#fff!important;text-decoration:underline!important;text-underline-offset:4px!important;font-size:clamp(15px,2.1vw,22px)!important;font-weight:400!important}
        .rho-global-footer__privacy:hover,.rho-global-footer__privacy:focus{color:#cfe7bd}
        @media(max-width:800px){
          .rho-global-footer{margin-top:18px!important;padding:30px 14px 28px!important}
          .rho-global-footer__logo{font-size:58px!important}
          .rho-global-footer__sub{margin-top:11px!important;font-size:18px!important}
          .rho-global-footer__copy{margin-top:20px!important;font-size:13px!important}
          .rho-global-footer__privacy{margin-top:16px!important;font-size:18px!important}
        }
      `;
      document.head.appendChild(style);
    }
    const footer=document.createElement('footer');
    footer.className='rho-global-footer';
    footer.innerHTML='<div class="rho-global-footer__logo" aria-label="RHO"><span class="r">R</span><span class="h">H</span><span class="o">O</span></div><div class="rho-global-footer__sub">Seguridad Industrial</div><div class="rho-global-footer__copy">© 2026 RHO Seguridad Industrial. Todos los derechos reservados.</div><a class="rho-global-footer__privacy" href="aviso-privacidad.html">Aviso de privacidad</a>';
    const existing=[...document.querySelectorAll('footer')];
    if(existing.length){existing[0].replaceWith(footer);existing.slice(1).forEach(node=>node.remove())}
    else document.body.appendChild(footer);
  }
  if(document.readyState==='loading') document.addEventListener('DOMContentLoaded',renderRhoFooter,{once:true});
  else renderRhoFooter();
})();