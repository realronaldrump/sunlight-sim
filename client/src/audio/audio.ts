// Field-recorded snow, winter air and machinery, with contact-driven Foley.
// Provenance: public/audio/sources.json. Rebuild: pipeline/build_audio.py.
import { clamp, snowWindMix, terminalMix, type AudioState } from './audioModel';
export type { AudioState } from './audioModel';

const FILES = ['ski-glide', 'ski-edge', 'snow-soft', 'lift-motor', 'lift-cable', 'winter-air',
  'snow-compress-1', 'snow-compress-2', 'snow-compress-3', 'snow-compress-4',
  'chair-contact-1', 'chair-contact-2', 'chair-contact-3', 'chair-creak'] as const;
type Sample = typeof FILES[number];
interface Layer { gain: GainNode; filter: BiquadFilterNode; pan: StereoPannerNode; sources: AudioBufferSourceNode[]; feeds: GainNode[] }
interface Voice { source: AudioBufferSourceNode; gain: GainNode; nodes: AudioNode[]; group: 'snow' | 'chair'; end: number }

/** Long, independently seeded noise for airflow and the missing-sample fallback. */
function noise(ctx: BaseAudioContext, seconds: number, seed: number, brown = false, channels = 1) {
  const buf = ctx.createBuffer(channels, Math.round(ctx.sampleRate*seconds), ctx.sampleRate);
  for (let c = 0; c < channels; c++) {
    const d = buf.getChannelData(c);
    let last = 0;
    for (let i = 0; i < d.length; i++) {
      seed = (Math.imul(seed, 1664525)+1013904223) | 0;
      const w = (seed >>> 0)/2147483648-1;
      last = brown ? .985*last+.015*w : w;
      d[i] = last*(brown ? 3.2 : .3);
    }
    // Correct only the seam, preserving the independently generated stereo field.
    const n = Math.round(ctx.sampleRate*.08), delta = d[0]-d[d.length-1];
    for (let i = 0; i < n; i++) d[d.length-n+i] += delta*(i/(n-1))**2;
  }
  return buf;
}

export class SkiAudio {
  ctx: BaseAudioContext | null = null;
  enabled = true;
  volume = .8;
  assetsReady: Promise<void> = Promise.resolve();
  readonly loadedSamples = new Set<string>();
  readonly failedSamples = new Set<string>();
  private master!: GainNode;
  private output!: DynamicsCompressorNode;
  private wind!: Layer;
  private breeze!: Layer;
  private glide!: Layer;
  private edge!: Layer;
  private skid!: Layer;
  private powder!: Layer;
  private slide!: Layer;
  private terminals = new Map<string, { motor: Layer; cable: Layer }>();
  private layers: Layer[] = [];
  private buffers = new Map<Sample, AudioBuffer>();
  private voices = new Set<Voice>();
  private targets = new WeakMap<AudioParam, number>();
  private fallback!: AudioBuffer;
  private pending: { layer: Layer; sample: Sample; offset: number }[] = [];
  private time = 0;
  private grainIn = .1;
  private creakIn = 7;
  private serial = 0;
  private previousRiding = false;
  private hidden = false;
  private ownedContext = false;
  private abort = new AbortController();
  private visibility = () => {
    this.hidden = document.hidden;
    if (this.ctx) {
      this.set(this.master.gain, this.audible ? clamp(this.volume) : 0, this.ctx.currentTime, .015);
      if (this.hidden) this.cancelVoices(this.ctx.currentTime);
    }
  };
  private get audible() { return this.enabled && !this.hidden && this.volume > 0; }
  get activeVoices() { return this.voices.size; }

