'use strict';
/* Tiny WebAudio synth — no files. Subtle for normal actions, bigger for moments. */
const SOUND = (() => {
  let ctx = null, on = true;
  const ac = () => (ctx ||= new (window.AudioContext || window.webkitAudioContext)());
  function env(node, t0, a, d, peak) {
    const g = ac().createGain();
    g.gain.setValueAtTime(0, t0);
    g.gain.linearRampToValueAtTime(peak, t0 + a);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + a + d);
    node.connect(g); g.connect(ac().destination);
    return g;
  }
  function noise(t0, dur, freq, q, peak) {
    const len = Math.ceil(ac().sampleRate * dur);
    const buf = ac().createBuffer(1, len, ac().sampleRate);
    const data = buf.getChannelData(0);
    for (let i = 0; i < len; i++) data[i] = (Math.random() * 2 - 1) * (1 - i / len);
    const src = ac().createBufferSource(); src.buffer = buf;
    const f = ac().createBiquadFilter(); f.type = 'bandpass'; f.frequency.value = freq; f.Q.value = q;
    src.connect(f); env(f, t0, 0.005, dur, peak); src.start(t0); src.stop(t0 + dur + 0.05);
  }
  function tone(t0, freq, dur, type = 'sine', peak = 0.15, slideTo) {
    const o = ac().createOscillator(); o.type = type; o.frequency.setValueAtTime(freq, t0);
    if (slideTo) o.frequency.exponentialRampToValueAtTime(slideTo, t0 + dur);
    env(o, t0, 0.008, dur, peak); o.start(t0); o.stop(t0 + dur + 0.05);
  }
  const play = fn => { if (!on) return; try { ac().resume(); fn(ac().currentTime + 0.02); } catch (e) {} };

  return {
    toggle() { on = !on; return on; }, get on() { return on; },
    click()   { play(t => tone(t, 620, 0.05, 'triangle', 0.08)); },
    deal()    { play(t => { noise(t, 0.12, 3200, 0.9, 0.16); tone(t, 240, 0.06, 'sine', 0.05); }); },
    land()    { play(t => { noise(t, 0.07, 1500, 1.2, 0.12); tone(t + 0.01, 130, 0.09, 'sine', 0.1); }); },
    flip()    { play(t => { noise(t, 0.1, 2400, 0.8, 0.1); noise(t + 0.06, 0.08, 1400, 1, 0.08); }); },
    chip()    { play(t => { for (let i = 0; i < 3; i++) noise(t + i * 0.03, 0.05, 5200 + i * 900, 3, 0.09); }); },
    chipsWin(){ play(t => { for (let i = 0; i < 8; i++) noise(t + i * 0.045, 0.06, 4200 + Math.random() * 3500, 3, 0.1); }); },
    lose()    { play(t => tone(t, 220, 0.3, 'sine', 0.12, 110)); },
    shuffle() { play(t => { for (let i = 0; i < 10; i++) noise(t + i * 0.05, 0.05, 2000 + Math.random() * 2500, 1.5, 0.07); }); },
    turn()    { play(t => { tone(t, 520, 0.09, 'sine', 0.07); tone(t + 0.07, 780, 0.12, 'sine', 0.07); }); },
    blackjack(){ play(t => { [523, 659, 784, 1047].forEach((f, i) => tone(t + i * 0.09, f, 0.35, 'triangle', 0.14)); }); },
    bust()    { play(t => { tone(t, 300, 0.4, 'sawtooth', 0.1, 70); noise(t, 0.25, 500, 0.6, 0.12); }); },
    win()     { play(t => { [660, 880].forEach((f, i) => tone(t + i * 0.1, f, 0.3, 'triangle', 0.12)); }); },
    push()    { play(t => tone(t, 440, 0.2, 'sine', 0.08)); },
    join()    { play(t => { tone(t, 400, 0.12, 'sine', 0.1, 800); tone(t + 0.1, 900, 0.2, 'sine', 0.1); }); },
    count(step){ play(t => tone(t, step ? 500 : 760, 0.14, 'square', 0.06)); },
  };
})();
