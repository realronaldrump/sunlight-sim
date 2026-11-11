// Heads-up display: speed, slope angle, run name, altitude, hints, help panel and toasts.
import { formatDistance, formatFeet, formatSpeedMph } from './units';

const css = `
#hud { position: fixed; left: 16px; bottom: 16px; z-index: 10; pointer-events: none; font-variant-numeric: tabular-nums; }
#hud .card { background: rgba(10,20,35,.55); backdrop-filter: blur(6px); border-radius: 10px; padding: 10px 14px; margin-top: 8px; min-width: 190px; box-shadow: 0 2px 10px rgba(0,0,0,.2); }
#hud .big { font-size: 28px; font-weight: 700; line-height: 1; }
#hud .unit { font-size: 13px; opacity: .8; margin-left: 4px; font-weight: 500; }
#hud .row { display: flex; gap: 18px; align-items: baseline; }
#hud .lbl { font-size: 11px; text-transform: uppercase; letter-spacing: .08em; opacity: .7; }
#hud .slope-bar { height: 6px; border-radius: 3px; margin-top: 6px; background: linear-gradient(90deg,#3cba54 0%,#3cba54 30%,#2f74ff 30%,#2f74ff 50%,#222 50%,#222 70%,#ff8c1a 70%,#ff8c1a 90%,#e02020 90%); position: relative; }
#hud .slope-bar i { position: absolute; top: -3px; width: 3px; height: 12px; background: #fff; border-radius: 2px; transition: left .15s; }
#runlabel { position: fixed; top: 18px; left: 50%; transform: translateX(-50%); z-index: 10; pointer-events: none; background: rgba(10,20,35,.6); backdrop-filter: blur(6px); padding: 8px 18px; border-radius: 22px; font-size: 18px; font-weight: 600; display: flex; align-items: center; gap: 10px; opacity: 0; transition: opacity .5s; }
#runlabel.show { opacity: 1; }
.diff { display: inline-block; width: 18px; height: 18px; vertical-align: middle; }
.diff.green { background: #2e9e44; border-radius: 50%; }
.diff.blue { background: #1f5fd6; }
.diff.black { background: #111; transform: rotate(45deg) scale(.8); }
.diff.double { width: 34px; background: none; position: relative; }
.diff.double::before, .diff.double::after { content: ''; position: absolute; top: 2px; width: 14px; height: 14px; background: #111; transform: rotate(45deg); }
.diff.double::before { left: 1px; } .diff.double::after { left: 18px; }
.diff.park { background: #f08a1c; border-radius: 9px; width: 26px; height: 12px; }
.diff.hike { background: #7a5230; border-radius: 3px; width: 22px; height: 8px; }
#runlabel small { font-size: 12px; font-weight: 500; opacity: .85; margin-left: 4px; }
#liftdir { position: fixed; bottom: 136px; left: 16px; z-index: 10; pointer-events: none; background: rgba(10,20,35,.55); backdrop-filter: blur(6px); padding: 6px 12px; border-radius: 18px; font-size: 13px; display: flex; gap: 8px; align-items: center; }
#liftdir i { display: inline-block; width: 0; height: 0; border-left: 6px solid transparent; border-right: 6px solid transparent; border-bottom: 14px solid #ff4d6d; transition: transform .2s; }
#hint { position: fixed; bottom: 22%; left: 50%; transform: translateX(-50%); z-index: 10; pointer-events: none; background: rgba(10,20,35,.6); padding: 8px 16px; border-radius: 8px; font-size: 15px; opacity: 0; transition: opacity .3s; text-align: center; }
#hint.show { opacity: 1; }
#help { position: fixed; right: 16px; top: 16px; z-index: 11; background: rgba(10,20,35,.72); backdrop-filter: blur(6px); border-radius: 10px; padding: 12px 16px; font-size: 13px; line-height: 1.6; max-width: 300px; }
#help.hidden { display: none; }
#help h3 { margin: 0 0 6px; font-size: 14px; }
#help kbd { background: rgba(255,255,255,.18); border-radius: 4px; padding: 0 5px; font-family: inherit; font-size: 12px; }
#toast { position: fixed; top: 64px; left: 50%; transform: translateX(-50%); z-index: 12; background: rgba(10,20,35,.75); padding: 6px 14px; border-radius: 6px; font-size: 14px; opacity: 0; transition: opacity .3s; pointer-events: none; }
#toast.show { opacity: 1; }
#stats { position: fixed; right: 16px; bottom: 16px; z-index: 10; font: 11px ui-monospace, monospace; opacity: .7; text-align: right; pointer-events: none; white-space: pre; text-shadow: 0 1px 2px rgba(0,0,0,.6); }
@media (max-width: 600px) { #help { max-width: calc(100vw - 32px); } }
`;

