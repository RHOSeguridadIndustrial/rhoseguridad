import test from 'node:test';
import assert from 'node:assert/strict';
import { RhoVoice, chooseSpanishVoice, TOPICS } from '../advisor-voice.mjs';

function setup() {
  const calls = [], states = [];
  const synth = { getVoices: () => [{ lang: 'en-US' }, { lang: 'es-MX', name: 'MX' }], speak: u => calls.push(u), cancel: () => calls.push('cancel'), paused: false };
  const voice = new RhoVoice({ synth, Utterance: class { constructor(text) { this.text = text; } }, onState: state => states.push(state) });
  return { voice, calls, states, synth };
}
test('initializing never starts playback and Mexican Spanish is preferred', () => {
  const { voice, calls } = setup(); assert.equal(calls.length, 0);
  voice.speak(TOPICS.welcome.text); assert.equal(calls[0].lang, 'es-MX'); voice.stop();
  assert.equal(chooseSpanishVoice([{ lang: 'en-US' }]), null);
});
test('changing topic cancels prior audio and late callbacks cannot affect new audio', () => {
  const { voice, calls, states } = setup();
  voice.speak('uno'); const first = calls[0]; first.onstart();
  voice.speak('dos'); const second = calls[2]; second.onstart();
  first.onend(); first.onerror(); assert.equal(states.at(-1), 'speaking');
  assert.equal(voice.active, second); voice.stop(); second.onstart(); assert.equal(states.at(-1), 'idle');
});
test('stop before use does not cancel another component audio; repeated stop is safe', () => {
  const { voice, calls } = setup(); voice.stop(); assert.equal(calls.length, 0);
  voice.speak('hola'); voice.stop(); voice.stop(); assert.equal(calls.filter(c => c === 'cancel').length, 1);
});
test('missing or failing audio service returns a usable fallback', () => {
  const states = []; new RhoVoice({ onState: s => states.push(s) }).speak('hola');
  assert.equal(states.at(-1), 'unavailable');
  const { voice, synth, states: results } = setup(); synth.speak = () => { throw Error('no audio'); };
  voice.speak('hola'); assert.equal(results.at(-1), 'unavailable'); assert.equal(voice.active, null);
});
