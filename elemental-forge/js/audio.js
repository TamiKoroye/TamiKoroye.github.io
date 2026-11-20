// Game sound. Recorded CC0 sounds (assets/sfx/bank.ogg + bank.json, built by tools/sfx-build.py from OpenGameArt
// packs; credits in assets/sfx/CREDITS.md) played through Web Audio:
//   - each sound has several takes; a different take is picked each time, with a slight pitch change, so repeats
//     never sound identical
//   - sounds placed in the arena are panned left/right and quietened with distance from the camera
//   - looping sounds (fire wall, water surf, wind glide) run while something keeps them alive with hold() each frame
//     and fade out a moment after it stops
//   - a cap on simultaneous sounds keeps phones from stuttering
// The older synthesised noises remain as a fallback if the bank cannot be loaded.
// The public method names (whoosh, impact, rumble, step, fireWhoosh, fireHit, splash, gust, hit) are kept, so
// every existing call in the game now plays recorded sound.
const MAX_VOICES = 24;

export class Audio {
  constructor() {
    this.ctx = null; this.master = null; this.noiseBuf = null; this.muted = false;
    this.bank = null; this.buf = null; this.raw = null; this.lastTake = {}; this.lastT = {};
    this.loops = new Map(); this.listener = null;
    // pacing (the same sound twice in a row, the voice cap, loop release) runs on the game clock, advanced by update(dt),
    // so it follows the game exactly, including slow motion and test runs stepped faster than real time
    this.t = 0; this.ends = [];
    // fetch the bank at once (decoding needs the audio context, created on the first tap)
    this.ready = Promise.all([
      fetch('assets/sfx/bank.json').then(r => r.json()),
      fetch('assets/sfx/bank.ogg').then(r => r.arrayBuffer()),
    ]).then(([j, b]) => { this.bank = j.sounds; this.raw = b; if (this.ctx) return this.decode(); })
      .catch(e => console.warn('sound bank not loaded; synthesised sound is used', e));
  }
  unlock() {
    if (this.ctx) { if (this.ctx.state === 'suspended') this.ctx.resume(); return; }
    const AC = window.AudioContext || window.webkitAudioContext; if (!AC) return;
    this.ctx = new AC({ latencyHint: 'interactive' });
    this.master = this.ctx.createGain(); this.master.gain.value = 0.9;
    // a gentle limiter, so stacked hits and blasts never clip
    const comp = this.ctx.createDynamicsCompressor(); comp.threshold.value = -10; comp.knee.value = 8; comp.ratio.value = 6; comp.attack.value = 0.003; comp.release.value = 0.15;
    this.master.connect(comp); comp.connect(this.ctx.destination); this.comp = comp;
    const len = this.ctx.sampleRate * 1.5, b = this.ctx.createBuffer(1, len, this.ctx.sampleRate), d = b.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
    this.noiseBuf = b;
    if (this.raw) this.decode();
  }
  decode() {
    if (this.buf || this.decoding || !this.raw) return this.decoding;
    this.decoding = this.ctx.decodeAudioData(this.raw.slice(0)).then(b => { this.buf = b; }).catch(e => console.warn('sound bank decode failed', e));
    return this.decoding;
  }
  // the camera, for panning and distance
  setListener(cam) { this.listener = cam; }

  // pan (-1..1) and gain for a world position
  place(pos) {
    const L = this.listener; if (!pos || !L) return [0, 1];
    const dx = pos.x - L.position.x, dz = pos.z - L.position.z, dy = (pos.y || 0) - L.position.y;
    const d = Math.hypot(dx, dy, dz);
    // the camera's right vector from its world matrix
    const e = L.matrixWorld.elements, rx = e[0], rz = e[2];
    const pan = Math.max(-1, Math.min(1, (dx * rx + dz * rz) / Math.max(1, d) * 0.85));
    return [pan, 1 / (1 + Math.max(0, d - 4) / 14)];
  }

