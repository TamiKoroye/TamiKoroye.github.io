// Small synthesized sound set (no external files): whooshes, impacts, rumbles, hits.
export class Audio {
  constructor() { this.ctx = null; this.master = null; this.noiseBuf = null; this.muted = false; }
  unlock() {
    if (this.ctx) { if (this.ctx.state === 'suspended') this.ctx.resume(); return; }
    const AC = window.AudioContext || window.webkitAudioContext; if (!AC) return;
    this.ctx = new AC();
    this.master = this.ctx.createGain(); this.master.gain.value = 0.55; this.master.connect(this.ctx.destination);
    const len = this.ctx.sampleRate * 1.5, b = this.ctx.createBuffer(1, len, this.ctx.sampleRate), d = b.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
    this.noiseBuf = b;
  }
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
  whoosh(k = 0.5) { this.noise(0.22 + k * 0.1, 'bandpass', 600 + k * 900, 2400, 0.25 * k + 0.05, 1.2); }
  impact(k = 1) { this.noise(0.35, 'lowpass', 1400, 120, 0.6 * k, 0.8); this.tone(0.25, 120, 45, 0.5 * k); }
  rumble(k = 0.6) { this.noise(0.5, 'lowpass', 300, 60, 0.6 * k, 0.7); this.tone(0.4, 70, 40, 0.35 * k, 'triangle'); }
  hit(k = 0.6) { this.noise(0.12, 'highpass', 1800, 800, 0.35 * k); this.tone(0.14, 220, 80, 0.4 * k, 'square'); }
}