export function diffIcon(d: string) { return `<span class="diff ${d}"></span>`; }
export const DIFF_LABEL: Record<string, string> = { green: 'Easiest', blue: 'More Difficult', black: 'Most Difficult', double: 'Experts Only', park: 'Terrain Park', hike: 'Hike-out' };

export class Hud {
  private speedEl: HTMLElement; private slopeEl: HTMLElement; private altEl: HTMLElement; private marker: HTMLElement;
  private runEl: HTMLElement; private hintEl: HTMLElement; private helpEl: HTMLElement; private toastEl: HTMLElement;
  private statsEl: HTMLElement; private modeEl: HTMLElement;
  private lastRun = ''; private runTimer = 0; private toastTimer = 0;
  private liftEl: HTMLElement;

  constructor() {
    const style = document.createElement('style'); style.textContent = css; document.head.appendChild(style);
    const hud = document.createElement('div'); hud.id = 'hud';
    hud.innerHTML = `
      <div class="card"><div class="row">
        <div><div class="lbl">Speed</div><span class="big" id="h-speed">0</span><span class="unit">mph</span></div>
        <div><div class="lbl">Slope</div><span class="big" id="h-slope">0</span><span class="unit">deg</span></div>
      </div><div class="slope-bar"><i id="h-marker"></i></div>
      <div class="row" style="margin-top:6px;font-size:12px;opacity:.85"><span id="h-alt"></span><span id="h-mode"></span></div></div>`;
    document.body.appendChild(hud);
    const run = document.createElement('div'); run.id = 'runlabel'; document.body.appendChild(run);
    const hint = document.createElement('div'); hint.id = 'hint'; document.body.appendChild(hint);
    const toast = document.createElement('div'); toast.id = 'toast'; toast.setAttribute('role', 'status'); document.body.appendChild(toast);
    const stats = document.createElement('div'); stats.id = 'stats'; document.body.appendChild(stats);
    const lift = document.createElement('div'); lift.id = 'liftdir'; document.body.appendChild(lift);
    this.liftEl = lift;
    const help = document.createElement('div'); help.id = 'help';
    help.innerHTML = `<h3>Controls</h3>
      <kbd>A</kbd>/<kbd>D</kbd> or arrows: edge and turn<br>
      <kbd>S</kbd>: snowplow (pizza) to slow down<br>
      <kbd>W</kbd>: push off on flats, tuck when fast<br>
      <kbd>Space</kbd>: hockey stop; on a chair, stand up on the top ramp<br>
      <kbd>R</kbd>: get up after a fall<br>
      <kbd>C</kbd>: camera (chase, first person, side profile)<br>
      <kbd>G</kbd>: fly a drone / return to skiing<br>
      <kbd>M</kbd>: trail map<br>
      <kbd>V</kbd>: show/hide minimap<br>
      <kbd>O</kbd>: slope angle overlay<br>
      <kbd>F</kbd>: cycle lift speed (1×, 2×, 4×, 8×, 16×)<br>
      <kbd>L</kbd>: tag along with the Snowriders' Club lesson when you are near them<br>
      <kbd>1</kbd>: wave &nbsp; <kbd>2</kbd>: point downhill (friends see both)<br>
      <kbd>Q</kbd> / right click: throw a snowball. Look toward a skier to aim. Hits cause a yard sale!<br>
      On foot: <kbd>K</kbd> at a ski rack leaves or picks up your skis, <kbd>E</kbd> sits at a free table<br>
      <kbd>K</kbd>: step out of / click into your skis. On foot, <kbd>W</kbd><kbd>A</kbd><kbd>S</kbd><kbd>D</kbd> walk, <kbd>Shift</kbd> jogs, the lodge doors are open<br>
      <kbd>Esc</kbd> / <kbd>P</kbd>: pause menu, ski log, teleport and options<br><kbd>T</kbd>: chat &nbsp; <kbd>N</kbd>: sound &nbsp; <kbd>H</kbd>: hide this help<br>Gamepad: left stick steer/tuck/brake, A stop, B get up, Y camera, LB snowball<br>
      Enter the loading lane facing uphill. The arriving chair picks you up where it reaches you. Drag the mouse to look around.`;
    document.body.appendChild(help);
    this.speedEl = document.getElementById('h-speed')!; this.slopeEl = document.getElementById('h-slope')!;
    this.altEl = document.getElementById('h-alt')!; this.marker = document.getElementById('h-marker')!;
    this.modeEl = document.getElementById('h-mode')!;
    this.runEl = run; this.hintEl = hint; this.helpEl = help; this.toastEl = toast; this.statsEl = stats;
  }