  // play one take of a sound. o: { vol, rate, pos, delay, minGap }
  play(name, o = {}) {
    const c = this.ctx; if (!c || this.muted) return null;
    const S = this.bank && this.bank[name];
    if (!S || !this.buf) return null;
    const now = c.currentTime, gt = this.t;
    if (gt - (this.lastT[name] ?? -9) < (o.minGap ?? 0.035)) return null;   // the same sound twice within a few ms only gets louder
    this.ends = this.ends.filter(e => e > gt); if (this.ends.length >= MAX_VOICES) return null;
    this.lastT[name] = gt;
    const n = S.takes.length; let i = (Math.random() * n) | 0; if (n > 1 && i === this.lastTake[name]) i = (i + 1) % n; this.lastTake[name] = i;
    const [t0, dur] = S.takes[i];
    const [pan, att] = this.place(o.pos);
    const src = c.createBufferSource(); src.buffer = this.buf;
    src.playbackRate.value = (o.rate || 1) * (0.94 + Math.random() * 0.12);
    const g = c.createGain(); g.gain.value = Math.max(0, (o.vol ?? 1) * att);
    let node = src.connect(g);
    if (c.createStereoPanner && pan) { const p = c.createStereoPanner(); p.pan.value = pan; g.connect(p); node = p; }
    node === g ? g.connect(this.master) : node.connect(this.master);
    const at = now + (o.delay || 0);
    src.start(at, t0, dur); this.ends.push(gt + (o.delay || 0) + dur / src.playbackRate.value);
    if (this.onPlay) this.onPlay({ name, take: i, rate: src.playbackRate.value, vol: g.gain.value, pan, delay: o.delay || 0 });   // test captures log what played
    return src;
  }

