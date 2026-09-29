const menuBtn=document.querySelector('.menu-btn');
const nav=document.querySelector('.nav');
if(menuBtn&&nav){menuBtn.addEventListener('click',()=>{nav.classList.toggle('open');menuBtn.setAttribute('aria-expanded',nav.classList.contains('open'));});document.querySelectorAll('.nav a').forEach(a=>a.addEventListener('click',()=>nav.classList.remove('open')));}
const year=document.getElementById('year');if(year) year.textContent=new Date().getFullYear();
const quoteForm=document.getElementById('quoteForm');if(quoteForm){quoteForm.addEventListener('submit',e=>{e.preventDefault();const d=new FormData(e.target);const t=`Hola RHO Seguridad Industrial, soy ${d.get('nombre')}${d.get('empresa')?` de ${d.get('empresa')}`:''}. Necesito cotizar: ${d.get('mensaje')}`;window.open(`https://wa.me/525545683441?text=${encodeURIComponent(t)}`,'_blank');});}
const carousel=document.querySelector('.banner-carousel');
const slides=[...document.querySelectorAll('.banner-slide')];
const dots=[...document.querySelectorAll('.banner-dot')];
let currentSlide=0,bannerTimer=null;
function forceMobileFit(){
  if(!carousel)return;
  carousel.style.removeProperty('height');
  carousel.style.removeProperty('min-height');
  carousel.style.removeProperty('max-height');
  slides.forEach(slide=>{
    slide.style.removeProperty('height');
    slide.style.removeProperty('min-height');
    slide.style.removeProperty('max-height');
    slide.style.removeProperty('margin');
    slide.style.removeProperty('overflow');
    slide.style.removeProperty('background');
    const img=slide.querySelector('img');
    if(img){
      img.style.removeProperty('position');
      img.style.removeProperty('inset');
      img.style.removeProperty('width');
      img.style.removeProperty('height');
      img.style.removeProperty('min-height');
      img.style.removeProperty('max-height');
      img.style.removeProperty('object-fit');
      img.style.removeProperty('object-position');
      img.style.removeProperty('transform');
      img.style.removeProperty('background');
    }
  });
}
function loadSlideImage(index,priority='auto'){const img=slides[index]?.querySelector('img');if(!img)return;if(priority!=='auto')img.fetchPriority=priority;const done=()=>{if(index===0)carousel?.classList.add('loaded');forceMobileFit();};if(img.complete&&img.naturalWidth){done();return;}img.addEventListener('load',done,{once:true});if(img.dataset.src){img.src=img.dataset.src;img.removeAttribute('data-src');}}
function showSlide(index){if(!slides.length)return;currentSlide=(index+slides.length)%slides.length;loadSlideImage(currentSlide,currentSlide===0?'high':'low');slides.forEach((slide,i)=>slide.classList.toggle('active',i===currentSlide));dots.forEach((dot,i)=>dot.classList.toggle('active',i===currentSlide));forceMobileFit();}
function restartBannerTimer(){if(bannerTimer)clearInterval(bannerTimer);if(slides.length>1)bannerTimer=setInterval(()=>showSlide(currentSlide+1),5000);}
dots.forEach((dot,i)=>dot.addEventListener('click',()=>{showSlide(i);restartBannerTimer();}));
if(carousel&&slides.length>1){
  let touchStartX=0,touchStartY=0,lastTouchX=0,lastTouchY=0,touchStartTime=0,isHorizontalDrag=false;
  carousel.style.touchAction='pan-y pinch-zoom';
  carousel.style.webkitUserSelect='none';
  carousel.style.userSelect='none';
  carousel.querySelectorAll('img').forEach(img=>{img.draggable=false;img.style.webkitUserDrag='none';});

  carousel.addEventListener('touchstart',e=>{
    const t=e.touches&&e.touches[0];
    if(!t)return;
    touchStartX=lastTouchX=t.clientX;
    touchStartY=lastTouchY=t.clientY;
    touchStartTime=Date.now();
    isHorizontalDrag=false;
  },{passive:true});

  carousel.addEventListener('touchmove',e=>{
    const t=e.touches&&e.touches[0];
    if(!t)return;
    lastTouchX=t.clientX;
    lastTouchY=t.clientY;
    const dx=lastTouchX-touchStartX;
    const dy=lastTouchY-touchStartY;
    if(Math.abs(dx)>12&&Math.abs(dx)>Math.abs(dy)*1.05){
      isHorizontalDrag=true;
      e.preventDefault();
    }
  },{passive:false});

  carousel.addEventListener('touchend',e=>{
    const t=e.changedTouches&&e.changedTouches[0];
    if(t){lastTouchX=t.clientX;lastTouchY=t.clientY;}
    const dx=lastTouchX-touchStartX;
    const dy=lastTouchY-touchStartY;
    const elapsed=Date.now()-touchStartTime;
    if(isHorizontalDrag&&Math.abs(dx)>=30&&Math.abs(dx)>Math.abs(dy)&&elapsed<1500){
      showSlide(currentSlide+(dx<0?1:-1));
      restartBannerTimer();
    }
    isHorizontalDrag=false;
  },{passive:true});

  let pointerStartX=0,pointerStartY=0,pointerActive=false;
  carousel.addEventListener('pointerdown',e=>{
    if(e.pointerType==='touch')return;
    if(e.pointerType==='mouse'&&e.button!==0)return;
    pointerActive=true;
    pointerStartX=e.clientX;
    pointerStartY=e.clientY;
  },{passive:true});
  carousel.addEventListener('pointerup',e=>{
    if(e.pointerType==='touch'||!pointerActive)return;
    pointerActive=false;
    const dx=e.clientX-pointerStartX;
    const dy=e.clientY-pointerStartY;
    if(Math.abs(dx)>=30&&Math.abs(dx)>Math.abs(dy)*1.05){
      showSlide(currentSlide+(dx<0?1:-1));
      restartBannerTimer();
    }
  },{passive:true});
}slides.forEach((slide,i)=>slide.classList.toggle('active',i===0));dots.forEach((dot,i)=>dot.classList.toggle('active',i===0));
const beginBannerLoading=()=>{forceMobileFit();loadSlideImage(0,'high');restartBannerTimer();};if(document.readyState==='loading'){document.addEventListener('DOMContentLoaded',()=>requestAnimationFrame(beginBannerLoading),{once:true});}else{requestAnimationFrame(beginBannerLoading);}window.addEventListener('resize',forceMobileFit,{passive:true});
const loadAnalytics=()=>import('./analytics.js').catch(()=>{});if('requestIdleCallback' in window){requestIdleCallback(loadAnalytics,{timeout:4000});}else{setTimeout(loadAnalytics,4000);}