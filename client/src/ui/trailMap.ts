// Trail map overlay generated from the game's own data (DEM hillshade, lidar forest, run outlines).
// Travel is enabled only when opened through the pause menu.
import type { ResortData, RunInfo } from '../game';
import { DIFF_COLOR, drawDiffSymbol } from '../runs/runs';
import { DIFF_LABEL } from './hud';
import { formatDistance } from './units';
import { IPHONE } from '../platform';

export interface MapPlayer { id?: string; name: string; color: string; x: number; z: number; heading: number; self?: boolean }
/** Extra drawing on top of the runs: a route to follow, a recorded line, a group's position. */
export interface MapOverlay { lines?: { x: number; z: number }[][]; color: string; width?: number; dash?: number[]; points?: { x: number; z: number; label: string }[] }

const css = `
#tmap { position: fixed; inset: 0; z-index: 30; background: rgba(8,16,28,.82); display: none; }
#tmap.show { display: block; }
#tmap canvas { position: absolute; inset: 0; width: 100%; height: 100%; cursor: grab; }
#tmap .title { position: absolute; left: 16px; top: 12px; font-weight: 700; font-size: 18px; text-shadow: 0 1px 3px rgba(0,0,0,.6); pointer-events: none; }
#tmap .tip { position: absolute; padding: 6px 10px; background: rgba(10,20,35,.9); border-radius: 6px; font-size: 13px; pointer-events: none; display: none; white-space: nowrap; }
#tmap .legend { position: absolute; right: 16px; bottom: 16px; background: rgba(10,20,35,.75); padding: 10px 12px; border-radius: 8px; font-size: 12px; line-height: 1.9; pointer-events: none; }
#tmap .legend span.diff { margin-right: 6px; }
#tmap .close { position: absolute; right: 16px; top: 12px; background: rgba(255,255,255,.15); border: 0; color: #fff; padding: 6px 12px; border-radius: 6px; cursor: pointer; font-size: 14px; }
`;

export class TrailMap {
  private root: HTMLDivElement;
  private cv: HTMLCanvasElement;
  private g: CanvasRenderingContext2D;
  private img = new Image();
  private tip: HTMLDivElement;
  private scale = 1; private ox = 0; private oy = 0;
  /** true = view from the base looking up the mountain (south up), like the official trail map */
  flip = true;
  visible = false;
  travelEnabled = false;
  players: MapPlayer[] = [];
  overlays: MapOverlay[] = [];
  onTeleport?: (runName: string) => void;
  onJoinPlayer?: (name: string) => void;
  private hover: RunInfo | null = null;
  private labels: { name: string; x: number; z: number; diff: string; len: number }[] = [];

  constructor(private resort: ResortData, base: string) {
    const style = document.createElement('style'); style.textContent = css; document.head.appendChild(style);
    this.root = document.createElement('div'); this.root.id = 'tmap';
    this.root.innerHTML = `<div class="title">Sunlight Mountain trail map <span style="font-weight:400;font-size:13px;opacity:.8">(viewed from the base, like the resort map)</span></div><button class="close">${IPHONE ? 'Close' : 'Close (M)'}</button><button class="close orient" style="right:130px">North up</button><div class="tip"></div>
      <div class="legend">
        <div><span class="diff green"></span>Easiest</div><div><span class="diff blue"></span>More Difficult</div>
        <div><span class="diff black"></span>Most Difficult</div><div><span class="diff double"></span>Experts Only</div>
        <div><span class="diff park"></span>Terrain Park</div><div style="color:#ff6b6b">&#9473; Chairlift</div>
        <div class="map-instructions"></div></div>`;
    this.cv = document.createElement('canvas');
    this.root.prepend(this.cv);
    document.body.appendChild(this.root);
    this.g = this.cv.getContext('2d')!;
    this.tip = this.root.querySelector('.tip')!;
    (this.root.querySelector('.close') as HTMLButtonElement).onclick = () => this.toggle(false);
    const ob = this.root.querySelector('.orient') as HTMLButtonElement;
    ob.onclick = () => { this.flip = !this.flip; ob.textContent = this.flip ? 'North up' : 'Trail map view'; this.draw(); };
    this.img.src = `${base}/map.jpg`;
    this.img.onload = () => this.draw();
    // label anchor per named run: midpoint of its longest way
    const byName = new Map<string, { name: string; x: number; z: number; diff: string; len: number }>();
    for (const r of resort.runs) {
      let len = 0;
      for (let i = 1; i < r.points.length; i++) len += Math.hypot(r.points[i][0] - r.points[i - 1][0], r.points[i][2] - r.points[i - 1][2]);
      const mid = r.points[Math.floor(r.points.length / 2)];
      const prev = byName.get(r.name);
      if (!prev || len > prev.len) byName.set(r.name, { name: r.name, x: mid[0], z: mid[2], diff: r.difficulty, len });
    }
    this.labels = [...byName.values()].sort((a, b) => b.len - a.len);
    this.bindEvents();
  }