  // keep a looping sound going (call every frame while the effect lasts). key: one loop per key
  hold(key, name, vol = 1, pos = null) {
    const c = this.ctx; if (!c || this.muted || !this.buf || !this.bank || !this.bank[name]) return;
    let L = this.loops.get(key);
    const [pan, att] = this.place(pos), target = vol * att;
    if (!L || L.name !== name) {
      if (L) this.stopLoop(key);
      const [t0, dur] = this.bank[name].takes[0];
      const src = c.createBufferSource(); src.buffer = this.buf; src.loop = true; src.loopStart = t0; src.loopEnd = t0 + dur;
      const g = c.createGain(); g.gain.value = 0.0001; src.connect(g);
      let p = null; if (c.createStereoPanner) { p = c.createStereoPanner(); g.connect(p); p.connect(this.master); } else g.connect(this.master);
      src.start(c.currentTime, t0 + Math.random() * dur * 0.5);
      L = { name, src, g, p }; this.loops.set(key, L);
    }
    if (this.onHold) this.onHold({ key, name, vol: target, pan });
    L.seen = this.t;
    L.g.gain.setTargetAtTime(Math.max(0.0001, target), c.currentTime, 0.08);
    if (L.p) L.p.pan.setTargetAtTime(pan, c.currentTime, 0.05);
  }
  // (19 Nov) a blowtorch: a held, synthesised loop (no recording in the bank fits): a hissing band of noise around
  // 2 kHz over a low roar, with a slow flutter in the hiss, kept alive each frame like hold() and faded out when it stops
  torch(key, vol = 1, pos = null) {
    const c = this.ctx; if (!c || this.muted || !this.noiseBuf) return;
    let L = this.loops.get(key);
    const [pan, att] = this.place(pos), target = 0.5 * vol * att;
    if (!L || L.name !== '~torch') {
      if (L) this.stopLoop(key);
      const src = c.createBufferSource(); src.buffer = this.noiseBuf; src.loop = true;
      const hiss = c.createBiquadFilter(); hiss.type = 'bandpass'; hiss.frequency.value = 2100; hiss.Q.value = 0.7;
      const roar = c.createBiquadFilter(); roar.type = 'lowpass'; roar.frequency.value = 300; roar.Q.value = 0.9;
      const gh = c.createGain(); gh.gain.value = 0.7; const gr = c.createGain(); gr.gain.value = 1.6;
      const lfo = c.createOscillator(); lfo.frequency.value = 9; const lg = c.createGain(); lg.gain.value = 0.18; lfo.connect(lg); lg.connect(gh.gain); lfo.start();
      const g = c.createGain(); g.gain.value = 0.0001;
      src.connect(hiss); hiss.connect(gh); gh.connect(g); src.connect(roar); roar.connect(gr); gr.connect(g);
      let p = null; if (c.createStereoPanner) { p = c.createStereoPanner(); g.connect(p); p.connect(this.master); } else g.connect(this.master);
      src.start(c.currentTime, Math.random()); 
      L = { name: '~torch', src, g, p, lfo }; this.loops.set(key, L);
    }
    L.seen = this.t;
    L.g.gain.setTargetAtTime(Math.max(0.0001, target), c.currentTime, 0.06);
    if (L.p) L.p.pan.setTargetAtTime(pan, c.currentTime, 0.05);
  }
  // (19 Nov) the roar of Dragon's Breath: the pressure of the flame, a deep growl (low-passed noise whose cut-off
  // wavers at about 6 Hz) over a rumble and a hiss, held each frame like hold()
  roar(key, vol = 1, pos = null) {
    const c = this.ctx; if (!c || this.muted || !this.noiseBuf) return;
    let L = this.loops.get(key);
    const [pan, att] = this.place(pos), target = 0.6 * vol * att;
    if (!L || L.name !== '~roar') {
      if (L) this.stopLoop(key);
      const src = c.createBufferSource(); src.buffer = this.noiseBuf; src.loop = true;
      const growl = c.createBiquadFilter(); growl.type = 'lowpass'; growl.frequency.value = 420; growl.Q.value = 4;
      const lfo = c.createOscillator(); lfo.frequency.value = 6.5; const lg = c.createGain(); lg.gain.value = 220; lfo.connect(lg); lg.connect(growl.frequency); lfo.start();
      const rumble = c.createBiquadFilter(); rumble.type = 'lowpass'; rumble.frequency.value = 110; rumble.Q.value = 1.2;
      const hiss = c.createBiquadFilter(); hiss.type = 'highpass'; hiss.frequency.value = 2500;
      const gg = c.createGain(); gg.gain.value = 1.4; const gr = c.createGain(); gr.gain.value = 2.2; const gh = c.createGain(); gh.gain.value = 0.25;
      const g = c.createGain(); g.gain.value = 0.0001;
      src.connect(growl); growl.connect(gg); gg.connect(g); src.connect(rumble); rumble.connect(gr); gr.connect(g); src.connect(hiss); hiss.connect(gh); gh.connect(g);
      let p = null; if (c.createStereoPanner) { p = c.createStereoPanner(); g.connect(p); p.connect(this.master); } else g.connect(this.master);
      src.start(c.currentTime, Math.random());
      L = { name: '~roar', src, g, p, lfo }; this.loops.set(key, L);
    }
    L.seen = this.t;
    L.g.gain.setTargetAtTime(Math.max(0.0001, target), c.currentTime, 0.05);
    if (L.p) L.p.pan.setTargetAtTime(pan, c.currentTime, 0.05);
  }
  // (20 Nov, after review) the sound of Fire's heel jets and the Comet, three layers held each frame like hold():
  //   a deep combustion roar: low-passed noise under 90 Hz, swelling at about 3 Hz;
  //   a pressurised flame rush: a broad band of noise around 900 Hz whose centre surges up and down (the WHOOSH of a
  //   rocket exhaust), with a softer high hiss;
  //   crackle: a looped buffer of sparse, irregular sharp clicks (bursts of three to six close together), high-passed.
  jet(key, vol = 1, pos = null) {
    const c = this.ctx; if (!c || this.muted || !this.noiseBuf) return;
    let L = this.loops.get(key);
    const [pan, att] = this.place(pos), target = 0.55 * vol * att;
    if (!L || L.name !== '~jet') {
      if (L) this.stopLoop(key);
      if (!this.crackleBuf) {
        const n = Math.floor(c.sampleRate * 2.3), b = c.createBuffer(1, n, c.sampleRate), d = b.getChannelData(0);
        let i = 0;
        while (i < n) {
          i += Math.floor(c.sampleRate * (0.012 + Math.random() * Math.random() * 0.14));   // irregular gaps
          const burst = 1 + Math.floor(Math.random() * Math.random() * 6);
          for (let k = 0, j = i; k < burst && j < n; k++, j += Math.floor(c.sampleRate * (0.002 + Math.random() * 0.01))) {
            const amp = 0.3 + Math.random() * 0.7, len = Math.floor(c.sampleRate * (0.0015 + Math.random() * 0.004));
            for (let m = 0; m < len && j + m < n; m++) d[j + m] += amp * (Math.random() * 2 - 1) * Math.exp(-m / (len * 0.3));
          }
        }
        this.crackleBuf = b;
      }
      const src = c.createBufferSource(); src.buffer = this.noiseBuf; src.loop = true;
      const ck = c.createBufferSource(); ck.buffer = this.crackleBuf; ck.loop = true;
      const rumble = c.createBiquadFilter(); rumble.type = 'lowpass'; rumble.frequency.value = 90; rumble.Q.value = 1.1;
      const rush = c.createBiquadFilter(); rush.type = 'bandpass'; rush.frequency.value = 900; rush.Q.value = 0.45;
      const hiss = c.createBiquadFilter(); hiss.type = 'highpass'; hiss.frequency.value = 3200;
      const crack = c.createBiquadFilter(); crack.type = 'highpass'; crack.frequency.value = 1400;
      const gR = c.createGain(); gR.gain.value = 3.2; const gW = c.createGain(); gW.gain.value = 1.3; const gH = c.createGain(); gH.gain.value = 0.22; const gC = c.createGain(); gC.gain.value = 0.9;
      const lfo = c.createOscillator(); lfo.frequency.value = 1.4; const lg = c.createGain(); lg.gain.value = 380; lfo.connect(lg); lg.connect(rush.frequency); lfo.start();
      const lfo2 = c.createOscillator(); lfo2.frequency.value = 3.1; const lg2 = c.createGain(); lg2.gain.value = 0.9; lfo2.connect(lg2); lg2.connect(gR.gain); lfo2.start();
      const g = c.createGain(); g.gain.value = 0.0001;
      src.connect(rumble); rumble.connect(gR); gR.connect(g);
      src.connect(rush); rush.connect(gW); gW.connect(g);
      src.connect(hiss); hiss.connect(gH); gH.connect(g);
      ck.connect(crack); crack.connect(gC); gC.connect(g);
      let p = null; if (c.createStereoPanner) { p = c.createStereoPanner(); g.connect(p); p.connect(this.master); } else g.connect(this.master);
      src.start(c.currentTime, Math.random()); ck.start(c.currentTime, Math.random() * 2);
      L = { name: '~jet', src, g, p, lfo, lfo2, ck }; this.loops.set(key, L);
    }
    L.seen = this.t;
    L.g.gain.setTargetAtTime(Math.max(0.0001, target), c.currentTime, 0.04);
    if (L.p) L.p.pan.setTargetAtTime(pan, c.currentTime, 0.05);
  }
  stopLoop(key) {
    const L = this.loops.get(key); if (!L) return; this.loops.delete(key);
    const c = this.ctx; L.g.gain.setTargetAtTime(0.0001, c.currentTime, 0.12); L.src.stop(c.currentTime + 0.6); if (L.lfo) L.lfo.stop(c.currentTime + 0.6); if (L.lfo2) L.lfo2.stop(c.currentTime + 0.6); if (L.ck) L.ck.stop(c.currentTime + 0.6);
  }
  // fades out loops that were not held this frame (called once per frame by the game)
  update(dt = 1 / 60) {
    this.t += dt;
    if (!this.ctx) return;
    for (const [k, L] of this.loops) if (this.t - L.seen > 0.15) this.stopLoop(k);
  }
  stopAll() { for (const k of [...this.loops.keys()]) this.stopLoop(k); }

