import { RhoVoice, TOPICS } from './advisor-voice.mjs?v=20261025-avatar1';

if (!document.getElementById('rho-voice-advisor')) {
  const host = document.createElement('aside');
  host.id = 'rho-voice-advisor';
  host.setAttribute('aria-label', 'Asesor virtual RHO con voz');
  const root = host.attachShadow({ mode: 'open' });
  const asset = path => new URL(path, import.meta.url).href;
  root.innerHTML = `
    <link rel="stylesheet" href="${asset('advisor-avatar.css?v=20261025-avatar1')}">
    <section class="panel" id="rho-advisor-panel" role="dialog" aria-modal="false" aria-labelledby="advisor-title" hidden>
      <header class="header"><div><span class="eyebrow">TE ACOMPAÑAMOS</span><h2 id="advisor-title">Asesor RHO</h2></div><button class="close" type="button" aria-label="Cerrar asesor">×</button></header>
      <div class="stage" aria-hidden="true"><span class="halo"></span><div class="portrait"><img class="rest" data-rho-no-fallback="true" alt="" width="1254" height="1254"><img class="talk" data-rho-no-fallback="true" alt="" width="1254" height="1254"></div><span class="voice-badge"><i></i>Asistente virtual</span></div>
      <div class="content"><p class="prompt">¿En qué te puedo orientar?</p>
        <div class="topics" aria-label="Elegir orientación por voz">${Object.entries(TOPICS).filter(([id]) => id !== 'welcome').map(([id, topic]) => `<button type="button" data-topic="${id}" aria-pressed="false">${topic.label}</button>`).join('')}</div>
        <button class="play" type="button"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="m8 5 11 7-11 7Z"/></svg><span>Escuchar bienvenida</span></button>
        <p class="status" role="status">Pulsa para activar la voz.</p>
        <a class="destination" href="portafolio.html">Explorar productos <span aria-hidden="true">↗</span></a>
        <details class="transcript"><summary>Ver subtítulos</summary><p></p></details>
      </div>
    </section>
    <button class="launcher" type="button" aria-expanded="false" aria-controls="rho-advisor-panel"><span class="mini"><img src="${asset('assets/rho-asesor-avatar.png')}" data-rho-no-fallback="true" alt="" width="72" height="72" loading="lazy" decoding="async"></span><span>Asesor RHO<small>Escucha cómo comprar</small></span><svg viewBox="0 0 24 24" aria-hidden="true"><path d="m3 9 4 0 5-4v14l-5-4H3ZM16 8a6 6 0 0 1 0 8M19 5a10 10 0 0 1 0 14"/></svg></button>`;
  document.body.appendChild(host);
  const $ = selector => root.querySelector(selector);
  const panel = $('.panel'), launcher = $('.launcher'), play = $('.play');
  const status = $('.status'), destination = $('.destination');
  let selected = 'welcome', state = 'idle', loaded = false;
  const voice = new RhoVoice({
    synth: window.speechSynthesis,
    Utterance: window.SpeechSynthesisUtterance,
    onState(next) {
      state = next;
      panel.classList.toggle('speaking', next === 'speaking');
      const active = next === 'loading' || next === 'speaking';
      play.classList.toggle('active', active);
      play.querySelector('span').textContent = active ? 'Detener audio' : selected === 'welcome' ? 'Escuchar bienvenida' : 'Volver a escuchar';
      status.textContent = next === 'speaking' ? 'Hablando en español…' : next === 'loading' ? 'Preparando la voz…' : next === 'unavailable' ? 'No se pudo reproducir la voz. Prueba de nuevo o consulta los subtítulos.' : 'Selecciona un tema para escucharlo.';
      if (next === 'unavailable') $('.transcript').open = true;
    }
  });
  function updateTopic(id) {
    selected = id;
    $('.transcript p').textContent = TOPICS[id].text;
    destination.href = TOPICS[id].href;
    destination.textContent = TOPICS[id].action + ' ↗';
    const external = TOPICS[id].href.startsWith('https://');
    if (external) { destination.target = '_blank'; destination.rel = 'noopener noreferrer'; }
    else { destination.removeAttribute('target'); destination.removeAttribute('rel'); }
    root.querySelectorAll('[data-topic]').forEach(button => button.setAttribute('aria-pressed', String(button.dataset.topic === id)));
  }
  updateTopic('welcome');
  function setOpen(open) {
    panel.hidden = !open;
    launcher.setAttribute('aria-expanded', String(open));
    launcher.hidden = open;
    if (open) {
      if (!loaded) {
        $('.rest').src = asset('assets/rho-asesor-avatar.png');
        $('.talk').src = asset('assets/rho-asesor-avatar-hablando.png');
        $('.talk').addEventListener('load', () => panel.classList.add('animation-ready'), { once: true });
        loaded = true;
      }
      // Opening never starts audio, including when opened through a link.
      $('.close').focus({ preventScroll: true });
      if (!voice.supported) {
        status.textContent = 'Este navegador no permite voz. Consulta los subtítulos y los enlaces.';
        $('.transcript').open = true;
        play.disabled = true;
      }
    } else { voice.stop(); launcher.focus({ preventScroll: true }); }
  }
  launcher.addEventListener('click', () => setOpen(true));
  $('.close').addEventListener('click', () => setOpen(false));
  root.addEventListener('keydown', event => { if (event.key === 'Escape') { setOpen(false); event.stopPropagation(); } });
  root.querySelectorAll('[data-topic]').forEach(button => button.addEventListener('click', () => {
    updateTopic(button.dataset.topic);
    voice.speak(TOPICS[selected].text);
  }));
  play.addEventListener('click', () => {
    if (state === 'loading' || state === 'speaking') voice.stop();
    else voice.speak(TOPICS[selected].text);
  });
  destination.addEventListener('click', () => voice.stop());
  document.addEventListener('visibilitychange', () => { if (document.hidden) voice.stop(); });
  window.addEventListener('pagehide', () => voice.stop());
  if (new URLSearchParams(location.search).get('asesor') === '1') setOpen(true);
}