  toggleHelp() { this.helpEl.classList.toggle('hidden'); }

  toast(msg: string, secs = 2.5) { this.toastEl.textContent = msg; this.toastEl.classList.add('show'); this.toastTimer = secs; }

  hint(msg: string | null) {
    if (msg) { this.hintEl.innerHTML = msg; this.hintEl.classList.add('show'); } else this.hintEl.classList.remove('show');
  }

  stats(text: string) { this.statsEl.textContent = text; }

  /** Arrow toward the nearest lift load line (relative to where the camera looks). */
  liftDirection(name: string | null, dist: number, relAngle: number) {
    if (!name || this.liftEl.parentElement?.querySelector('#help:not(.hidden)') && false) { this.liftEl.style.display = 'none'; return; }
    this.liftEl.style.display = 'flex';
    this.liftEl.innerHTML = `<i style="transform:rotate(${(relAngle * 180) / Math.PI}deg)"></i><span>${name} lift ${formatDistance(dist)}</span>`;
  }
  hideLiftDirection() { this.liftEl.style.display = 'none'; }

  update(dt: number, speed: number, slopeDeg: number, altitude: number, mode: string, run: { name: string; difficulty: string; stats?: { avgDeg: number; maxDeg: number } } | null) {
    this.speedEl.textContent = formatSpeedMph(speed);
    this.slopeEl.textContent = String(Math.round(slopeDeg));
    this.marker.style.left = `${Math.min(100, (slopeDeg / 50) * 100)}%`;
    this.altEl.textContent = formatFeet(altitude);
    this.modeEl.textContent = mode;
    const key = run ? run.name : '';
    if (key !== this.lastRun) {
      this.lastRun = key;
      if (run) {
        const st = run.stats ? `<small>avg ${Math.round(run.stats.avgDeg)}&deg;, steepest ${Math.round(run.stats.maxDeg)}&deg;</small>` : '';
        this.runEl.innerHTML = `${diffIcon(run.difficulty)}<span>${run.name}</span>${st}`;
        this.runEl.classList.add('show');
        this.runTimer = 5;
      }
    }
    if (this.runTimer > 0) { this.runTimer -= dt; if (this.runTimer <= 0) this.runEl.classList.remove('show'); }
    if (this.toastTimer > 0) { this.toastTimer -= dt; if (this.toastTimer <= 0) this.toastEl.classList.remove('show'); }
  }
}
