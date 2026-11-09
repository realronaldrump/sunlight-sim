import { DRONE, type DroneState } from '../../../shared/dronePhysics';
import { formatDistance, formatFeet, formatSpeedMph } from '../ui/units';

const css = `
#drone-toggle { position:fixed; bottom:22px; left:50%; transform:translateX(-50%); z-index:12; }
.drone-button { color:#f5fbff; background:rgba(10,24,36,.9); border:1px solid #97c5cf; border-radius:8px; padding:10px 15px; font:600 13px -apple-system,sans-serif; cursor:pointer; }
.drone-button:hover { background:#244759; } .drone-button:focus-visible { outline:2px solid #80e9ff; outline-offset:3px; }
#drone-toggle[hidden], #drone-panel[hidden], #drone-telemetry[hidden] { display:none !important; }
body.drone-mode #hud, body.drone-mode #help, body.drone-mode #liftdir, body.drone-mode #hint { display:none !important; }
#drone-panel { position:fixed; top:16px; right:16px; width:250px; z-index:12; padding:14px; border:1px solid #7ab4c45c; border-radius:12px; background:rgba(8,23,36,.88); backdrop-filter:blur(8px); }
#drone-panel header { display:flex; align-items:center; justify-content:space-between; gap:8px; }
#drone-panel strong { font-size:13px; letter-spacing:.12em; } #drone-view-label { font-size:10px; color:#9eeadf; border:1px solid #9eeadf66; border-radius:4px; padding:4px 6px; }
#drone-panel p { font-size:12px; color:#b9d2dc; line-height:1.5; margin:10px 0; }
#drone-panel .drone-buttons { display:flex; gap:6px; } #drone-panel button { padding:8px 10px; flex:1; font-size:12px; }
#drone-panel details { margin-top:13px; font-size:12px; color:#d3e3eb; line-height:1.8; }
#drone-panel summary { cursor:pointer; color:#fff; } #drone-panel kbd { font:inherit; color:#a5ede7; }
#drone-status { min-height:18px; color:#a5ede7 !important; } #drone-status.warning { color:#ffd095 !important; }
#drone-telemetry { position:fixed; bottom:78px; left:50%; transform:translateX(-50%); z-index:11; display:flex; gap:26px; padding:12px 20px; border:1px solid #7ab4c45c; border-radius:10px; background:rgba(8,23,36,.84); backdrop-filter:blur(6px); pointer-events:none; font-variant-numeric:tabular-nums; }
#drone-telemetry span { display:block; font-size:10px; letter-spacing:.1em; color:#bdd4df; margin-bottom:4px; white-space:nowrap; }
#drone-telemetry b { font-size:18px; font-weight:600; white-space:nowrap; }
@media(max-width:760px) { #drone-panel { width:210px; right:10px; padding:10px; } #drone-telemetry { gap:12px; padding:10px 12px; } #drone-telemetry b { font-size:15px; } }
@media(max-height:600px) { #drone-panel details { max-height:110px; overflow:auto; } #drone-telemetry { bottom:66px; padding:8px 12px; } #drone-toggle { bottom:14px; } }
`;

