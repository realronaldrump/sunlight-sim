import { Vector3, type PerspectiveCamera } from 'three/webgpu';
import type { Vec3 } from '../../../shared/skiPhysics';
import { formatDistance } from '../ui/units';

/** Optional screen-space beacon with a direction cue when the skier is off screen. */
export class PlayerMarker {
  enabled = false;
  private root = document.createElement('div');
  private point = new Vector3();
  private cameraPoint = new Vector3();
  private label = document.createElement('span');
  private arrow = document.createElement('i');
  constructor() {
    const style = document.createElement('style');
    style.textContent = `#player-marker { position:fixed; top:0; left:0; z-index:10; pointer-events:none; display:flex; flex-direction:column; align-items:center; gap:6px; transform:translate(-50%,-100%); color:#e8ffff; font:600 12px -apple-system,sans-serif; } #player-marker[hidden] { display:none; } #player-marker span { background:rgba(8,30,42,.92); border:1px solid #7de9e1; padding:6px 9px; border-radius:6px; white-space:nowrap; } #player-marker i { display:block; width:12px; height:12px; border-right:3px solid #80fff1; border-bottom:3px solid #80fff1; transform:rotate(45deg); filter:drop-shadow(0 1px 2px #000); } #player-marker.edge { transform:translate(-50%,-50%); }`;
    document.head.append(style);
    this.root.id = 'player-marker'; this.root.hidden = true; this.root.setAttribute('aria-label', 'Your skier location');
    this.root.append(this.label, this.arrow); document.body.append(this.root);
    try { this.enabled = localStorage.getItem('sunlight.playerMarker') === 'true'; } catch { /* Optional preference. */ }
  }
  toggle() {
    this.enabled = !this.enabled;
    try { localStorage.setItem('sunlight.playerMarker', String(this.enabled)); } catch { /* Optional preference. */ }
  }
  update(camera: PerspectiveCamera, player: Vec3, active: boolean, liftName?: string) {
    this.root.hidden = !active || !this.enabled;
    if (this.root.hidden) return;
    camera.updateMatrixWorld();
    this.point.set(player.x, player.y + 2.25, player.z);
    this.cameraPoint.copy(this.point).applyMatrix4(camera.matrixWorldInverse);
    const behind = this.cameraPoint.z >= 0;
    this.point.project(camera);
    const w = innerWidth, h = innerHeight;
    let dx = this.point.x * w / 2, dy = -this.point.y * h / 2;
    if (behind) { dx = -dx; dy = -dy; }
    if (!Number.isFinite(dx) || !Number.isFinite(dy) || Math.hypot(dx, dy) < .01) { dx = 0; dy = h; }
    const xLimit = Math.max(20, w / 2 - 100), yLimit = Math.max(20, h / 2 - 190);
    const edge = behind || Math.abs(dx) > xLimit || Math.abs(dy) > yLimit;
    if (edge) { const k = Math.min(xLimit / Math.max(.001, Math.abs(dx)), yLimit / Math.max(.001, Math.abs(dy))); dx *= k; dy *= k; }
    this.root.classList.toggle('edge', edge);
    this.root.style.left = `${w / 2 + dx}px`; this.root.style.top = `${h / 2 + dy}px`;
    this.arrow.style.transform = edge ? `rotate(${Math.atan2(dy, dx) * 180 / Math.PI - 45}deg)` : 'rotate(45deg)';
    const distance = Math.hypot(camera.position.x-player.x,camera.position.y-player.y,camera.position.z-player.z);
    const text = `Your skier${liftName ? ` · ${liftName}` : ''} · ${formatDistance(distance)}${behind ? ' · behind you' : ''}`;
    if (this.label.textContent !== text) this.label.textContent = text;
  }
}
