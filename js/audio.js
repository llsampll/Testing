// Procedural audio with the Web Audio API: an engine note that follows RPM
// and load, tire squeal driven by tire slip, and impact thuds.

export class GameAudio {
  constructor() {
    this.ctx = null;
    this.enabled = true;
  }

  /** Must be called from a user gesture (mobile autoplay rules). */
  start() {
    if (this.ctx) {
      this.ctx.resume();
      return;
    }
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    const ctx = new AC();
    this.ctx = ctx;
    this.master = ctx.createGain();
    this.master.gain.value = this.enabled ? 0.55 : 0;
    this.master.connect(ctx.destination);

    // Engine: two detuned saws + a sub square through a resonant low-pass.
    this.engineFilter = ctx.createBiquadFilter();
    this.engineFilter.type = 'lowpass';
    this.engineFilter.Q.value = 4;
    this.engineGain = ctx.createGain();
    this.engineGain.gain.value = 0;
    this.engineFilter.connect(this.engineGain).connect(this.master);
    this.oscs = [
      { type: 'sawtooth', mult: 1, gain: 0.35 },
      { type: 'sawtooth', mult: 1.007, gain: 0.25 },
      { type: 'square', mult: 0.5, gain: 0.3 },
      { type: 'triangle', mult: 2, gain: 0.12 },
    ].map((o) => {
      const osc = ctx.createOscillator();
      osc.type = o.type;
      const g = ctx.createGain();
      g.gain.value = o.gain;
      osc.connect(g).connect(this.engineFilter);
      osc.start();
      return { osc, mult: o.mult };
    });

    // Tire squeal: band-passed noise.
    const noise = ctx.createBuffer(1, ctx.sampleRate * 2, ctx.sampleRate);
    const data = noise.getChannelData(0);
    for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;
    this.noiseBuffer = noise;
    const src = ctx.createBufferSource();
    src.buffer = noise;
    src.loop = true;
    this.squealFilter = ctx.createBiquadFilter();
    this.squealFilter.type = 'bandpass';
    this.squealFilter.frequency.value = 1100;
    this.squealFilter.Q.value = 9;
    this.squealGain = ctx.createGain();
    this.squealGain.gain.value = 0;
    src.connect(this.squealFilter).connect(this.squealGain).connect(this.master);
    src.start();

    // Wind / road rumble.
    const rumble = ctx.createBufferSource();
    rumble.buffer = noise;
    rumble.loop = true;
    this.rumbleFilter = ctx.createBiquadFilter();
    this.rumbleFilter.type = 'lowpass';
    this.rumbleFilter.frequency.value = 400;
    this.rumbleGain = ctx.createGain();
    this.rumbleGain.gain.value = 0;
    rumble.connect(this.rumbleFilter).connect(this.rumbleGain).connect(this.master);
    rumble.start();
  }

  setEnabled(on) {
    this.enabled = on;
    if (this.master) this.master.gain.setTargetAtTime(on ? 0.55 : 0, this.ctx.currentTime, 0.05);
  }

  suspend() {
    this.ctx?.suspend();
  }

  resume() {
    this.ctx?.resume();
  }

  /**
   * @param {import('./physics/vehicle.js').Vehicle} v
   * @param {number} cylinders
   * @param {number} surfaceRumble 0..1 extra rumble (kerbs/grass)
   */
  update(v, cylinders, surfaceRumble) {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    const firing = (v.rpm / 60) * (cylinders / 2);
    for (const o of this.oscs) o.osc.frequency.setTargetAtTime(firing * o.mult, t, 0.015);
    const load = Math.max(v.input.throttle, 0.15);
    this.engineFilter.frequency.setTargetAtTime(300 + load * 2400 + v.rpm * 0.15, t, 0.03);
    const limiterDip = v.limiter ? 0.6 : 1;
    this.engineGain.gain.setTargetAtTime((0.14 + load * 0.22) * limiterDip, t, 0.03);

    let slip = 0;
    for (const w of v.wheels) slip = Math.max(slip, w.grip > 0.9 ? w.slip : 0);
    const squeal = v.speed > 3 ? Math.min(1, Math.max(0, slip - 0.85) * 1.2) : 0;
    this.squealGain.gain.setTargetAtTime(squeal * 0.22, t, 0.05);
    this.squealFilter.frequency.setTargetAtTime(900 + squeal * 500, t, 0.05);

    const sp = Math.min(1, v.speed / 70);
    this.rumbleGain.gain.setTargetAtTime(sp * 0.08 + surfaceRumble * 0.25, t, 0.08);
    this.rumbleFilter.frequency.setTargetAtTime(250 + sp * 500, t, 0.1);
  }

  impact(strength) {
    if (!this.ctx) return;
    const ctx = this.ctx;
    const src = ctx.createBufferSource();
    src.buffer = this.noiseBuffer;
    const f = ctx.createBiquadFilter();
    f.type = 'lowpass';
    f.frequency.value = 500;
    const g = ctx.createGain();
    const vol = Math.min(0.8, strength * 0.06);
    g.gain.setValueAtTime(vol, ctx.currentTime);
    g.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.35);
    src.connect(f).connect(g).connect(this.master);
    src.start();
    src.stop(ctx.currentTime + 0.4);
  }

  beep(high) {
    if (!this.ctx) return;
    const ctx = this.ctx;
    const o = ctx.createOscillator();
    o.type = 'square';
    o.frequency.value = high ? 880 : 440;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.15, ctx.currentTime);
    g.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + (high ? 0.6 : 0.25));
    o.connect(g).connect(this.master);
    o.start();
    o.stop(ctx.currentTime + 0.65);
  }

  stopEngine() {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    this.engineGain.gain.setTargetAtTime(0, t, 0.1);
    this.squealGain.gain.setTargetAtTime(0, t, 0.1);
    this.rumbleGain.gain.setTargetAtTime(0, t, 0.1);
  }
}