  private fit() {
    const W = this.cv.clientWidth, H = this.cv.clientHeight;
    const m = (this.resort as unknown as { map: { x0: number; x1: number } }).map;
    const size = m.x1 - m.x0;
    this.scale = Math.min(W, H) / (size * 0.72);
    this.ox = W / 2; this.oy = H / 2;
  }

  private toScreen(x: number, z: number) {
    const f = this.flip ? -1 : 1;
    return [this.ox + f * x * this.scale, this.oy + f * z * this.scale];
  }
  private toWorld(sx: number, sy: number) {
    const f = this.flip ? -1 : 1;
    return [f * (sx - this.ox) / this.scale, f * (sy - this.oy) / this.scale];
  }

  toggle(force?: boolean, travel = false) {
    const wasVisible = this.visible;
    this.visible = force ?? !this.visible;
    if (!this.visible) this.travelEnabled = false;
    else if (!wasVisible) this.travelEnabled = travel;
    this.root.querySelector('.map-instructions')!.textContent = this.travelEnabled
      ? `${IPHONE ? 'Tap' : 'Click'} a run or friend to teleport there.`
      : `${IPHONE ? 'Pinch' : 'Scroll'} to zoom, drag to pan. Teleport from the pause menu.`;
    this.root.classList.toggle('show', this.visible);
    if (this.visible) {
      const dpr = Math.min(2, devicePixelRatio);
      this.cv.width = this.cv.clientWidth * dpr; this.cv.height = this.cv.clientHeight * dpr;
      this.g.setTransform(dpr, 0, 0, dpr, 0, 0);
      if (this.scale === 1) this.fit();
      this.draw();
    }
  }