  /** Real contexts need a user gesture. An offline context supports render verification. */
  start(context?: BaseAudioContext) {
    if (this.ctx) {
      if (this.ctx instanceof AudioContext && this.ctx.state === 'suspended') void this.ctx.resume().catch(() => {});
      return;
    }
    if (!context && !window.AudioContext) return;
    const ctx = this.ctx = context ?? new AudioContext({ latencyHint: 'interactive' });
    this.ownedContext = !context;
    this.master = ctx.createGain(); this.master.gain.value = 0;
    // Headroom for simultaneous snow, machinery and impacts. Open snow has little reverberation.
    const highpass = ctx.createBiquadFilter(); highpass.type = 'highpass'; highpass.frequency.value = 35; highpass.Q.value = .5;
    this.output = ctx.createDynamicsCompressor();
    this.output.threshold.value = -9; this.output.knee.value = 6; this.output.ratio.value = 8;
    this.output.attack.value = .003; this.output.release.value = .18;
    this.master.connect(highpass).connect(this.output).connect(ctx.destination);
    this.fallback = noise(ctx, 13.7, 745);
    this.wind = this.layer(noise(ctx, 17.3, 931, true, 2), 1200, 0);
    this.breeze = this.sampleLayer('winter-air', 3700, 0);
    this.glide = this.sampleLayer('ski-glide', 6500, -.14);
    this.edge = this.sampleLayer('ski-edge', 9000, .13);
    this.skid = this.sampleLayer('ski-edge', 7000, -.08, 4.71);
    this.powder = this.sampleLayer('snow-soft', 2800, .1);
    this.slide = this.sampleLayer('snow-soft', 1600, -.08, 2.8);
    if (this.ownedContext) {
      document.addEventListener('visibilitychange', this.visibility);
      this.visibility();
      if (ctx instanceof AudioContext) void ctx.resume().catch(() => {});
    }
    this.assetsReady = this.loadSamples();
  }

  private set(param: AudioParam, value: number, at: number, tau = .075) {
    if (Math.abs((this.targets.get(param) ?? Infinity)-value) < .0001) return;
    param.setTargetAtTime(value, at, tau);
    this.targets.set(param, value);
  }

  private layer(buffer: AudioBuffer, frequency: number, pan: number, offset = 0): Layer {
    const ctx = this.ctx!;
    const filter = ctx.createBiquadFilter(); filter.type = 'lowpass'; filter.frequency.value = frequency; filter.Q.value = .55;
    const gain = ctx.createGain(); gain.gain.value = 0;
    const panner = ctx.createStereoPanner(); panner.pan.value = pan;
    filter.connect(gain).connect(panner).connect(this.master);
    const layer: Layer = { gain, filter, pan: panner, sources: [], feeds: [] };
    this.addSource(layer, buffer, offset, false);
    this.layers.push(layer);
    return layer;
  }

  private addSource(layer: Layer, buffer: AudioBuffer, offset: number, crossfade: boolean) {
    const ctx = this.ctx!, at = ctx.currentTime;
    const source = ctx.createBufferSource(); source.buffer = buffer; source.loop = true;
    const feed = ctx.createGain(); feed.gain.value = crossfade ? 0 : 1;
    source.connect(feed).connect(layer.filter);
    source.start(at, ((offset % buffer.duration)+buffer.duration)%buffer.duration);
    if (crossfade) {
      this.set(feed.gain, 1, at, .18);
      for (let i = 0; i < layer.sources.length; i++) {
        const old = layer.sources[i], oldFeed = layer.feeds[i];
        this.set(oldFeed.gain, 0, at, .1);
        old.stop(at+.8);
        old.onended = () => { old.disconnect(); oldFeed.disconnect(); };
      }
      layer.sources = []; layer.feeds = [];
    }
    layer.sources.push(source); layer.feeds.push(feed);
  }

  private sampleLayer(sample: Sample, frequency: number, pan: number, offset = 0) {
    const buffer = this.buffers.get(sample);
    const layer = this.layer(buffer ?? this.fallback, frequency, pan, offset);
    if (!buffer) this.pending.push({ layer, sample, offset });
    return layer;
  }

