// RHO global footer — standard approved 2026-09-21
(function(){
  function renderRhoFooter(){
    if(!document.getElementById('rho-global-footer-style')){
      const style=document.createElement('style');
      style.id='rho-global-footer-style';
      style.textContent=`
        .rho-global-footer{box-sizing:border-box;width:100%;margin-top:28px;padding:38px 18px 34px;background:#051a38;color:#fff;text-align:center;font-family:Arial,Helvetica,sans-serif}
        .rho-global-footer__logo{font-size:clamp(54px,8vw,86px);font-weight:800;line-height:.95;letter-spacing:.01em}
        .rho-global-footer__logo .r{color:#fff}.rho-global-footer__logo .h{color:#f15a24}.rho-global-footer__logo .o{color:#4ca500}
        .rho-global-footer__sub{margin-top:14px;font-size:clamp(18px,2.6vw,28px);line-height:1.2;font-weight:400}
        .rho-global-footer__copy{margin-top:24px;font-size:clamp(14px,2.3vw,24px);line-height:1.35;font-weight:400}
        .rho-global-footer__privacy{display:inline-block;margin-top:22px;color:#fff;text-decoration:underline;text-underline-offset:4px;font-size:clamp(15px,2.1vw,22px);font-weight:400}
        .rho-global-footer__privacy:hover,.rho-global-footer__privacy:focus{color:#cfe7bd}
        @media(max-width:800px){
          .rho-global-footer{margin-top:18px;padding:30px 14px 28px}
          .rho-global-footer__logo{font-size:58px}
          .rho-global-footer__sub{margin-top:11px;font-size:18px}
          .rho-global-footer__copy{margin-top:20px;font-size:13px}
          .rho-global-footer__privacy{margin-top:16px;font-size:18px}
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