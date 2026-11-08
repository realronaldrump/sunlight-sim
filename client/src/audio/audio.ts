// Procedural audio (WebAudio). Every sound is synthesized at runtime from noise and oscillators, so there
// are no third-party audio assets. Wind scales with speed; ski-on-snow differs for groomed vs powder and
// carving vs skidding; lift machinery hums near terminals; chairs creak and clunk over towers while riding.

export interface AudioState {
  speed: number;       // m/s
  skid: number;        // 0..1
  edge: number;        // rad
  grounded: boolean;
  groomed: number;     // 0..1 under the skis
  moguls: number;
  plow: number;
  riding: boolean;
  nearTerminal: number; // m to nearest lift terminal
  towerPass: boolean;   // chair just passed a tower (riding)
  fell: boolean;        // fall happened this frame
  inAir: boolean;
}

function noiseBuffer(ctx: AudioContext, seconds = 2, brown = false) {
  const b = ctx.createBuffer(1, ctx.sampleRate * seconds, ctx.sampleRate);
  const d = b.getChannelData(0);
  let last = 0;
  for (let i = 0; i < d.length; i++) {
    const w = Math.random() * 2 - 1;
    if (brown) { last = (last + 0.02 * w) / 1.02; d[i] = last * 3.5; } else d[i] = w;
  }
  return b;
}

export class SkiAudio {
  ctx: AudioContext | null = null;
  private master!: GainNode;
  private wind!: { gain: GainNode; filter: BiquadFilterNode };
  private carve!: { gain: GainNode; filter: BiquadFilterNode };
  private skid!: { gain: GainNode; filter: BiquadFilterNode; lfo: OscillatorNode; lfoGain: GainNode };
  private powder!: { gain: GainNode; filter: BiquadFilterNode };
  private hum!: { gain: GainNode; osc: OscillatorNode[] };
  private ambient!: { gain: GainNode; filter: BiquadFilterNode };
  private creakTimer = 3;
  enabled = true;
  volume = 0.8;

  /** Must be called from a user gesture. */
  start() {
    if (this.ctx) { void this.ctx.resume(); return; }
    const AC = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    if (!AC) return;
    const ctx = new AC();
    this.ctx = ctx;
    this.master = ctx.createGain();
    this.master.gain.value = this.volume;
    const comp = ctx.createDynamicsCompressor();
    this.master.connect(comp).connect(ctx.destination);
    const white = noiseBuffer(ctx, 3), brown = noiseBuffer(ctx, 3, true);
    const loop = (buf: AudioBuffer) => { const s = ctx.createBufferSource(); s.buffer = buf; s.loop = true; s.start(ctx.currentTime + Math.random() * 0.1); return s; };
    const chain = (src: AudioNode, type: BiquadFilterType, f: number, q: number) => {
      const filter = ctx.createBiquadFilter(); filter.type = type; filter.frequency.value = f; filter.Q.value = q;
      const gain = ctx.createGain(); gain.gain.value = 0;
      src.connect(filter).connect(gain).connect(this.master);
      return { filter, gain };
    };
    this.wind = chain(loop(brown), 'lowpass', 400, 0.5);
    this.ambient = chain(loop(brown), 'bandpass', 300, 0.3);
    this.carve = chain(loop(white), 'bandpass', 2600, 1.4);
    const skidSrc = loop(white);
    const sk = chain(skidSrc, 'bandpass', 1400, 0.7);
    const lfo = ctx.createOscillator(); lfo.frequency.value = 9;
    const lfoGain = ctx.createGain(); lfoGain.gain.value = 0;
    lfo.connect(lfoGain).connect(sk.gain.gain); lfo.start();
    this.skid = { ...sk, lfo, lfoGain };
    this.powder = chain(loop(white), 'lowpass', 700, 0.4);
    // lift machinery: motor and gearbox hum
    const humGain = ctx.createGain(); humGain.gain.value = 0; humGain.connect(this.master);
    const oscs = [55, 110.5, 167, 330].map((f, i) => {
      const o = ctx.createOscillator(); o.type = i === 0 ? 'sawtooth' : 'sine'; o.frequency.value = f;
      const g = ctx.createGain(); g.gain.value = [0.25, 0.35, 0.15, 0.05][i];
      const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 600;
      o.connect(lp).connect(g).connect(humGain); o.start();
      return o;
    });
    this.hum = { gain: humGain, osc: oscs };
  }

