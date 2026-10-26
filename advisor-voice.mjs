// Short, approved-site guidance. No prices, stock lookup or AI claims.
export const TOPICS = Object.freeze({
  welcome: {
    label: 'Bienvenida',
    text: 'Hola. Soy el asesor virtual de R H O Seguridad Industrial. Selecciona un tema y te explicaré cómo comprar, consultar envíos o solicitar tu factura.',
    href: 'portafolio.html', action: 'Explorar productos'
  },
  products: {
    label: 'Cómo comprar',
    text: 'Entra a Productos y busca el artículo que necesitas. Revisa su modelo, talla, precio y piezas disponibles antes de agregarlo al carrito. Si necesitas más piezas de las disponibles, solicita un pedido especial.',
    href: 'portafolio.html', action: 'Ver productos'
  },
  shipping: {
    label: 'Envíos',
    text: 'Realizamos envíos en Ciudad de México. Consulta Envíos y entregas para conocer las modalidades, los plazos y los requisitos de envío gratis. Revisa el costo y el total de tu compra antes de pagar.',
    href: 'envios-entregas.html', action: 'Consultar envíos'
  },
  invoice: {
    label: 'Facturación',
    text: 'Para solicitar tu factura, abre Facturación. Ten a la mano tu ticket y tu Constancia de Situación Fiscal. Completa los datos de tu compra y los datos fiscales. El equipo de R H O revisará tu solicitud antes de emitir la factura.',
    href: 'facturacion.html', action: 'Solicitar factura'
  },
  special: {
    label: 'Pedido especial',
    text: 'Si necesitas una cantidad mayor a las existencias, prepara el nombre del artículo, modelo, talla, cantidad, código postal y fecha deseada. Solicita la cotización por WhatsApp. El precio final, envío y fecha de entrega se acuerdan antes del pago.',
    href: 'https://wa.me/525545683441?text=Hola%20RHO%2C%20necesito%20cotizar%20un%20pedido%20especial.%0AArt%C3%ADculo%3A%20%0AModelo%20o%20talla%3A%20%0ACantidad%3A%20%0AC%C3%B3digo%20postal%3A%20%0AFecha%20deseada%3A%20',
    action: 'Preparar pedido en WhatsApp'
  }
});

export function chooseSpanishVoice(voices = []) {
  const spanish = voices.filter(v => /^es(?:[-_]|$)/i.test(v.lang));
  return spanish.find(v => /^es[-_]MX$/i.test(v.lang)) || spanish.find(v => v.localService) || spanish[0] || null;
}

export class RhoVoice {
  constructor({ synth, Utterance, onState = () => {} }) {
    this.synth = synth;
    this.Utterance = Utterance;
    this.onState = onState;
    this.active = null;
    this.timer = null;
  }
  get supported() { return Boolean(this.synth && this.Utterance); }
  stop() {
    const owned = this.active;
    this.active = null;
    clearTimeout(this.timer);
    if (owned && this.supported) this.synth.cancel();
    this.onState('idle');
  }
  speak(text) {
    this.stop();
    if (!this.supported) { this.onState('unavailable'); return; }
    const utterance = new this.Utterance(text);
    const voice = chooseSpanishVoice(this.synth.getVoices());
    if (voice) utterance.voice = voice;
    utterance.lang = voice?.lang || 'es-MX';
    utterance.rate = 0.95;
    utterance.pitch = 1;
    this.active = utterance; // Keep a reference for browsers that collect utterances early.
    const current = () => this.active === utterance;
    const finish = state => {
      if (!current()) return;
      clearTimeout(this.timer);
      this.active = null;
      this.onState(state);
    };
    utterance.onstart = () => {
      if (!current()) return;
      clearTimeout(this.timer);
      this.onState('speaking');
    };
    utterance.onend = () => finish('idle');
    utterance.onerror = () => finish('unavailable');
    this.onState('loading');
    // A browser without a functioning voice service must not stay "speaking".
    this.timer = setTimeout(() => {
      if (!current()) return;
      this.stop();
      this.onState('unavailable');
    }, 8000);
    try {
      if (this.synth.paused) this.synth.resume();
      this.synth.speak(utterance); // Called synchronously from the visitor's click.
    } catch { finish('unavailable'); }
  }
}
