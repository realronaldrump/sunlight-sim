import type { ResortData, RunInfo } from '../game';
import { DIFF_COLOR, drawDiffSymbol } from '../runs/runs';
import { DIFF_LABEL } from './hud';
import type { MapPlayer } from './trailMap';
import { mapHeading, mapPoint, nearestTrailPoint, type MapView } from './minimapGeometry';

const ZOOM_SPANS = [400, 800, 1600];
const STORAGE_KEY = 'sunlight.minimap';
const css = `
#minimap { position: fixed; top: 16px; left: 16px; z-index: 10; width: 264px; overflow: hidden; border: 1px solid rgba(255,255,255,.28); border-radius: 12px; background: rgba(10,20,35,.92); box-shadow: 0 4px 20px rgba(0,0,0,.23); font-variant-numeric: tabular-nums; }
body:has(#roombox) #minimap { top: 66px; }
#minimap[hidden], #minimap [hidden] { display: none !important; }
#minimap header { display: flex; align-items: center; justify-content: space-between; padding: 8px 10px; gap: 6px; }
#minimap .mm-location { min-width: 0; }
#minimap .mm-eyebrow { color: #a9c7d4; font-size: 10px; font-weight: 700; letter-spacing: .12em; text-transform: uppercase; }
#minimap .mm-run { display: block; font-size: 14px; font-weight: 650; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; margin-top: 3px; }
#minimap button { border: 1px solid rgba(255,255,255,.18); background: rgba(255,255,255,.09); color: #fff; border-radius: 6px; min-width: 32px; min-height: 32px; font: 600 12px -apple-system, sans-serif; cursor: pointer; }
#minimap button:hover { background: rgba(255,255,255,.2); }
#minimap button:focus-visible { outline: 2px solid #70e6fa; outline-offset: -2px; }
#minimap button:disabled { opacity: .3; cursor: default; }
#minimap canvas { display: block; width: 100%; aspect-ratio: 1; pointer-events: none; background: #d5e0da; }
#minimap footer { padding: 8px; }
#minimap .mm-tools { display: flex; align-items: center; gap: 5px; }
#minimap .mm-zoom { margin: 0 3px; font-size: 11px; color: #c8d8e2; min-width: 38px; text-align: center; }
#minimap .mm-full { margin-left: auto; padding: 0 8px; }
#minimap kbd { font: inherit; color: #a9c7d4; margin-left: 4px; }
#minimap .mm-legend { display: flex; justify-content: space-between; gap: 6px; margin-top: 7px; font-size: 10px; color: #c8d8e2; }
#minimap .mm-legend b { display: inline-block; margin-right: 3px; }
#minimap .mm-collapsed { display: none; width: 100%; padding: 4px 10px; }
#minimap.collapsed { width: auto; border-radius: 8px; }
#minimap.collapsed header, #minimap.collapsed .mm-body { display: none; }
#minimap.collapsed .mm-collapsed { display: block; }
@media (max-height: 760px), (max-width: 700px) { #minimap { width: 224px; } #minimap canvas { aspect-ratio: 1.2; } }
@media (max-height: 580px) { #minimap { width: 194px; top: 10px; left: 10px; } #minimap canvas { aspect-ratio: 1.55; } #minimap .mm-legend { display: none; } }
`;

interface MinimapState {
  self: MapPlayer;
  others: MapPlayer[];
  run: RunInfo | null;
  lift: string | null;
  active: boolean;
}

type Box = [number, number, number, number];
const overlaps = (a: Box, b: Box) => a[0] < b[0] + b[2] && b[0] < a[0] + a[2] && a[1] < b[1] + b[3] && b[1] < a[1] + a[3];

/** A glanceable map independent of the full-screen map's pan, zoom and orientation. */
export class Minimap {
  private root = document.createElement('section');
  private canvas = document.createElement('canvas');
  private g: CanvasRenderingContext2D;
  private layer = document.createElement('canvas');
  private image = new Image();
  private location: HTMLElement;
  private zoomLabel: HTMLElement;
  private zoomIn: HTMLButtonElement;
  private zoomOut: HTMLButtonElement;
  private state: MinimapState | null = null;
  private elapsed = Infinity;
  private dirty = true;
  private zoom = 1;
  private collapsed = false;
  onOpenMap?: () => void;