  // ---------------------------------------------------------------- synthesised fallback
  noise(dur, type, f0, f1, vol, q = 1) {
    const c = this.ctx; if (!c || this.muted) return;
    const t = c.currentTime;
    const src = c.createBufferSource(); src.buffer = this.noiseBuf;
    const fl = c.createBiquadFilter(); fl.type = type; fl.Q.value = q;
    fl.frequency.setValueAtTime(f0, t); fl.frequency.exponentialRampToValueAtTime(Math.max(20, f1), t + dur);
    const g = c.createGain(); g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(vol, t + Math.min(0.03, dur * 0.2)); g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    src.connect(fl); fl.connect(g); g.connect(this.master);
    src.start(t, Math.random() * 0.5); src.stop(t + dur + 0.05);
  }
  tone(dur, f0, f1, vol, type = 'sine') {
    const c = this.ctx; if (!c || this.muted) return;
    const t = c.currentTime, o = c.createOscillator(), g = c.createGain();
    o.type = type; o.frequency.setValueAtTime(f0, t); o.frequency.exponentialRampToValueAtTime(Math.max(20, f1), t + dur);
    g.gain.setValueAtTime(vol, t); g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g); g.connect(this.master); o.start(t); o.stop(t + dur + 0.02);
  }
  get recorded() { return !!(this.buf && this.bank); }

  // ---------------------------------------------------------------- the game's sound calls
  // (each takes a strength k and, where known, a world position)
  whoosh(k = 0.5, pos) { if (this.recorded) return void this.play(k > 0.65 ? 'swingHeavy' : 'swing', { vol: 0.55 + 0.45 * k, pos }); this.noise(0.22 + k * 0.1, 'bandpass', 600 + k * 900, 2400, 0.25 * k + 0.05, 1.2); }
  impact(k = 1, pos) {
    if (this.recorded) { if (k >= 1) { this.play('bodyfall', { vol: Math.min(1.2, 0.6 + 0.4 * k), pos }); if (k >= 1.3) this.play('quake', { vol: 0.6, pos }); } else this.play('block', { vol: 0.6 + 0.5 * k, pos }); return; }
    this.noise(0.35, 'lowpass', 1400, 120, 0.6 * k, 0.8); this.tone(0.25, 120, 45, 0.5 * k);
  }
  // (20 Nov, after review: "the earth moves should sound powerful and devastating") the rock recordings are joined by a
  // synthesised boom: a deep thump that falls from 150 to 45 Hz with a sharp crack of stone on top, scaled by the blow
  boom(k = 1, pos) {
    const c = this.ctx; if (!c || this.muted || !this.noiseBuf) return;
    const [pan, att] = this.place(pos), t = c.currentTime, g0 = Math.min(1.6, 0.9 * k) * att;
    const out = c.createGain(); out.gain.value = 1; let p = null; if (c.createStereoPanner) { p = c.createStereoPanner(); p.pan.value = pan; out.connect(p); p.connect(this.master); } else out.connect(this.master);
    const o = c.createOscillator(); o.type = 'sine'; o.frequency.setValueAtTime(150, t); o.frequency.exponentialRampToValueAtTime(45, t + 0.45);
    const og = c.createGain(); og.gain.setValueAtTime(0.0001, t); og.gain.exponentialRampToValueAtTime(g0, t + 0.012); og.gain.exponentialRampToValueAtTime(0.0001, t + 0.6);
    o.connect(og); og.connect(out); o.start(t); o.stop(t + 0.65);
    const n = c.createBufferSource(); n.buffer = this.noiseBuf; const bp = c.createBiquadFilter(); bp.type = 'bandpass'; bp.frequency.value = 900; bp.Q.value = 0.8;
    const ng = c.createGain(); ng.gain.setValueAtTime(0.0001, t); ng.gain.exponentialRampToValueAtTime(g0 * 0.7, t + 0.005); ng.gain.exponentialRampToValueAtTime(0.0001, t + 0.18);
    n.connect(bp); bp.connect(ng); ng.connect(out); n.start(t, Math.random()); n.stop(t + 0.2);
    // a gravel tail: the debris settling
    const n2 = c.createBufferSource(); n2.buffer = this.noiseBuf; const bp2 = c.createBiquadFilter(); bp2.type = 'bandpass'; bp2.frequency.value = 450; bp2.Q.value = 0.6;
    const g2 = c.createGain(); g2.gain.setValueAtTime(0.0001, t); g2.gain.exponentialRampToValueAtTime(g0 * 0.35, t + 0.05); g2.gain.exponentialRampToValueAtTime(0.0001, t + 0.7 + 0.3 * k);
    n2.connect(bp2); bp2.connect(g2); g2.connect(out); n2.start(t, Math.random()); n2.stop(t + 1.1);
  }
  // (20 Nov, after review: "most of the rock gravelling sounds are gone") a held loop: stone grinding over stone and
  // gravel crunching under the slab, kept alive each frame like hold()
  gravel(key, vol = 1, pos = null) {
    const c = this.ctx; if (!c || this.muted || !this.noiseBuf) return;
    let L = this.loops.get(key);
    const [pan, att] = this.place(pos), target = 0.6 * vol * att;
    if (!L || L.name !== '~gravel') {
      if (L) this.stopLoop(key);
      if (!this.gravelBuf) {
        const n = Math.floor(c.sampleRate * 1.9), b = c.createBuffer(1, n, c.sampleRate), d = b.getChannelData(0);
        for (let i = 0; i < n;) { i += Math.floor(c.sampleRate * (0.004 + Math.random() * 0.03)); const amp = 0.2 + Math.random() * 0.8, len = Math.floor(c.sampleRate * (0.003 + Math.random() * 0.012)); for (let m = 0; m < len && i + m < n; m++) d[i + m] += amp * (Math.random() * 2 - 1) * Math.exp(-m / (len * 0.35)); }
        this.gravelBuf = b;
      }
      const src = c.createBufferSource(); src.buffer = this.noiseBuf; src.loop = true;
      const gr = c.createBufferSource(); gr.buffer = this.gravelBuf; gr.loop = true;
      const grind = c.createBiquadFilter(); grind.type = 'bandpass'; grind.frequency.value = 320; grind.Q.value = 1.2;
      const crunch = c.createBiquadFilter(); crunch.type = 'bandpass'; crunch.frequency.value = 1300; crunch.Q.value = 0.7;
      const gG = c.createGain(); gG.gain.value = 1.6; const gC = c.createGain(); gC.gain.value = 1.1;
      const lfo = c.createOscillator(); lfo.frequency.value = 4.3; const lg = c.createGain(); lg.gain.value = 0.6; lfo.connect(lg); lg.connect(gG.gain); lfo.start();
      const g = c.createGain(); g.gain.value = 0.0001;
      src.connect(grind); grind.connect(gG); gG.connect(g); gr.connect(crunch); crunch.connect(gC); gC.connect(g);
      let p = null; if (c.createStereoPanner) { p = c.createStereoPanner(); g.connect(p); p.connect(this.master); } else g.connect(this.master);
      src.start(c.currentTime, Math.random()); gr.start(c.currentTime, Math.random());
      L = { name: '~gravel', src, g, p, lfo, ck: gr }; this.loops.set(key, L);
    }
    L.seen = this.t;
    L.g.gain.setTargetAtTime(Math.max(0.0001, target), c.currentTime, 0.05);
    if (L.p) L.p.pan.setTargetAtTime(pan, c.currentTime, 0.05);
  }
  rumble(k = 0.6, pos) {
    if (k >= 0.6) this.boom(k, pos);
    if (this.recorded) { this.play(k >= 0.75 ? 'rockCrash' : 'rockLift', { vol: 0.8 + 0.6 * k, pos }); if (k >= 0.9) this.play('quake', { vol: 0.8 + 0.3 * k, pos }); return; }
    this.noise(0.5, 'lowpass', 300, 60, 0.6 * k, 0.7); this.tone(0.4, 70, 40, 0.35 * k, 'triangle');
  }
  step(k = 0.5, pos) {
    if (!this.ctx) return; const t = this.t; if (t - (this._lastStep ?? -9) < 0.12) return; this._lastStep = t;
    if (this.recorded) return void this.play('step', { vol: 0.35 + 0.6 * k, pos, minGap: 0.1 });
    this.noise(0.07, 'lowpass', 900, 200, 0.12 * k + 0.02, 0.7);
  }
  fireWhoosh(k = 0.6, pos) {
    if (!this.ctx) return; const t = this.t; if (t - (this._lf ?? -9) < 0.06) return; this._lf = t;
    if (this.recorded) return void this.play(k >= 0.9 ? 'fireBlast' : 'fireCast', { vol: 0.55 + 0.45 * k, pos });
    this.noise(0.35 * (0.6 + k * 0.4), 'bandpass', 380, 1600, 0.3 * k + 0.05, 0.6); this.noise(0.25, 'highpass', 2500, 4000, 0.06 * k);
  }
  fireHit(k = 0.6, pos) { if (this.recorded) return void this.play('fireHit', { vol: 0.6 + 0.4 * k, pos }); this.noise(0.4, 'lowpass', 2200, 300, 0.45 * k, 0.6); this.noise(0.3, 'highpass', 3000, 5000, 0.1 * k); }
  splash(k = 0.6, pos) {
    if (!this.ctx) return; const t = this.t; if (t - (this._ls ?? -9) < 0.06) return; this._ls = t;
    if (this.recorded) return void this.play(k >= 1 ? 'waterBig' : k >= 0.75 ? 'waterCast' : 'waterWhip', { vol: 0.6 + 0.4 * k, pos });
    this.noise(0.3, 'bandpass', 1200, 500, 0.35 * k, 2.5); this.tone(0.12, 900, 300, 0.08 * k);
  }
  // (Air brief: air sound) the sharp burst of compressed air at a palm strike, swipe or blade: a high crack sweeping
  // down into a short whoosh, layered over the recorded gust
  airBurst(k = 0.8, pos) {
    if (!this.ctx || this.muted) return; const t = this.t; if (t - (this._lab ?? -9) < 0.05) return; this._lab = t;
    this.noise(0.09, 'highpass', 5200, 1400, 0.42 * k, 0.7); this.noise(0.28, 'bandpass', 2600, 380, 0.3 * k, 1.1);
    if (this.recorded) this.play('gust', { vol: 0.45 + 0.3 * k, pos });
  }
  gust(k = 0.6, pos) {
    if (!this.ctx) return; const t = this.t; if (t - (this._lg ?? -9) < 0.06) return; this._lg = t;
    if (this.recorded) return void this.play(k >= 1 ? 'gustBig' : 'gust', { vol: 0.6 + 0.4 * k, pos });
    this.noise(0.45, 'bandpass', 300, 2400, 0.3 * k + 0.04, 0.8);
  }
  hit(k = 0.6, pos) { if (this.recorded) return void this.play(k >= 1 ? 'kick' : 'punch', { vol: 0.7 + 0.3 * k, pos }); this.noise(0.12, 'highpass', 1800, 800, 0.35 * k); this.tone(0.14, 220, 80, 0.4 * k, 'square'); }
  ice(kind = 'break', k = 0.8, pos) { if (this.recorded) return void this.play(kind === 'form' ? 'iceForm' : kind === 'hit' ? 'iceHit' : 'iceBreak', { vol: 0.6 + 0.4 * k, pos }); this.noise(0.25, 'highpass', 4000, 6000, 0.2 * k); }
  jump(k = 0.6, pos) { if (this.recorded) this.play('jump', { vol: 0.5 + 0.4 * k, pos }); }
  land(k = 0.6, pos) { if (this.recorded) return void this.play('land', { vol: 0.5 + 0.5 * k, pos }); this.step(1, pos); }
  dodge(k = 0.6, pos) { if (this.recorded) return void this.play('dodge', { vol: 0.6 + 0.4 * k, pos }); this.whoosh(k, pos); }
  bodyfall(k = 1, pos, delay = 0) { if (this.recorded) this.play('bodyfall', { vol: 0.7 + 0.3 * k, pos, delay }); }

  // a blow landing: the body impact (punch or kick weight) plus the element it carried
  strike(t, from, kind, level, pos) {
    if (!this.recorded) return this.hit(level >= 1 ? 1 : 0.6, pos);
    const melee = kind === 'melee' || kind === 'counter';
    const leg = from && from.tech && /kick|sweep|hurricane|teep|front|heel|body|round|axe|crescent|whirl|flip|stomp/i.test(from.tech.clip || '');
    const el = from && from.el;
    if (melee) this.play(leg || level >= 2 ? 'kick' : 'punch', { vol: level >= 1 ? 1 : 0.8, pos });
    // the element's own sound on the hit (projectiles and arcs: the element is the whole hit)
    const k = /rock|boulder|pebble|pillar|spike|rupture|eruption|slab/i.test(kind) ? 'earth'
      : /ice|frozen/i.test(kind) ? 'ice'
      : /fire|flame|burn|blast|jet|ring/i.test(kind) ? 'fire'
      : /water|whip|wave|tidal|drown|slam/i.test(kind) ? 'water'
      : /gust|wind|air|tornado|vortex|blade/i.test(kind) ? 'air' : (melee ? null : el);
    const v = melee ? 0.55 : 0.9;
    if (k === 'earth') this.play('rockCrash', { vol: v, pos });
    else if (k === 'ice') this.play('iceHit', { vol: v, pos });
    else if (k === 'fire') this.play('fireHit', { vol: v, pos });
    else if (k === 'water') this.play(melee ? 'waterWhip' : 'waterCast', { vol: v, pos });
    else if (k === 'air') this.play('gust', { vol: v, pos });
    else if (!melee) this.play('punch', { vol: 0.8, pos });
    // knocked down: the body hits the floor a moment later
    if (level >= 2) this.bodyfall(1, pos, 0.45);
  }
}