  private set(g: AudioParam, v: number, t = 0.08) {
    if (!this.ctx) return;
    g.setTargetAtTime(v, this.ctx.currentTime, t);
  }

  /** One-shot synthesized sounds. */
  private burst(freq: number, dur: number, gain: number, type: BiquadFilterType = 'bandpass', q = 4, sweep = 0) {
    const ctx = this.ctx!;
    const src = ctx.createBufferSource();
    src.buffer = noiseBuffer(ctx, dur + 0.05);
    const f = ctx.createBiquadFilter(); f.type = type; f.frequency.value = freq; f.Q.value = q;
    if (sweep) f.frequency.linearRampToValueAtTime(freq + sweep, ctx.currentTime + dur);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0, ctx.currentTime);
    g.gain.linearRampToValueAtTime(gain, ctx.currentTime + 0.01);
    g.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + dur);
    src.connect(f).connect(g).connect(this.master);
    src.start(); src.stop(ctx.currentTime + dur + 0.05);
  }

  update(dt: number, s: AudioState) {
    if (!this.ctx || !this.enabled) { if (this.master) this.master.gain.value = 0; return; }
    this.master.gain.value = this.volume;
    const v = s.riding ? 0 : s.speed;
    // wind: rises with speed, brighter when fast; a little breeze always
    const w = Math.min(1, (v / 22) ** 1.6);
    this.set(this.wind.gain.gain, 0.02 + 0.55 * w);
    this.set(this.wind.filter.frequency, 250 + 1600 * w);
    this.set(this.ambient.gain.gain, s.riding ? 0.06 : 0.035);
    // snow contact
    const contact = s.grounded && !s.inAir && !s.riding ? 1 : 0;
    const sp = Math.min(1, v / 14);
    const hard = Math.max(s.groomed, 0.3);
    const carveAmt = contact * sp * (1 - s.skid) * hard * Math.min(1, 0.3 + Math.abs(s.edge) * 2);
    this.set(this.carve.gain.gain, 0.18 * carveAmt);
    this.set(this.carve.filter.frequency, 1800 + 1800 * sp);
    const skidAmt = contact * Math.min(1, v / 6) * Math.max(s.skid, s.plow * 0.7);
    this.set(this.skid.gain.gain, 0.32 * skidAmt);
    this.set(this.skid.lfoGain.gain, 0.08 * skidAmt);
    this.set(this.skid.filter.frequency, 900 + 900 * hard);
    const soft = contact * sp * (1 - s.groomed) * (1 - s.skid * 0.5);
    this.set(this.powder.gain.gain, 0.22 * soft + 0.05 * s.moguls * contact * sp);
    // lift hum near terminals (and while riding near them)
    const hum = Math.max(0, 1 - s.nearTerminal / 60) ** 2;
    this.set(this.hum.gain.gain, 0.12 * hum, 0.3);
    // chairs: clunk over towers, occasional creak while riding
    if (s.riding && s.towerPass) { this.burst(180, 0.25, 0.5, 'lowpass', 1); setTimeout(() => this.ctx && this.burst(140, 0.2, 0.35, 'lowpass', 1), 110); }
    if (s.riding) {
      this.creakTimer -= dt;
      if (this.creakTimer < 0) { this.creakTimer = 2.5 + Math.random() * 5; this.burst(700 + Math.random() * 500, 0.35, 0.12, 'bandpass', 18, 250); }
    }
    if (s.fell) this.burst(220, 0.5, 0.7, 'lowpass', 0.8);
  }
}
