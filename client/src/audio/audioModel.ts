// Pure sound controls, separate from the Web Audio graph so physical transitions can be tested.
export interface AudioPoint { x: number; y: number; z: number }
export interface AudioTerminal { id: string; distance: number; pan: number; speed: number; variant: number }
export interface AudioState {
  speed: number; skid: number; edge: number; grounded: boolean; groomed: number;
  moguls: number; plow: number; riding: boolean; nearTerminal: number;
  towerPass: boolean; fell: boolean; inAir: boolean;
  tuck?: number; fallen?: boolean; snowing?: boolean; altitude?: number;
  impact?: number; landing?: number; boarded?: boolean; unloaded?: boolean;
  discontinuity?: boolean; liftSpeed?: number; terminals?: AudioTerminal[];
}

export const clamp = (x: number, lo = 0, hi = 1) => Math.max(lo, Math.min(hi, Number.isFinite(x) ? x : lo));
const smooth = (x: number) => { const t = clamp(x); return t*t*(3-2*t); };

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
    wind: (.014 + .27*airflow) * gust,
    windCutoff: 280 + 2100*clamp(airflow),
    breeze: (.045 + .025*exposure + (s.snowing ? .012 : 0) + (s.riding ? .012 : 0)) * gust,
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