  private bindEvents() {
    const pointers = new Map<number, {x:number;y:number}>();
    let moved=false, travel=0;
    const zoomAt = (x:number,y:number,factor:number) => {
      const [wx,wz]=this.toWorld(x,y), f=this.flip ? -1 : 1;
      this.scale=Math.max(.04,Math.min(8,this.scale*factor));
      this.ox=x-f*wx*this.scale; this.oy=y-f*wz*this.scale;
    };
    this.cv.style.touchAction='none';
    this.cv.addEventListener('pointerdown',e => {
      e.preventDefault();
      if(!pointers.size) { moved=false;travel=0; }
      else moved=true;
      pointers.set(e.pointerId,{x:e.clientX,y:e.clientY});
      try { this.cv.setPointerCapture(e.pointerId); } catch { /* Synthetic test pointer. */ }
    });
    this.cv.addEventListener('pointermove',e => {
      const old=pointers.get(e.pointerId);
      if(old) {
        const before=[...pointers.values()];
        pointers.set(e.pointerId,{x:e.clientX,y:e.clientY});
        const after=[...pointers.values()];
        if(before.length===2) {
          const bx=(before[0].x+before[1].x)/2, by=(before[0].y+before[1].y)/2;
          const ax=(after[0].x+after[1].x)/2, ay=(after[0].y+after[1].y)/2;
          const bd=Math.hypot(before[0].x-before[1].x,before[0].y-before[1].y);
          const ad=Math.hypot(after[0].x-after[1].x,after[0].y-after[1].y);
          zoomAt(bx,by,ad/Math.max(1,bd)); this.ox+=ax-bx;this.oy+=ay-by; moved=true;
        } else {
          const dx=e.clientX-old.x,dy=e.clientY-old.y;
          travel+=Math.hypot(dx,dy); if(travel>6)moved=true;
          this.ox+=dx;this.oy+=dy;
        }
        this.tip.style.display='none';this.draw();return;
      }
      if(e.pointerType==='touch')return;
      const r=this.pick(e.clientX,e.clientY);
      if(r!==this.hover){this.hover=r;this.draw();}
      if(r){
        this.tip.style.display='block';this.tip.style.left=e.clientX+14+'px';this.tip.style.top=e.clientY+10+'px';
        this.tip.innerHTML=`<span class="diff ${r.difficulty}"></span> <b>${r.name}</b> &middot; ${DIFF_LABEL[r.difficulty] ?? ''}${(r as any).stats ? ` &middot; ${formatDistance((r as any).stats.lengthM)}, avg ${(r as any).stats.avgDeg}&deg;, max ${(r as any).stats.maxDeg}&deg;` : ''}`;
      }else this.tip.style.display='none';
    });
    this.cv.addEventListener('pointerup',e => {
      const existed=pointers.delete(e.pointerId);
      if(existed && !moved && !pointers.size && this.visible && this.travelEnabled){
        const friend=this.pickPlayer(e.clientX,e.clientY), run=this.pick(e.clientX,e.clientY);
        if(friend && this.onJoinPlayer){this.onJoinPlayer(friend.id ?? friend.name);this.toggle(false);}
        else if(run && this.onTeleport){this.onTeleport(run.name);this.toggle(false);}
      }
    });
    for(const event of ['pointercancel','lostpointercapture']) this.cv.addEventListener(event,e => {pointers.delete((e as PointerEvent).pointerId);moved=true;});
    this.cv.addEventListener('wheel',e => {e.preventDefault();zoomAt(e.clientX,e.clientY,e.deltaY<0 ? 1.15 : 1/1.15);this.draw();},{passive:false});
    window.addEventListener('resize',() => {pointers.clear();if(this.visible){this.fit();this.toggle(true);}});
  }

  /** Another player's marker under a screen point (within 14 px). */
  pickPlayer(sx: number, sy: number): MapPlayer | null {
    for (const p of this.players) {
      if (p.self) continue;
      const [px, py] = this.toScreen(p.x, p.z);
      if (Math.hypot(px - sx, py - sy) < (IPHONE ? 24 : 14)) return p;
    }
    return null;
  }

  /** Run under a screen point: inside an outline, or within 12 m of a centerline. */
  pick(sx: number, sy: number): RunInfo | null {
    const [x, z] = this.toWorld(sx, sy);
    let best: RunInfo | null = null, bestD = IPHONE ? Math.max(14, 16 / this.scale) : 14;
    for (const r of this.resort.runs) {
      const pts = r.points;
      for (let i = 0; i < pts.length - 1; i++) {
        const ax = pts[i][0], az = pts[i][2], bx = pts[i + 1][0], bz = pts[i + 1][2];
        const dx = bx - ax, dz = bz - az, L2 = dx * dx + dz * dz || 1;
        const t = Math.max(0, Math.min(1, ((x - ax) * dx + (z - az) * dz) / L2));
        const d = Math.hypot(x - ax - dx * t, z - az - dz * t);
        if (d < bestD) { bestD = d; best = r; }
      }
    }
    if (best) return best;
    for (const r of this.resort.runs) {
      const outline = (r as unknown as { outline?: number[][][] }).outline;
      if (outline?.length && pointInPoly(x, z, outline[0])) return r;
    }
    return null;
  }

