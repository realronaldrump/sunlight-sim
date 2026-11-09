// Field-recorded snow, winter air and machinery, with contact-driven Foley.
// Provenance: public/audio/sources.json. Rebuild: pipeline/build_audio.py.
import { clamp, snowWindMix, terminalMix, nearbySkierMix, chairStrainMix, environmentMix, type AudioState } from './audioModel';
import { COMIC, type ComicSound } from './comicSynth';
import { babble, bootOnWood, branchKnock, clink, grinder, registerBeep, roomTone, steam } from './ambienceSynth';
export type { AudioState } from './audioModel';

const FILES = ['ski-glide', 'ski-edge', 'snow-soft', 'lift-motor', 'lift-cable', 'winter-air',
  'snow-compress-1', 'snow-compress-2', 'snow-compress-3', 'snow-compress-4',
  'chair-contact-1', 'chair-contact-2', 'chair-contact-3', 'chair-creak'] as const;
type Sample = typeof FILES[number];
interface Layer { gain: GainNode; filter: BiquadFilterNode; pan: StereoPannerNode; sources: AudioBufferSourceNode[]; feeds: GainNode[] }
interface Voice { source: AudioBufferSourceNode; gain: GainNode; nodes: AudioNode[]; group: 'snow' | 'chair' | 'place'; end: number }

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
  readonly sampleErrors = new Map<string, string>();
  private master!: GainNode;
  private output!: DynamicsCompressorNode;
  private wind!: Layer;
  private breeze!: Layer;
  private glide!: Layer;
  private edge!: Layer;
  private skid!: Layer;
  private powder!: Layer;
  private slide!: Layer;
  private chairStrain!: Layer;
  /** Places: lodge room tone and conversation, wind whistling over a ridge. Built on first need. */
  private place: { room: Layer; babble: Layer; whistle: Layer; buffers: Record<string, AudioBuffer[]> } | null = null;
  private placeTimers = { clink: 2, coffee: 12, beep: 8, knock: 4 };
  private terminals = new Map<string, { motor: Layer; cable: Layer }>();
  private skiers: { hard: Layer; soft: Layer }[] = [];
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
    this.chairStrain = this.sampleLayer('chair-creak', 2400, 0);
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
    const load = async (sample: Sample) => {
      try {
        const response = await fetch(`${import.meta.env.BASE_URL}audio/${sample}.wav`, { signal: this.abort.signal });
        if (!response.ok) throw new Error(`Audio HTTP ${response.status}`);
        const buffer = await this.ctx!.decodeAudioData(await response.arrayBuffer());
        if (this.abort.signal.aborted) return;
        this.buffers.set(sample, buffer); this.loadedSamples.add(sample);
        for (const p of this.pending.filter(p => p.sample === sample)) this.addSource(p.layer, buffer, p.offset, true);
        this.pending = this.pending.filter(p => p.sample !== sample);
      } catch (error) {
        if (!this.abort.signal.aborted) {
          this.failedSamples.add(sample);
          this.sampleErrors.set(sample, error instanceof Error ? error.message : String(error));
        }
        // A missing sample cannot stop gameplay or disable the procedural fallback.
      }
    };
    // Keep loading modest while the browser is also streaming terrain and textures.
    let next = 0;
    await Promise.all(Array.from({ length: 4 }, async () => {
      while (next < FILES.length && !this.abort.signal.aborted) await load(FILES[next++]);
    }));
  }

  private control(layer: Layer, gain: number, at: number, cutoff?: number, rate?: number, pan?: number) {
    this.set(layer.gain.gain, gain, at, gain === 0 ? .022 : .07);
    if (cutoff !== undefined) this.set(layer.filter.frequency, cutoff, at, .12);
    if (rate !== undefined) for (const source of layer.sources) this.set(source.playbackRate, rate, at, .16);
    if (pan !== undefined) this.set(layer.pan.pan, clamp(pan, -1, 1), at, .1);
  }

  private comic = new Map<ComicSound, AudioBuffer>();
  /** A one-shot from the missed-unload gag (synthesized on first use). */
  effect(kind: ComicSound, gain = 0.5, pan = 0) {
    if (!this.ctx) return;
    let buf = this.comic.get(kind);
    if (!buf) { buf = COMIC[kind](this.ctx); this.comic.set(kind, buf); }
    this.oneShot(buf, gain, 1, pan, this.ctx.currentTime + 0.01, 'place', buf.duration);
  }

  private oneShot(sample: Sample | AudioBuffer, gain: number, rate: number, pan: number, at: number, group: Voice['group'], length?: number) {
    if (!this.audible || [...this.voices].filter(v => v.end > at).length >= 24) return;
    const ctx = this.ctx!, buffer = typeof sample === 'string' ? this.buffers.get(sample) ?? this.fallback : sample;
    const source = ctx.createBufferSource(); source.buffer = buffer; source.playbackRate.value = rate;
    const amp = ctx.createGain(), filter = ctx.createBiquadFilter(), panner = ctx.createStereoPanner();
    filter.type = 'lowpass'; filter.frequency.value = group === 'chair' ? 4300 : group === 'place' ? 9000 : 6500; filter.Q.value = .55;
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
    const env = s.env ?? { indoor: 0, shelter: 0, exposure: 0, chatter: 0 };
    const e = environmentMix(env, this.time);
    const strain = chairStrainMix(s);
    this.control(this.chairStrain, strain.gain, at, strain.cutoff, strain.rate, strain.pan);
    this.control(this.wind, m.wind * e.wind, at, Math.max(120, m.windCutoff * e.cutoff));
    this.control(this.breeze, m.breeze * e.breeze, at, Math.max(300, 3700 * e.cutoff));
    this.updatePlace(e, env, s, at, dt);
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
      this.control(sound.motor, .46*mix.gain*e.distant, at, mix.cutoff*e.cutoff, rate, terminal.pan);
      this.control(sound.cable, .14*mix.gain*e.distant, at, mix.cutoff*.8*e.cutoff, rate*.98, terminal.pan);
    }
    for (const [id, sound] of this.terminals) if (!present.has(id)) {
      this.control(sound.motor, 0, at); this.control(sound.cable, 0, at);
    }
    // A bounded pool follows actual nearby skiers, including multiplayer interpolation.
    // No fixed pass-by clip or voices unrelated to people present in the scene.
    const nearby = (s.skiers ?? []).filter(p => p.active && p.distance < 50 && p.speed > .15)
      .sort((a,b) => a.distance-b.distance).slice(0,4);
    for (let i = 0; i < Math.max(nearby.length, this.skiers.length); i++) {
      let sound = this.skiers[i];
      const skier = nearby[i];
      if (!sound) {
        sound = { hard: this.sampleLayer('ski-glide', 6000, 0, i*2.61+1.3),
          soft: this.sampleLayer('snow-soft', 2500, 0, i*1.73+.7) };
        this.skiers.push(sound);
      }
      if (!skier) { this.control(sound.hard, 0, at); this.control(sound.soft, 0, at); continue; }
      const mix = nearbySkierMix(skier), hard = clamp(skier.groomed), rate = .85+.25*clamp(skier.speed/20);
      mix.gain *= 1 - .9 * clamp(env.indoor);
      this.control(sound.hard, mix.gain*(.25+.75*hard), at, mix.cutoff, rate, skier.pan);
      this.control(sound.soft, mix.gain*(1-hard), at, Math.min(2300,mix.cutoff), rate, skier.pan);
    }
    if (!this.audible || s.discontinuity) return;

    // Irregular compression follows loaded snow contact, never a fixed tremolo.
    this.grainIn -= Math.max(0, dt);
    if (m.grain > .04 && this.grainIn <= 0) {
      const n = ++this.serial;
      this.grainIn = (.12+.11*(.5+.5*Math.sin(n*2.39))) / (.5+m.grain);
      this.oneShot(`snow-compress-${n%4+1}` as Sample, .09*m.grain, 1.12+(n%5)*.07, Math.sin(n*2.4)*.22, at, 'snow', .16);
    }
    if ((s.fell && s.grounded) || (s.landing ?? 0) > .65) {
      const energy = clamp((s.fell ? s.impact ?? s.speed : s.landing ?? 0)/9);
      this.oneShot(`snow-compress-${++this.serial%4+1}` as Sample, .2+.5*energy, .7, -.1, at, 'snow');
      this.oneShot('snow-compress-2', .09+.12*energy, .95, .15, at+.065, 'snow');
    }
    if (s.boarded || s.unloaded) {
      this.oneShot('chair-contact-1', .11, .8, .15, at, 'chair');
      if (s.unloaded) this.oneShot('snow-compress-3', .12, 1.1, -.1, at+.09, 'snow');
    }
    if (s.liftDrop) {
      this.oneShot('chair-contact-3', .2, .73, -.2, at, 'chair');
      this.oneShot('chair-creak', .12, 1.05, .2, at+.06, 'chair');
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

  /** Lodge room tone and conversation, cups and the espresso machine, boots on wood, branches knocking,
   * and the ridge whistle. Synthesized buffers are built the first time a place needs them. */
  private updatePlace(e: ReturnType<typeof environmentMix>, env: NonNullable<AudioState['env']>, s: AudioState, at: number, dt: number) {
    const ctx = this.ctx!;
    const needed = env.indoor > .01 || env.chatter > .01 || e.whistle > .002 || e.knockEvery < Infinity || !!s.step;
    if (!this.place && !needed) return;
    if (!this.place) {
      const room = this.layer(roomTone(ctx), 700, 0), talk = this.layer(babble(ctx), 3400, 0);
      const whistle = this.layer(noise(ctx, 11.3, 517), 1100, 0);
      whistle.filter.type = 'bandpass'; whistle.filter.Q.value = 9;
      this.place = { room, babble: talk, whistle, buffers: {
        clink: [clink(ctx, 3), clink(ctx, 8), clink(ctx, 19)], steam: [steam(ctx)], grinder: [grinder(ctx)], beep: [registerBeep(ctx)],
        boot: [bootOnWood(ctx, 21), bootOnWood(ctx, 22), bootOnWood(ctx, 25)], knock: [branchKnock(ctx, 31), branchKnock(ctx, 37), branchKnock(ctx, 43)] } };
    }
    const P = this.place, B = P.buffers, T = this.placeTimers, indoor = clamp(env.indoor);
    this.control(P.room, e.room, at, 700);
    this.control(P.babble, e.babble, at, 2600 + 1400 * indoor);
    this.control(P.whistle, e.whistle, at, e.whistleFreq);
    if (!this.audible || s.discontinuity) return;
    const pick = (list: AudioBuffer[]) => list[++this.serial % list.length];
    if (s.step === 'wood') this.oneShot(pick(B.boot), .14 + .06 * indoor, .92 + (this.serial % 3) * .06, (this.serial % 2 ? .08 : -.08), at, 'place', .3);
    if (s.step === 'snow') this.oneShot(`snow-compress-${this.serial % 4 + 1}` as Sample, .05, 1.35, (this.serial % 2 ? .1 : -.1), at, 'snow', .25);
    if (indoor > .5) {
      // the lodge at work: cups set down, an order rung up, the grinder and the steam wand
      if ((T.clink -= dt) <= 0) { T.clink = 1.4 + (this.serial * 1.7 % 3.3); this.oneShot(pick(B.clink), .035 + .02 * (this.serial % 3) / 2, .9 + (this.serial % 5) * .05, Math.sin(this.serial) * .6, at, 'place', .45); }
      if ((T.beep -= dt) <= 0) { T.beep = 14 + (this.serial * 3.1 % 17); this.oneShot(B.beep[0], .025, 1, .35, at, 'place', .32); }
      if ((T.coffee -= dt) <= 0) {
        T.coffee = 26 + (this.serial * 5.3 % 20);
        this.oneShot(B.grinder[0], .05, 1, -.3, at, 'place', 2.2);
        this.oneShot(B.steam[0], .045, 1, -.25, at + 3.2, 'place', 3.6);
      }
    }
    if (e.knockEvery < Infinity && (T.knock -= dt) <= 0) {
      T.knock = e.knockEvery * (.4 + (this.serial * .37 % 1.2));
      this.oneShot(pick(B.knock), e.knock, .85 + (this.serial % 4) * .08, Math.sin(this.serial * 1.9) * .8, at, 'place', .25);
    }
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