  private async loadSamples() {
    await Promise.all(FILES.map(async sample => {
      try {
        const response = await fetch(`${import.meta.env.BASE_URL}audio/${sample}.wav`, { signal: this.abort.signal });
        if (!response.ok) throw new Error(`Audio HTTP ${response.status}`);
        const buffer = await this.ctx!.decodeAudioData(await response.arrayBuffer());
        if (this.abort.signal.aborted) return;
        this.buffers.set(sample, buffer); this.loadedSamples.add(sample);
        for (const p of this.pending.filter(p => p.sample === sample)) this.addSource(p.layer, buffer, p.offset, true);
        this.pending = this.pending.filter(p => p.sample !== sample);
      } catch {
        if (!this.abort.signal.aborted) this.failedSamples.add(sample);
        // A missing sample cannot stop gameplay or disable the procedural fallback.
      }
    }));
  }

  private control(layer: Layer, gain: number, at: number, cutoff?: number, rate?: number, pan?: number) {
    this.set(layer.gain.gain, gain, at, gain === 0 ? .022 : .07);
    if (cutoff !== undefined) this.set(layer.filter.frequency, cutoff, at, .12);
    if (rate !== undefined) for (const source of layer.sources) this.set(source.playbackRate, rate, at, .16);
    if (pan !== undefined) this.set(layer.pan.pan, clamp(pan, -1, 1), at, .1);
  }

  private oneShot(sample: Sample, gain: number, rate: number, pan: number, at: number, group: Voice['group'], length?: number) {
    if (!this.audible || [...this.voices].filter(v => v.end > at).length >= 24) return;
    const ctx = this.ctx!, buffer = this.buffers.get(sample) ?? this.fallback;
    const source = ctx.createBufferSource(); source.buffer = buffer; source.playbackRate.value = rate;
    const amp = ctx.createGain(), filter = ctx.createBiquadFilter(), panner = ctx.createStereoPanner();
    filter.type = 'lowpass'; filter.frequency.value = group === 'chair' ? 4300 : 6500; filter.Q.value = .55;
    panner.pan.value = clamp(pan, -1, 1);
    const duration = Math.min(length ?? .85, buffer.duration/rate);
    amp.gain.setValueAtTime(0, at);
    amp.gain.linearRampToValueAtTime(gain, at+.008);
    amp.gain.setTargetAtTime(0, at+duration*.48, Math.max(.012, duration*.15));
    amp.gain.linearRampToValueAtTime(0, at+duration);
    source.connect(filter).connect(amp).connect(panner).connect(this.master);
    const voice: Voice = { source, gain: amp, nodes: [source, filter, amp, panner], group, end: at+duration+.01 };
    this.voices.add(voice);
    source.onended = () => { for (const node of voice.nodes) node.disconnect(); this.voices.delete(voice); };
    source.start(at); source.stop(at+duration+.01);
  }

  private cancelVoices(at: number, group?: Voice['group']) {
    for (const voice of this.voices) if (voice.end > at && (!group || voice.group === group)) {
      voice.gain.gain.cancelScheduledValues(at);
      voice.gain.gain.setTargetAtTime(0, at, .008);
      voice.source.stop(at+.04);
      this.voices.delete(voice);
    }
  }