  draw() {
    if (!this.visible) return;
    const g = this.g, W = this.cv.clientWidth, H = this.cv.clientHeight;
    g.clearRect(0, 0, W, H);
    const m = (this.resort as unknown as { map: { x0: number; x1: number; z0: number; z1: number } }).map;
    if (this.img.complete && this.img.naturalWidth) {
      const [x0, y0] = this.toScreen(m.x0, m.z0), [x1, y1] = this.toScreen(m.x1, m.z1);
      if (this.flip) {
        g.save(); g.translate(x0, y0); g.rotate(Math.PI);
        g.drawImage(this.img, 0, 0, x0 - x1, y0 - y1);
        g.restore();
      } else g.drawImage(this.img, x0, y0, x1 - x0, y1 - y0);
    }
    // run outlines
    for (const r of this.resort.runs) {
      const outline = (r as unknown as { outline?: number[][][] }).outline ?? [];
      const col = DIFF_COLOR[r.difficulty] ?? '#888';
      for (const poly of outline) {
        g.beginPath();
        poly.forEach((p, i) => { const [sx, sy] = this.toScreen(p[0], p[1]); if (i) g.lineTo(sx, sy); else g.moveTo(sx, sy); });
        g.closePath();
        g.fillStyle = hexA(col, r === this.hover ? 0.55 : r.kind === 'area' ? 0.18 : 0.3);
        g.fill();
      }
    }
    // centerlines
    for (const r of this.resort.runs) {
      g.beginPath();
      r.points.forEach((p, i) => { const [sx, sy] = this.toScreen(p[0], p[2]); if (i) g.lineTo(sx, sy); else g.moveTo(sx, sy); });
      g.strokeStyle = r === this.hover ? '#ffd400' : DIFF_COLOR[r.difficulty] ?? '#888';
      g.lineWidth = r === this.hover ? 3.5 : r.kind === 'area' ? 1 : 2;
      if (r.kind === 'area') g.setLineDash([4, 3]); else g.setLineDash([]);
      g.stroke();
    }
    g.setLineDash([]);
    // lifts
    for (const l of this.resort.lifts) {
      const [ax, ay] = this.toScreen(l.bottom[0], l.bottom[2]), [bx, by] = this.toScreen(l.top[0], l.top[2]);
      g.strokeStyle = '#e8245c'; g.lineWidth = 3.5;
      g.beginPath(); g.moveTo(ax, ay); g.lineTo(bx, by); g.stroke();
      g.fillStyle = '#e8245c';
      for (const [x, y] of [[ax, ay], [bx, by]]) { g.beginPath(); g.arc(x, y, 4.5, 0, Math.PI * 2); g.fill(); }
      g.save();
      g.translate((ax + bx) / 2, (ay + by) / 2);
      let ang = Math.atan2(by - ay, bx - ax); if (ang > Math.PI / 2 || ang < -Math.PI / 2) ang += Math.PI;
      g.rotate(ang);
      g.font = 'bold 13px -apple-system, sans-serif'; g.textAlign = 'center';
      g.lineWidth = 3; g.strokeStyle = 'rgba(255,255,255,.9)'; g.strokeText(`${l.name} Chair`, 0, -6);
      g.fillStyle = '#b0123f'; g.fillText(`${l.name} Chair`, 0, -6);
      g.restore();
    }
    for (const o of this.overlays) {
      g.strokeStyle = o.color; g.lineWidth = o.width ?? 4; g.setLineDash(o.dash ?? []); g.lineJoin = 'round'; g.lineCap = 'round';
      for (const line of o.lines ?? []) {
        g.beginPath();
        line.forEach((p, i) => { const [sx, sy] = this.toScreen(p.x, p.z); if (i) g.lineTo(sx, sy); else g.moveTo(sx, sy); });
        g.stroke();
      }
      g.setLineDash([]);
      for (const p of o.points ?? []) {
        const [sx, sy] = this.toScreen(p.x, p.z);
        g.fillStyle = o.color; g.strokeStyle = '#fff'; g.lineWidth = 2;
        g.beginPath(); g.arc(sx, sy, 7, 0, Math.PI * 2); g.fill(); g.stroke();
        g.font = 'bold 12px -apple-system, sans-serif'; g.textAlign = 'center';
        g.lineWidth = 3; g.strokeStyle = 'rgba(0,0,0,.7)'; g.strokeText(p.label, sx, sy - 12);
        g.fillStyle = '#fff'; g.fillText(p.label, sx, sy - 12);
      }
    }
    // labels (greedy, skip overlaps)
    const placed: [number, number, number, number][] = [];
    g.font = '600 12px -apple-system, sans-serif';
    for (const lb of this.labels) {
      const [sx, sy] = this.toScreen(lb.x, lb.z);
      const w = g.measureText(lb.name).width + 22, h = 16;
      const box: [number, number, number, number] = [sx - w / 2, sy - h / 2, w, h];
      if (placed.some((b) => b[0] < box[0] + box[2] && box[0] < b[0] + b[2] && b[1] < box[1] + box[3] && box[1] < b[1] + b[3])) continue;
      placed.push(box);
      g.fillStyle = 'rgba(255,255,255,.82)';
      g.beginPath(); g.roundRect(box[0], box[1], box[2], box[3], 4); g.fill();
      drawDiffSymbol(g, lb.diff, box[0] + 9, sy, 9);
      g.fillStyle = '#111'; g.textBaseline = 'middle'; g.textAlign = 'left';
      g.fillText(lb.name, box[0] + 17, sy + 0.5);
    }
    // players
    for (const p of this.players) {
      const [sx, sy] = this.toScreen(p.x, p.z);
      g.save(); g.translate(sx, sy); g.rotate(-p.heading + (this.flip ? Math.PI : 0));
      g.fillStyle = p.color; g.strokeStyle = '#fff'; g.lineWidth = 2;
      g.beginPath(); g.moveTo(0, -11); g.lineTo(7, 8); g.lineTo(0, 4); g.lineTo(-7, 8); g.closePath(); g.fill(); g.stroke();
      g.restore();
      g.font = 'bold 12px -apple-system, sans-serif'; g.textAlign = 'center';
      g.lineWidth = 3; g.strokeStyle = 'rgba(0,0,0,.7)'; g.strokeText(p.self ? `${p.name} (you)` : p.name, sx, sy - 16);
      g.fillStyle = '#fff'; g.fillText(p.self ? `${p.name} (you)` : p.name, sx, sy - 16);
    }
    // north arrow
    g.fillStyle = 'rgba(255,255,255,.9)'; g.font = 'bold 14px sans-serif'; g.textAlign = 'center';
    if (this.flip) { g.fillText('N', 30, 96); g.beginPath(); g.moveTo(30, 84); g.lineTo(24, 66); g.lineTo(36, 66); g.closePath(); g.fill(); }
    else { g.fillText('N', 30, 62); g.beginPath(); g.moveTo(30, 66); g.lineTo(24, 84); g.lineTo(36, 84); g.closePath(); g.fill(); }
  }
}

function hexA(hex: string, a: number) {
  const n = parseInt(hex.slice(1), 16);
  return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${a})`;
}

function pointInPoly(x: number, z: number, poly: number[][]) {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const xi = poly[i][0], zi = poly[i][1], xj = poly[j][0], zj = poly[j][1];
    if ((zi > z) !== (zj > z) && x < ((xj - xi) * (z - zi)) / (zj - zi) + xi) inside = !inside;
  }
  return inside;
}