export class DroneHud {
  private toggle = document.createElement('button');
  private panel = document.createElement('section');
  private telemetry = document.createElement('section');
  private status: HTMLElement;
  private view: HTMLElement;
  private speed: HTMLElement;
  private height: HTMLElement;
  private heading: HTMLElement;
  private distance: HTMLElement;
  private elapsed = 0;
  onToggle?: () => void; onCamera?: () => void; onRecall?: () => void;
  constructor() {
    const style = document.createElement('style'); style.textContent = css; document.head.appendChild(style);
    this.toggle.id = 'drone-toggle'; this.toggle.className = 'drone-button'; this.toggle.type = 'button'; this.toggle.hidden = true;
    this.toggle.textContent = 'Fly a drone  G'; this.toggle.setAttribute('aria-pressed','false');
    this.toggle.onclick = () => this.onToggle?.();
    this.panel.id = 'drone-panel'; this.panel.hidden = true; this.panel.setAttribute('aria-label','Drone flight controls');
    this.panel.innerHTML = `<header><strong>DRONE FLIGHT</strong><span id="drone-view-label">CHASE</span></header>
      <p>Explore Sunlight from above.<br>Your skier stays on the mountain.</p>
      <div class="drone-buttons"><button type="button" class="drone-button" id="drone-camera">FPV / chase · C</button><button type="button" class="drone-button" id="drone-recall">Recall · R</button></div>
      <p id="drone-status" role="status">Stabilized hover</p>
      <details open><summary>Flight controls</summary><kbd>W A S D</kbd> Move · <kbd>E / Q</kbd> Up / down<br>
      Drag to look · Double-click for mouse look<br><kbd>← → ↑ ↓</kbd> Look · <kbd>Space</kbd> Brake<br>
      <kbd>Shift</kbd> Fast · <kbd>Ctrl</kbd> Precision<br><kbd>G</kbd> Return to skiing · <kbd>H</kbd> Help<br>
      Gamepad: left stick move, right stick look,<br>triggers up/down, A brake, Y camera,<br>LB precision, RB fast, B recall, L3 exit.<br>
      Ski-area limit · ${formatFeet(DRONE.ceiling)} above ground</details>`;
    this.telemetry.id = 'drone-telemetry'; this.telemetry.hidden = true; this.telemetry.setAttribute('aria-label','Drone telemetry');
    this.telemetry.innerHTML = `<div><span>AIRSPEED</span><b id="drone-speed"></b></div><div><span>ABOVE GROUND</span><b id="drone-height"></b></div><div><span>HEADING</span><b id="drone-heading"></b></div><div><span>FROM SKIER</span><b id="drone-distance"></b></div>`;
    document.body.append(this.toggle,this.panel,this.telemetry);
    this.status = this.panel.querySelector('#drone-status')!; this.view = this.panel.querySelector('#drone-view-label')!;
    this.speed = this.telemetry.querySelector('#drone-speed')!; this.height = this.telemetry.querySelector('#drone-height')!;
    this.heading = this.telemetry.querySelector('#drone-heading')!; this.distance = this.telemetry.querySelector('#drone-distance')!;
    (this.panel.querySelector('#drone-camera') as HTMLButtonElement).onclick = () => this.onCamera?.();
    (this.panel.querySelector('#drone-recall') as HTMLButtonElement).onclick = () => this.onRecall?.();
    for (const el of [this.panel,this.toggle]) el.addEventListener('click',e => { if(e.detail > 0 && e.target instanceof HTMLElement) e.target.closest('button')?.blur(); });
  }
  help() { const details = this.panel.querySelector('details')!; details.open = !details.open; }
  update(dt: number,s: DroneState | null,fpv: boolean,distance: number,remaining: number,ready: boolean,obscured: boolean,paused: boolean) {
    const active = !!s;
    document.body.classList.toggle('drone-mode',active);
    this.toggle.hidden = !ready || obscured;
    this.toggle.textContent = active ? 'Return to skiing  G' : 'Fly a drone  G';
    this.toggle.setAttribute('aria-pressed',String(active));
    this.panel.hidden = !active || obscured; this.telemetry.hidden = !active || obscured;
    if (!s) return;
    this.elapsed += dt;
    if (this.elapsed < .1) return; this.elapsed = 0;
    this.view.textContent = fpv ? 'FPV' : 'CHASE';
    this.speed.textContent = `${formatSpeedMph(s.speed)} mph`; this.height.textContent = formatFeet(s.agl);
    const bearing = ((-s.yaw*180/Math.PI)%360+360)%360;
    this.heading.textContent = `${String(Math.round(bearing)%360).padStart(3,'0')}° ${['N','NE','E','SE','S','SW','W','NW'][Math.round(bearing/45)%8]}`;
    this.distance.textContent = formatDistance(distance);
    const warnings = { boundary:'Ski-area limit: turn back', ceiling:'Altitude limit reached', ground:'Terrain clearance hold', obstacle:'Obstacle ahead: climb or turn', loading:'Holding for terrain', '':'' };
    this.status.textContent = paused ? 'Controls paused · holding position' : warnings[s.warning] || (remaining < 35 ? `Ski-area limit in ${formatFeet(remaining)}` : s.speed < .2 ? 'Stabilized hover' : 'Flying');
    this.status.classList.toggle('warning',!!s.warning || remaining < 35);
  }
}
