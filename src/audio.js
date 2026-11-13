// Synthesised audio (no samples): engine, wind, hits, crashes, beeps.
export class GameAudio {
  constructor() { this.ctx = null; this.muted = false; }

  start() {
    if (this.ctx) { this.ctx.resume(); return; }
    const C = window.AudioContext || window.webkitAudioContext;
    if (!C) return;
    const ctx = (this.ctx = new C());
    this.master = ctx.createGain(); this.master.gain.value = this.muted ? 0 : 0.6; this.master.connect(ctx.destination);

    this.noiseBuf = ctx.createBuffer(1, ctx.sampleRate * 2, ctx.sampleRate);
    const d = this.noiseBuf.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;

    this.o1 = ctx.createOscillator(); this.o1.type = 'sawtooth';
    this.o2 = ctx.createOscillator(); this.o2.type = 'square';
    this.filter = ctx.createBiquadFilter(); this.filter.type = 'lowpass'; this.filter.Q.value = 2;
    this.engGain = ctx.createGain(); this.engGain.gain.value = 0;
    const g2 = ctx.createGain(); g2.gain.value = 0.5;
    this.o1.connect(this.filter); this.o2.connect(g2); g2.connect(this.filter);
    this.filter.connect(this.engGain); this.engGain.connect(this.master);
    this.o1.start(); this.o2.start();

    const wind = ctx.createBufferSource(); wind.buffer = this.noiseBuf; wind.loop = true;
    const bp = ctx.createBiquadFilter(); bp.type = 'bandpass'; bp.frequency.value = 700; bp.Q.value = 0.4;
    this.windGain = ctx.createGain(); this.windGain.gain.value = 0;
    wind.connect(bp); bp.connect(this.windGain); this.windGain.connect(this.master); wind.start();
  }

  update(rpm, throttle, speedFrac, alive) {
    if (!this.ctx) return;
    const t = this.ctx.currentTime, f = 52 + rpm * 185;
    this.o1.frequency.setTargetAtTime(f, t, 0.04);
    this.o2.frequency.setTargetAtTime(f / 2, t, 0.04);
    this.filter.frequency.setTargetAtTime(450 + rpm * 1700 + throttle * 700, t, 0.05);
    this.engGain.gain.setTargetAtTime(alive ? 0.11 + 0.09 * throttle : 0.03, t, 0.08);
    this.windGain.gain.setTargetAtTime(speedFrac * speedFrac * 0.3, t, 0.1);
  }

  burst(dur, freq, vol) {
    if (!this.ctx) return;
    const ctx = this.ctx, t = ctx.currentTime;
    const src = ctx.createBufferSource(); src.buffer = this.noiseBuf;
    const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = freq;
    const g = ctx.createGain(); g.gain.setValueAtTime(vol, t); g.gain.exponentialRampToValueAtTime(0.001, t + dur);
    src.connect(lp); lp.connect(g); g.connect(this.master);
    src.start(t, Math.random()); src.stop(t + dur);
  }

  tone(f0, f1, dur, vol, type = 'sine') {
    if (!this.ctx) return;
    const ctx = this.ctx, t = ctx.currentTime, o = ctx.createOscillator(), g = ctx.createGain();
    o.type = type; o.frequency.setValueAtTime(f0, t); o.frequency.exponentialRampToValueAtTime(f1, t + dur);
    g.gain.setValueAtTime(vol, t); g.gain.exponentialRampToValueAtTime(0.001, t + dur);
    o.connect(g); g.connect(this.master); o.start(t); o.stop(t + dur);
  }

  hit() { this.burst(0.13, 1400, 0.7); this.tone(160, 60, 0.12, 0.5); }
  crash() { this.burst(0.8, 2400, 0.9); this.tone(110, 30, 0.5, 0.7); }
  beep(high) { this.tone(high ? 880 : 440, high ? 880 : 440, high ? 0.5 : 0.18, 0.3, 'square'); }

  toggleMute() {
    this.muted = !this.muted;
    if (this.ctx) this.master.gain.value = this.muted ? 0 : 0.6;
    return this.muted;
  }
}
