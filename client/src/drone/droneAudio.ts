// Four separately detuned motors. Two-blade passage frequency = RPM * 2 / 60.
// This is original procedural Foley, not a recording of any particular aircraft.
import type { DroneState } from '../../../shared/dronePhysics';

export class DroneAudio {
  private ctx: BaseAudioContext | null = null;
  private master: GainNode | null = null;
  private motors: { tone: OscillatorNode; whine: OscillatorNode; gain: GainNode }[] = [];
  private noise: AudioBufferSourceNode | null = null;
  private air: GainNode | null = null;
  private nodes: AudioNode[] = [];
  private target = 0;
  private visibility = () => {
    if (this.ctx && this.master) this.master.gain.setTargetAtTime(document.hidden ? 0 : this.target,this.ctx.currentTime,.015);
  };
  constructor() { document.addEventListener('visibilitychange',this.visibility); }
  start(ctx: BaseAudioContext) {
    if (this.ctx) return;
    this.ctx = ctx;
    const master = this.master = ctx.createGain(); master.gain.value = 0;
    const filter = ctx.createBiquadFilter(); filter.type = 'lowpass'; filter.frequency.value = 4800;
    master.connect(filter).connect(ctx.destination); this.nodes.push(master,filter);
    const re = new Float32Array(9), im = new Float32Array([0,1,.48,.28,.15,.1,.065,.04,.02]);
    const wave = ctx.createPeriodicWave(re,im);
    for (let i = 0; i < 4; i++) {
      const tone = ctx.createOscillator(), whine = ctx.createOscillator(); tone.setPeriodicWave(wave); whine.type = 'sine';
      const gain = ctx.createGain(), high = ctx.createGain(), pan = ctx.createStereoPanner();
      gain.gain.value = .035; high.gain.value = .003; pan.pan.value = i%2 ? .3 : -.3;
      tone.connect(gain); whine.connect(high).connect(gain); gain.connect(pan).connect(master);
      tone.start(); whine.start(); this.motors.push({tone,whine,gain}); this.nodes.push(tone,whine,gain,high,pan);
    }
    const buffer = ctx.createBuffer(2,ctx.sampleRate*4,ctx.sampleRate);
    let seed = 379;
    for (let ch = 0; ch < 2; ch++) {
      const data = buffer.getChannelData(ch);
      for (let i = 0; i < data.length; i++) { seed = (Math.imul(seed,1664525)+1013904223)|0; data[i] = (seed>>>0)/2147483648-1; }
    }
    const noise = this.noise = ctx.createBufferSource(); noise.buffer = buffer; noise.loop = true;
    const band = ctx.createBiquadFilter(); band.type = 'bandpass'; band.frequency.value = 1800; band.Q.value = .6;
    const air = this.air = ctx.createGain(); air.gain.value = 0;
    noise.connect(band).connect(air).connect(master); noise.start(); this.nodes.push(noise,band,air);
  }
  update(ctx: BaseAudioContext | null, state: DroneState | null, volume: number, enabled: boolean, fpv: boolean, at?: number) {
    if (!this.ctx && ctx && state) this.start(ctx);
    if (!this.ctx || !this.master) return;
    const time = at ?? this.ctx.currentTime;
    this.target = state && enabled ? Math.max(0,Math.min(1,volume))*(fpv ? .9 : .62) : 0;
    this.master.gain.setTargetAtTime(document.hidden ? 0 : this.target,time,.045);
    if (!state) return;
    this.motors.forEach((m,i) => {
      const rpm = state.rpm[i];
      m.tone.frequency.setTargetAtTime(rpm/30,time,.055);
      m.whine.frequency.setTargetAtTime(rpm/60*14,time,.065);
      m.gain.gain.setTargetAtTime(.029+(rpm-4400)/100000,time,.07);
    });
    this.air!.gain.setTargetAtTime(.026+state.speed*.0022+Math.abs(state.vel.y)*.002,time,.07);
  }
  dispose() {
    for (const m of this.motors) { m.tone.stop(); m.whine.stop(); }
    this.noise?.stop(); this.nodes.forEach(n => n.disconnect()); this.nodes = []; this.motors = [];
    document.removeEventListener('visibilitychange',this.visibility); this.ctx = null; this.master = null;
  }
}
