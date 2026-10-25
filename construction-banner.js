// Independent from the promotional carousel at the top of the home page.
(() => {
  const banner = document.querySelector('[data-construction-banner]');
  if (!banner) return;

  const slides = [...banner.querySelectorAll('[data-construction-slide]')];
  const dots = [...banner.querySelectorAll('[data-construction-dot]')];
  const controls = banner.querySelector('[data-construction-controls]');
  const pause = banner.querySelector('[data-construction-pause]');
  const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
  let current = 0;
  let paused = reducedMotion.matches;
  let timer;

  if (slides.length < 2 || !controls || !pause) return;

  function show(index) {
    current = index;
    slides.forEach((slide, i) => { slide.hidden = i !== current; });
    dots.forEach((dot, i) => { dot.setAttribute('aria-pressed', String(i === current)); });
  }

  function schedule() {
    window.clearInterval(timer);
    if (!paused && !document.hidden) {
      timer = window.setInterval(() => show((current + 1) % slides.length), 3000);
    }
    pause.textContent = paused ? 'Reproducir' : 'Pausar';
    pause.setAttribute('aria-label', paused ? 'Reproducir cambio automático de imágenes' : 'Pausar cambio automático de imágenes');
  }

  dots.forEach((dot, index) => dot.addEventListener('click', () => {
    show(index);
    schedule();
  }));

  pause.addEventListener('click', () => {
    paused = !paused;
    schedule();
  });

  reducedMotion.addEventListener('change', event => {
    paused = event.matches;
    schedule();
  });
  document.addEventListener('visibilitychange', schedule);

  show(0);
  controls.hidden = false;
  schedule();
})();