  /** Optional time supports offline renders; live playback uses AudioContext.currentTime. */
  update(dt: number, s: AudioState, at = this.ctx?.currentTime ?? 0) {
    if (!this.ctx) return;
    this.time += clamp(dt, 0, .1);
    this.set(this.master.gain, this.audible ? clamp(this.volume) : 0, at, .015);
    if (s.discontinuity || !this.audible) { this.cancelVoices(at); this.grainIn = .2; this.creakIn = 6; }
    if (!s.riding && this.previousRiding) this.cancelVoices(at, 'chair');
    this.previousRiding = s.riding;
    const m = snowWindMix(s, this.time);
    this.control(this.wind, m.wind, at, m.windCutoff);
    this.control(this.breeze, m.breeze, at);
    this.control(this.glide, m.glide, at, m.snowCutoff, m.rate, -.14+m.pan);
    this.control(this.edge, m.edge, at, m.snowCutoff, m.rate*1.007, .13+m.pan);
    this.control(this.skid, m.scrape, at, m.snowCutoff*.87, m.rate*.97, -.08+m.pan*.5);
    this.control(this.powder, m.powder, at, 1600+1000*clamp(s.speed/16), m.rate*.91);
    this.control(this.slide, m.slide, at, 1500, .76);

    const present = new Set<string>();
    const terminals = s.terminals ?? [{ id: 'nearest', distance: s.nearTerminal, pan: 0, speed: 2.3, variant: 0 }];
    for (const terminal of terminals) {
      const mix = terminalMix(terminal.distance);
      if (!mix.gain && !this.terminals.has(terminal.id)) continue;
      let sound = this.terminals.get(terminal.id);
      if (!sound) {
        sound = { motor: this.sampleLayer('lift-motor', 6000, terminal.pan, terminal.variant*3.17),
          cable: this.sampleLayer('lift-cable', 5000, terminal.pan, terminal.variant*1.91) };
        this.terminals.set(terminal.id, sound);
      }
      present.add(terminal.id);
      const rate = clamp(.87+terminal.speed*.055+terminal.variant*.012, .85, 1.12);
      this.control(sound.motor, .46*mix.gain, at, mix.cutoff, rate, terminal.pan);
      this.control(sound.cable, .14*mix.gain, at, mix.cutoff*.8, rate*.98, terminal.pan);
    }
    for (const [id, sound] of this.terminals) if (!present.has(id)) {
      this.control(sound.motor, 0, at); this.control(sound.cable, 0, at);
    }
    if (!this.audible || s.discontinuity) return;

    // Irregular compression follows loaded snow contact, never a fixed tremolo.
    this.grainIn -= Math.max(0, dt);
    if (m.grain > .04 && this.grainIn <= 0) {
      const n = ++this.serial;
      this.grainIn = (.12+.11*(.5+.5*Math.sin(n*2.39))) / (.5+m.grain);
      this.oneShot(`snow-compress-${n%4+1}` as Sample, .09*m.grain, 1.12+(n%5)*.07, Math.sin(n*2.4)*.22, at, 'snow', .16);
    }
    if (s.fell || (s.landing ?? 0) > .65) {
      const energy = clamp((s.fell ? s.impact ?? s.speed : s.landing ?? 0)/9);
      this.oneShot(`snow-compress-${++this.serial%4+1}` as Sample, .2+.5*energy, .7, -.1, at, 'snow');
      this.oneShot('snow-compress-2', .09+.12*energy, .95, .15, at+.065, 'snow');
    }
    if (s.boarded || s.unloaded) {
      this.oneShot('chair-contact-1', .11, .8, .15, at, 'chair');
      if (s.unloaded) this.oneShot('snow-compress-3', .12, 1.1, -.1, at+.09, 'snow');
    }
    if (s.riding && s.towerPass) {
      const gap = .46 / clamp(s.liftSpeed ?? 2.3, 1, 4);
      for (let i = 0; i < 6; i++) this.oneShot(`chair-contact-${i%3+1}` as Sample,
        .11+.055*Math.sin((i+1)*Math.PI/7), .9+(i%3)*.06, (i/5-.5)*.28, at+i*gap, 'chair');
      this.oneShot('chair-creak', .07, .9, .18, at+gap*4.5, 'chair');
    }
    if (s.riding) {
      this.creakIn -= Math.max(0, dt);
      if (this.creakIn <= 0) {
        const n = ++this.serial;
        this.creakIn = 8+(n*2.31%9);
        this.oneShot('chair-creak', .055, .86+(n%4)*.07, Math.sin(n)*.23, at, 'chair');
      }
    } else this.creakIn = 6;
  }

  dispose() {
    this.abort.abort();
    document.removeEventListener('visibilitychange', this.visibility);
    if (!this.ctx) return;
    this.cancelVoices(this.ctx.currentTime);
    for (const layer of this.layers) {
      for (const source of layer.sources) { source.stop(); source.disconnect(); }
      for (const feed of layer.feeds) feed.disconnect();
      layer.gain.disconnect(); layer.filter.disconnect(); layer.pan.disconnect();
    }
    this.master.disconnect(); this.output.disconnect();
    if (this.ownedContext && this.ctx instanceof AudioContext) void this.ctx.close().catch(() => {});
  }
}
