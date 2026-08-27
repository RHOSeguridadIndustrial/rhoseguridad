const menuBtn=document.querySelector('.menu-btn');
const nav=document.querySelector('.nav');

if(menuBtn&&nav){
  menuBtn.addEventListener('click',()=>{
    nav.classList.toggle('open');
    menuBtn.setAttribute('aria-expanded',nav.classList.contains('open'));
  });
  document.querySelectorAll('.nav a').forEach(a=>a.addEventListener('click',()=>nav.classList.remove('open')));
}

const year=document.getElementById('year');
if(year) year.textContent=new Date().getFullYear();

const quoteForm=document.getElementById('quoteForm');
if(quoteForm){
  quoteForm.addEventListener('submit',e=>{
    e.preventDefault();
    const d=new FormData(e.target);
    const t=`Hola RHO Seguridad Industrial, soy ${d.get('nombre')}${d.get('empresa')?` de ${d.get('empresa')}`:''}. Necesito cotizar: ${d.get('mensaje')}`;
    window.open(`https://wa.me/525569090204?text=${encodeURIComponent(t)}`,'_blank');
  });
}

const carousel=document.querySelector('.banner-carousel');
const slides=[...document.querySelectorAll('.banner-slide')];
const dots=[...document.querySelectorAll('.banner-dot')];
let currentSlide=0;
let bannerTimer=null;

function loadSlideImage(index,priority='auto'){
  const img=slides[index]?.querySelector('img[data-src]');
  if(!img||!img.dataset.src) return;
  if(priority!=='auto') img.fetchPriority=priority;
  if(index===0){
    img.addEventListener('load',()=>carousel?.classList.add('loaded'),{once:true});
  }
  img.src=img.dataset.src;
  img.removeAttribute('data-src');
}

function showSlide(index){
  if(!slides.length) return;
  currentSlide=(index+slides.length)%slides.length;
  loadSlideImage(currentSlide,currentSlide===0?'high':'low');
  slides.forEach((slide,i)=>slide.classList.toggle('active',i===currentSlide));
  dots.forEach((dot,i)=>dot.classList.toggle('active',i===currentSlide));
}

function restartBannerTimer(){
  if(bannerTimer) clearInterval(bannerTimer);
  if(slides.length>1){
    bannerTimer=setInterval(()=>showSlide(currentSlide+1),5000);
  }
}

dots.forEach((dot,i)=>dot.addEventListener('click',()=>{
  showSlide(i);
  restartBannerTimer();
}));

slides.forEach((slide,i)=>slide.classList.toggle('active',i===0));
dots.forEach((dot,i)=>dot.classList.toggle('active',i===0));

const beginBannerLoading=()=>{
  loadSlideImage(0,'high');
  setTimeout(()=>loadSlideImage(1,'low'),3400);
  restartBannerTimer();
};

if(document.readyState==='loading'){
  document.addEventListener('DOMContentLoaded',()=>requestAnimationFrame(beginBannerLoading),{once:true});
}else{
  requestAnimationFrame(beginBannerLoading);
}

import('./analytics.js').catch(()=>{});
