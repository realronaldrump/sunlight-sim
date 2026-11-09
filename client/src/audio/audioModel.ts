// Pure sound controls, separate from the Web Audio graph so physical transitions can be tested.
export interface AudioPoint { x: number; y: number; z: number }
export interface AudioTerminal { id: string; distance: number; pan: number; speed: number; variant: number }
export interface NearbySkier { distance: number; pan: number; speed: number; skid: number; groomed: number; active: boolean }
export interface AudioState {
  speed: number; skid: number; edge: number; grounded: boolean; groomed: number;
  moguls: number; plow: number; riding: boolean; nearTerminal: number;
  towerPass: boolean; fell: boolean; inAir: boolean;
  tuck?: number; fallen?: boolean; snowing?: boolean; altitude?: number;
  impact?: number; landing?: number; boarded?: boolean; unloaded?: boolean;
  discontinuity?: boolean; liftSpeed?: number; terminals?: AudioTerminal[];
  skiers?: NearbySkier[];
  rocking?: { angle: number; velocity: number; slip: number; pan: number };
  liftDrop?: boolean;
  /** Where the listener is: inside the lodge, sheltered among trees, out on an exposed ridge. */
  env?: AudioEnvironment;
  /** A ski boot just came down on wood (lodge floor, deck) or snow, while walking. */
  step?: 'wood' | 'snow';
}

export interface AudioEnvironment {
  /** 0..1 inside a building (smoothed through the doorway). */
  indoor: number;
  /** 0..1 tree cover around you: aspen groves and spruce stands soften and hush the wind. */
  shelter: number;
  /** 0..1 open, high ground standing above its surroundings: ridges and summits. */
  exposure: number;
  /** 0..1 how many people are talking nearby (diners, groups, lift lines). */
  chatter: number;
}

/** How a place colours the sound: walls and glass, trees, and open ridges. */
export function environmentMix(e: AudioEnvironment, time: number) {
  const indoor = clamp(e.indoor), shelter = clamp(e.shelter), exposure = clamp(e.exposure);
  const outside = 1 - .93 * indoor;
  // ridge gusts: slow surges with sharper peaks, absent among the trees and indoors
  const surge = .5 + .5 * Math.sin(time * .31 + 1.3) * Math.sin(time * .083 + .4);
  const gust = 1 + exposure * (1 - shelter) * (.7 * surge ** 2);
  return {
    wind: outside * (1 - .55 * shelter) * (1 + 1.1 * exposure) * gust,
    breeze: outside * (1 - .6 * shelter) * (1 + 1.7 * exposure) * gust,
    /** Multiplies outdoor cutoffs: muffled by walls, softened by trees, brightened on the ridge. */
    cutoff: (1 - .82 * indoor) * (1 - .35 * shelter) * (1 + .5 * exposure),
    whistle: outside * exposure ** 1.5 * (1 - shelter) * .05 * (.4 + .6 * surge),
    whistleFreq: 950 + 520 * surge,
    room: .05 * indoor,
    babble: (.014 * (1 - indoor) + .085 * indoor) * clamp(e.chatter),
    /** Seconds between branch knocks in a grove, or Infinity in the open. */
    knockEvery: shelter > .35 && outside > .5 ? 2.5 + 9 * (1 - shelter) : Infinity,
    knock: .05 * shelter * outside,
    /** Distant machinery is absorbed by forest and walls. */
    distant: (1 - .85 * indoor) * (1 - .4 * shelter),
  };
}

export const clamp = (x: number, lo = 0, hi = 1) => Math.max(lo, Math.min(hi, Number.isFinite(x) ? x : lo));
const smooth = (x: number) => { const t = clamp(x); return t*t*(3-2*t); };

export function chairStrainMix(s: AudioState) {
  const r = s.rocking, load = r && s.riding ? clamp(r.angle / .7) : 0;
  const movement = r ? clamp(Math.abs(r.velocity) / 1.2) : 0;
  return { gain: load * (.025 + movement * .2), rate: .65 + .45 * movement,
    pan: clamp(r?.pan ?? 0, -.7, .7), cutoff: 1400 + 2200 * load };
}

/** Inverse-distance spreading with a smooth far cutoff and absorbed high frequencies. */
export function terminalMix(distance: number) {
  const d = Number.isFinite(distance) ? Math.max(0, distance) : 1000;
  return {
    gain: 1 / (1 + (d / 9) ** 1.4) * (1-smooth((d-75)/65)),
    cutoff: 650 + 7000 * Math.exp(-d/38),
  };
}

/** Source bearing in listener coordinates. +x is right when the view faces -z. */
export function sourcePan(listener: AudioPoint, forward: AudioPoint, source: AudioPoint) {
  const dx = source.x-listener.x, dz = source.z-listener.z;
  const n = Math.hypot(dx, dz) * Math.hypot(forward.x, forward.z);
  return n > 1e-6 ? clamp((-forward.z*dx + forward.x*dz)/n, -1, 1) * .92 : 0;
}

export function nearbySkierMix(s: NearbySkier) {
  const moving = smooth((s.speed-.15)/3), d = Math.max(0, s.distance);
  return {
    gain: s.active ? moving*(.24+.18*clamp(s.skid)) / (1+(d/3.5)**1.65) * (1-smooth((d-30)/20)) : 0,
    cutoff: 650+7000*Math.exp(-d/17),
  };
}

export function snowWindMix(s: AudioState, time: number) {
  const speed = clamp(s.riding ? (s.liftSpeed ?? 2.3) : s.speed, 0, 60);
  const moving = smooth((speed-.08)/2.2);
  const contact = s.grounded && !s.inAir && !s.riding ? moving : 0;
  const hard = clamp(s.groomed), skid = clamp(s.skid), plow = clamp(s.plow);
  const edge = clamp(Math.abs(s.edge)/.85), tuck = clamp(s.tuck ?? 0);
  const sliding = s.fallen ? .45 : 1;
  const loading = .24 + .76*edge;
  const displacement = Math.max(skid, plow*.82);
  const pace = Math.sqrt(clamp(speed/18));
  const gust = .77 + .13*Math.sin(time*.47) + .07*Math.sin(time*.113+2) + .03*Math.sin(time*1.23);
  const exposure = clamp(((s.altitude ?? 2700)-2450)/850);
  const airflow = Math.min(1.6, (speed/23)**1.65) * (1-.38*tuck);
  return {
    wind: (.012 + .20*airflow) * gust,
    windCutoff: 280 + 2100*clamp(airflow),
    breeze: (.025 + .015*exposure + (s.snowing ? .008 : 0) + (s.riding ? .008 : 0)) * gust,
    glide: contact * (.12+.17*pace) * (.35+.65*hard) * (1-.62*displacement) * sliding,
    edge: contact * pace * hard * loading * (1-.7*displacement) * .24 * sliding,
    scrape: contact * (.12+.44*pace) * displacement * (.35+.65*hard) * sliding,
    powder: contact * (.14+.22*pace) * (1-hard) * (1+.35*displacement),
    slide: s.fallen ? contact*(.13+.14*pace) : 0,
    snowCutoff: (s.fallen ? 1700 : 2700+6200*pace),
    // Small pitch changes preserve real grain size; speed primarily changes energy.
    rate: .82 + .29*clamp(speed/22),
    pan: clamp(s.edge, -.8, .8)*.17,
    grain: contact * (s.fallen ? 0 : 1) * (.55*displacement + .2*edge*hard + .25*clamp(s.moguls)) * pace,
  };
}