  constructor(private resort: ResortData, base: string) {
    try {
      const saved = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? 'null');
      if (saved) {
        this.collapsed = saved.collapsed === true;
        if (Number.isInteger(saved.zoom) && saved.zoom >= 0 && saved.zoom < ZOOM_SPANS.length) this.zoom = saved.zoom;
      }
    } catch { /* Settings are optional in private browsing or when storage is unavailable. */ }
    const style = document.createElement('style'); style.textContent = css; document.head.appendChild(style);
    this.root.id = 'minimap'; this.root.hidden = true; this.root.setAttribute('aria-label', 'Skiing minimap');
    this.root.innerHTML = `<button type="button" class="mm-collapsed" aria-label="Show minimap (V)" aria-expanded="false">Minimap <kbd>V</kbd></button>
      <header><div class="mm-location"><div class="mm-eyebrow">Trail guide</div><span class="mm-run">Sunlight Mountain</span></div>
        <button type="button" class="mm-hide" aria-label="Hide minimap (V)" title="Hide minimap (V)" aria-expanded="true">&#8722;</button></header>
      <div class="mm-body"><footer><div class="mm-tools">
        <button type="button" class="mm-out" aria-label="Zoom minimap out" title="Zoom out">&#8722;</button><span class="mm-zoom"></span>
        <button type="button" class="mm-in" aria-label="Zoom minimap in" title="Zoom in">+</button>
        <button type="button" class="mm-full" aria-label="Open full trail map (M)">Full map <kbd>M</kbd></button>
      </div><div class="mm-legend"><span><b style="color:#63d582">●</b>Easy</span><span><b style="color:#78acff">■</b>More difficult</span><span><b>◆</b>Difficult</span><span><b style="color:#ff7799">━</b>Lift</span></div></footer></div>`;
    this.canvas.setAttribute('role', 'img');
    this.canvas.setAttribute('aria-label', 'North-up map following your position, with nearby trails, chairlifts and friends');
    this.root.querySelector('.mm-body')!.prepend(this.canvas);
    document.body.appendChild(this.root);
    this.g = this.canvas.getContext('2d')!;
    this.location = this.root.querySelector('.mm-run')!;
    this.zoomLabel = this.root.querySelector('.mm-zoom')!;
    this.zoomIn = this.root.querySelector('.mm-in')!;
    this.zoomOut = this.root.querySelector('.mm-out')!;
    this.zoomIn.onclick = () => this.changeZoom(-1);
    this.zoomOut.onclick = () => this.changeZoom(1);
    (this.root.querySelector('.mm-hide') as HTMLButtonElement).onclick = () => this.toggle();
    (this.root.querySelector('.mm-collapsed') as HTMLButtonElement).onclick = () => this.toggle();
    (this.root.querySelector('.mm-full') as HTMLButtonElement).onclick = () => this.onOpenMap?.();
    // A pointer click should not leave a button consuming Space while the player skis.
    this.root.addEventListener('click', (event) => {
      if (event.detail > 0 && event.target instanceof HTMLElement) event.target.closest('button')?.blur();
    });
    new ResizeObserver(() => { this.dirty = true; }).observe(this.canvas);
    this.buildLayer(); // Trails remain usable if the terrain image cannot load.
    this.image.onload = () => { this.buildLayer(); this.dirty = true; };
    this.image.src = `${base}/map.jpg`;
    this.syncControls();
  }

  toggle() { this.collapsed = !this.collapsed; this.syncControls(); this.save(); }

  private changeZoom(delta: number) {
    this.zoom = Math.max(0, Math.min(ZOOM_SPANS.length - 1, this.zoom + delta));
    this.syncControls(); this.save();
  }

  private save() {
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify({ zoom: this.zoom, collapsed: this.collapsed })); } catch { /* optional */ }
  }

  private syncControls() {
    this.root.classList.toggle('collapsed', this.collapsed);
    this.zoomIn.disabled = this.zoom === 0;
    this.zoomOut.disabled = this.zoom === ZOOM_SPANS.length - 1;
    const span = ZOOM_SPANS[this.zoom];
    this.zoomLabel.textContent = span < 1000 ? `${span} m` : `${span / 1000} km`;
    this.zoomLabel.title = 'Map width';
    this.dirty = true;
  }

  update(dt: number, state: MinimapState) {
    this.state = state;
    const wasHidden = this.root.hidden;
    this.root.hidden = !state.active;
    if (wasHidden && state.active) this.dirty = true;
    if (!state.active || this.collapsed) return;
    this.elapsed += dt;
    // Deterministic 12 Hz updates keep the marker current without repainting at the game's frame rate.
    if (!this.dirty && this.elapsed < 1 / 12) return;
    this.elapsed = 0; this.dirty = false;
    const label = state.lift ? `${state.lift} lift` : state.run?.name ?? 'Off piste / base area';
    this.location.textContent = label;
    this.location.title = state.run && !state.lift ? `${label} · ${DIFF_LABEL[state.run.difficulty] ?? ''}` : label;
    this.canvas.setAttribute('aria-label', `North-up map. You are ${state.lift ? 'riding ' : 'at '}${label}. ${state.others.length} other skier${state.others.length === 1 ? '' : 's'} in the room.`);
    this.draw(state);
  }

  private buildLayer() {
    const bounds = this.resort.map;
    if (!bounds) return;
    this.layer.width = 1400;
    this.layer.height = Math.round(1400 * (bounds.z1 - bounds.z0) / (bounds.x1 - bounds.x0));
    const g = this.layer.getContext('2d')!;
    g.fillStyle = '#d5e0da'; g.fillRect(0, 0, this.layer.width, this.layer.height);
    if (this.image.complete && this.image.naturalWidth) g.drawImage(this.image, 0, 0, this.layer.width, this.layer.height);
    g.fillStyle = 'rgba(245,250,246,.22)'; g.fillRect(0, 0, this.layer.width, this.layer.height);
    const scale = this.layer.width / (bounds.x1 - bounds.x0);
    g.scale(scale, scale); g.translate(-bounds.x0, -bounds.z0);
    g.lineJoin = 'round'; g.lineCap = 'round';
    for (const run of this.resort.runs) {
      g.fillStyle = DIFF_COLOR[run.difficulty] ?? '#555';
      g.globalAlpha = 0.2;
      for (const polygon of run.outline ?? []) {
        g.beginPath(); polygon.forEach(([x, z], i) => i ? g.lineTo(x, z) : g.moveTo(x, z)); g.closePath(); g.fill();
      }
      g.globalAlpha = 1;
      g.beginPath(); run.points.forEach(([x, , z], i) => i ? g.lineTo(x, z) : g.moveTo(x, z));
      g.setLineDash(run.kind === 'area' || run.difficulty === 'hike' ? [12, 9] : []);
      g.strokeStyle = 'rgba(255,255,255,.85)'; g.lineWidth = 13; g.stroke();
      g.strokeStyle = DIFF_COLOR[run.difficulty] ?? '#555'; g.lineWidth = 7; g.stroke();
    }
    g.setLineDash([]);
  }

  private draw(state: MinimapState) {
    const width = this.canvas.clientWidth, height = this.canvas.clientHeight;
    if (!width || !height) return;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    if (this.canvas.width !== Math.round(width * dpr) || this.canvas.height !== Math.round(height * dpr)) {
      this.canvas.width = Math.round(width * dpr); this.canvas.height = Math.round(height * dpr);
    }
    const view: MapView = { x: state.self.x, z: state.self.z, width, height, span: ZOOM_SPANS[this.zoom] };
    const point = (x: number, z: number) => mapPoint(view, x, z);
    const g = this.g;
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    g.fillStyle = '#d5e0da'; g.fillRect(0, 0, width, height);
    const bounds = this.resort.map;
    if (bounds) {
      const [x0, y0] = point(bounds.x0, bounds.z0), [x1, y1] = point(bounds.x1, bounds.z1);
      g.drawImage(this.layer, x0, y0, x1 - x0, y1 - y0);
    }
    g.lineCap = 'round'; g.lineJoin = 'round';
    // Highlight the occupied run without replacing its difficulty color.
    if (state.run && !state.lift) {
      for (const run of this.resort.runs.filter(r => r.name === state.run!.name)) {
        g.beginPath(); run.points.forEach(([x, , z], i) => { const [sx, sy] = point(x, z); if (i) g.lineTo(sx, sy); else g.moveTo(sx, sy); });
        g.strokeStyle = '#fff'; g.lineWidth = 6; g.stroke();
        g.strokeStyle = DIFF_COLOR[run.difficulty] ?? '#555'; g.lineWidth = 3; g.stroke();
      }
    }
    const placed: Box[] = [[width / 2 - 23, height / 2 - 25, 46, 50], [width - 37, 5, 32, 47], [5, height - 35, 85, 30]];
    const label = (text: string, x: number, y: number, difficulty?: string, lift = false) => {
      g.font = '600 11px -apple-system, sans-serif';
      const w = g.measureText(text).width + (difficulty ? 26 : 14), h = 20;
      const box: Box = [x - w / 2, y - h / 2, w, h];
      if (box[0] < 5 || box[1] < 5 || box[0] + w > width - 5 || box[1] + h > height - 5 || placed.some(b => overlaps(b, box))) return false;
      placed.push(box);
      g.fillStyle = 'rgba(255,255,255,.94)'; g.beginPath(); g.roundRect(...box, 4); g.fill();
      if (difficulty) drawDiffSymbol(g, difficulty, box[0] + 10, y, 9);
      g.fillStyle = lift ? '#a61942' : '#14252b'; g.textAlign = 'left'; g.textBaseline = 'middle';
      g.fillText(text, box[0] + (difficulty ? 20 : 7), y + .5);
      return true;
    };
    for (const lift of this.resort.lifts) {
      const [ax, ay] = point(lift.bottom[0], lift.bottom[2]), [bx, by] = point(lift.top[0], lift.top[2]);
      g.beginPath(); g.moveTo(ax, ay); g.lineTo(bx, by); g.strokeStyle = '#fff'; g.lineWidth = 5; g.stroke();
      g.strokeStyle = '#cf2556'; g.lineWidth = 2.5; g.setLineDash([6, 4]); g.stroke(); g.setLineDash([]);
      for (const [x, y] of [[ax, ay], [bx, by]]) {
        g.beginPath(); g.arc(x, y, 4, 0, Math.PI * 2); g.fillStyle = '#cf2556'; g.fill(); g.strokeStyle = '#fff'; g.lineWidth = 1.5; g.stroke();
      }
      const p = nearestTrailPoint([lift.bottom, lift.top], view.x, view.z);
      const [x, y] = point(p.x, p.z);
      label(`${lift.name} lift`, x, y - 32, undefined, true);
    }
    const nearby = this.resort.runs.map(run => ({ run, point: nearestTrailPoint(run.points, view.x, view.z) }))
      .filter(r => r.point.distance < view.span * .65)
      .sort((a, b) => Number(b.run.name === state.run?.name) - Number(a.run.name === state.run?.name) || a.point.distance - b.point.distance);
    const named = new Set<string>();
    for (const { run, point: p } of nearby) {
      if (named.has(run.name)) continue;
      const [x, y] = point(p.x, p.z);
      for (const offset of [-18, 22, -42, 46]) {
        if (label(run.name, x, y + offset, run.difficulty)) { named.add(run.name); break; }
      }
      if (named.size >= 5) break;
    }
    // Friends use their jacket colors. The local marker is always cyan and drawn last.
    for (const friend of state.others) {
      const [x, y] = point(friend.x, friend.z);
      if (x < 8 || x > width - 8 || y < 8 || y > height - 8) continue;
      this.marker(x, y, friend.heading, friend.color, 6);
      label(friend.name, x, y - 19);
    }
    const [cx, cy] = point(state.self.x, state.self.z);
    g.fillStyle = 'rgba(0,83,105,.17)'; g.beginPath(); g.arc(cx, cy, 19, 0, Math.PI * 2); g.fill();
    this.marker(cx, cy, state.self.heading, '#04bdd7', 10);
    // Compass and a physical distance scale stay fixed while terrain scrolls underneath.
    g.fillStyle = 'rgba(10,20,35,.85)'; g.beginPath(); g.roundRect(width - 33, 7, 26, 42, 6); g.fill();
    g.fillStyle = '#fff'; g.font = '700 11px -apple-system, sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle';
    g.fillText('N', width - 20, 19);
    g.beginPath(); g.moveTo(width - 20, 28); g.lineTo(width - 25, 40); g.lineTo(width - 20, 37); g.lineTo(width - 15, 40); g.closePath(); g.fill();
    const meters = view.span / 4, barWidth = width / 4;
    g.fillStyle = 'rgba(10,20,35,.85)'; g.beginPath(); g.roundRect(7, height - 33, barWidth + 14, 26, 4); g.fill();
    g.fillStyle = '#fff'; g.font = '10px -apple-system, sans-serif'; g.fillText(`${meters} m`, 14 + barWidth / 2, height - 23);
    g.strokeStyle = '#fff'; g.lineWidth = 1.5; g.beginPath(); g.moveTo(14, height - 16); g.lineTo(14, height - 12); g.lineTo(14 + barWidth, height - 12); g.lineTo(14 + barWidth, height - 16); g.stroke();
  }

  private marker(x: number, y: number, heading: number, color: string, size: number) {
    const g = this.g;
    g.save(); g.translate(x, y); g.rotate(mapHeading(heading));
    g.beginPath(); g.moveTo(0, -size - 3); g.lineTo(size, size); g.lineTo(0, size * .5); g.lineTo(-size, size); g.closePath();
    g.strokeStyle = '#14303b'; g.lineWidth = 4; g.stroke();
    g.fillStyle = color; g.fill(); g.strokeStyle = '#fff'; g.lineWidth = 2; g.stroke(); g.restore();
  }
}
