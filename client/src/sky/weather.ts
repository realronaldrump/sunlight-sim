// Weather that rolls through. Snow squalls drift from the west-southwest across the Roaring Fork
// country on the shared resort clock, so friends watch the same storms. Each squall is a moving cell
// with grey snow curtains under a dark cloud base low enough to swallow Mount Sopris's summit, and
// cloud tops above. Seen from the chair, one can hide Sopris and later reveal it; when a cell passes
// over you the light flattens, the haze thickens and it snows.
import * as THREE from 'three/webgpu';

export type WeatherMode = 'changing' | 'clear' | 'snow';
const MODE_KEY = 'sunlight.weather';
export function savedWeather(): WeatherMode {
  try { const v = localStorage.getItem(MODE_KEY); return v === 'clear' || v === 'snow' ? v : 'changing'; } catch { return 'changing'; }
}
export function saveWeather(mode: WeatherMode) { try { localStorage.setItem(MODE_KEY, mode); } catch { /* blocked */ } }

const SLOT = 1500;            // s between possible squalls
const SPEED = 11;             // m/s drift (about 25 mph), typical for a winter shower band
const HALF_PATH = 16000;      // m either side of the reference crossing
const DIR = new THREE.Vector2(Math.sin(1.05), -Math.cos(1.05)).normalize(); // toward bearing 60 degrees (ENE)
const PERP = new THREE.Vector2(-DIR.y, DIR.x);
/** Between the resort and Mount Sopris: many squalls cross the line of sight to the mountain. */
const REF = new THREE.Vector2(6000, 6500);
const CLOUD_BASE = 3450;      // m: above the summit of Primo (3,012 m), below Sopris (3,841 m)

export interface Squall { id: number; x: number; z: number; radius: number; strength: number }

function rng(seed: number) { let s = (seed * 2654435761) >>> 0 || 1; return () => { s = (Math.imul(s, 1664525) + 1013904223) >>> 0; return s / 4294967296; }; }

/** Squalls on the map at a shared resort time (deterministic). */
export function squallsAt(now: number): Squall[] {
  const out: Squall[] = [];
  const life = (2 * HALF_PATH) / SPEED;
  const first = Math.floor((now - life) / SLOT), last = Math.floor(now / SLOT);
  for (let k = first; k <= last; k++) {
    const r = rng(k + 7919);
    if (r() > 0.6) continue;                         // a clear spell
    const t0 = k * SLOT + r() * SLOT * 0.5, t = now - t0;
    if (t < 0 || t > life) continue;
    const offset = (r() - 0.5) * 26000, radius = 2300 + r() * 2200, peak = 0.55 + r() * 0.45;
    const along = -HALF_PATH + t * SPEED;
    // build up as it forms, die away at the far end
    const ramp = Math.min(1, t / 500, (life - t) / 600);
    out.push({ id: k, x: REF.x + PERP.x * offset + DIR.x * along, z: REF.y + PERP.y * offset + DIR.y * along, radius, strength: peak * Math.max(0, ramp) });
  }
  return out;
}

/** How hard it is snowing at (x, z): 0 clear .. 1 a squall's heart. */
export function squallIntensity(squalls: Squall[], x: number, z: number) {
  let k = 0;
  for (const s of squalls) {
    const d = Math.hypot(s.x - x, s.z - z) / s.radius;
    k = Math.max(k, s.strength * (1 - THREE.MathUtils.smoothstep(d, 0.5, 1.0)));
  }
  return k;
}

function curtainTexture() {
  const cv = document.createElement('canvas'); cv.width = 128; cv.height = 256;
  const g = cv.getContext('2d')!;
  const img = g.createImageData(128, 256);
  let s = 1234567;
  const rnd = () => { s = (Math.imul(s, 1664525) + 1013904223) >>> 0; return s / 4294967296; };
  const streak = Array.from({ length: 128 }, () => 0.75 + rnd() * 0.25);
  for (let y = 0; y < 256; y++) for (let x = 0; x < 128; x++) {
    const u = x / 127, v = y / 255; // v = 0 at the cloud base
    const sides = Math.sin(Math.PI * u) ** 1.6;
    const fall = (1 - v * 0.55) * Math.min(1, v / 0.04 + 0.3);
    const ground = 1 - Math.max(0, (v - 0.9) / 0.1) * 0.6;
    const a = sides * fall * ground * streak[x] * (0.85 + 0.15 * Math.sin(v * 40 + u * 9));
    const o = (y * 128 + x) * 4;
    img.data[o] = img.data[o + 1] = img.data[o + 2] = 255; img.data[o + 3] = Math.round(255 * Math.max(0, Math.min(1, a)));
  }
  g.putImageData(img, 0, 0);
  const t = new THREE.CanvasTexture(cv); t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

function puffTexture() {
  const cv = document.createElement('canvas'); cv.width = 128; cv.height = 128;
  const g = cv.getContext('2d')!;
  const grad = g.createRadialGradient(64, 64, 4, 64, 64, 64);
  grad.addColorStop(0, 'rgba(255,255,255,1)'); grad.addColorStop(0.55, 'rgba(255,255,255,.75)'); grad.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = grad; g.fillRect(0, 0, 128, 128);
  const t = new THREE.CanvasTexture(cv); t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

/** A heaped cloud: several lumpy lobes, sunlit tops shading to a grey, flatter base. */
function cloudTexture(seed: number) {
  const W = 256, H = 128, cv = document.createElement('canvas'); cv.width = W; cv.height = H;
  const g = cv.getContext('2d')!;
  let s = seed;
  const rnd = () => { s = (Math.imul(s, 1664525) + 1013904223) >>> 0; return s / 4294967296; };
  for (let i = 0; i < 22; i++) {
    const x = 30 + rnd() * (W - 60), y = 40 + rnd() * 55 + (Math.abs(x - W / 2) / W) * 30, r = 18 + rnd() * 30;
    const grad = g.createRadialGradient(x, y - r * 0.3, 2, x, y, r);
    grad.addColorStop(0, 'rgba(255,255,255,.95)'); grad.addColorStop(0.7, 'rgba(235,238,242,.6)'); grad.addColorStop(1, 'rgba(220,224,230,0)');
    g.fillStyle = grad; g.beginPath(); g.arc(x, y, r, 0, Math.PI * 2); g.fill();
  }
  // shade the underside and flatten it
  const img = g.getImageData(0, 0, W, H);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const o = (y * W + x) * 4, shade = 1 - 0.45 * Math.max(0, (y - 50) / 60);
    img.data[o] *= shade; img.data[o + 1] *= shade; img.data[o + 2] *= shade * 1.02;
    if (y > 108) img.data[o + 3] *= Math.max(0, (H - y) / 20);
  }
  g.putImageData(img, 0, 0);
  const t = new THREE.CanvasTexture(cv); t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

interface Cell { group: THREE.Group; curtains: THREE.Mesh[]; base: THREE.Mesh; puffs: THREE.Sprite[]; offsets: { x: number; z: number; w: number }[] }

export class Weather {
  readonly group = new THREE.Group();
  private cells = new Map<number, Cell>();
  private curtainMat: THREE.MeshBasicNodeMaterial;
  private baseMat: THREE.MeshBasicNodeMaterial;
  private puffMat: THREE.SpriteMaterial;
  squalls: Squall[] = [];

  constructor() {
    this.group.name = 'weather';
    this.curtainMat = new THREE.MeshBasicNodeMaterial({ map: curtainTexture(), transparent: true, depthWrite: false, side: THREE.DoubleSide, color: 0xc7ced8 });
    this.baseMat = new THREE.MeshBasicNodeMaterial({ map: puffTexture(), transparent: true, depthWrite: false, side: THREE.DoubleSide, color: 0x6f7883 });
    // haze applied to a cloud's soft edges would draw a pale rim against the sky
    this.puffMat = new THREE.SpriteMaterial({ map: cloudTexture(97), transparent: true, depthWrite: false, color: 0xdfe4ea, fog: false });
    this.baseMat.fog = false;
  }

  /** Snowfall intensity where you are, plus the visible cells, at shared time `now`. */
  update(now: number, camera: THREE.Vector3, light: number, ground: (x: number, z: number) => number) {
    this.squalls = squallsAt(now);
    const live = new Set<number>();
    for (const s of this.squalls) {
      live.add(s.id);
      let cell = this.cells.get(s.id);
      if (!cell) { cell = this.build(s); this.cells.set(s.id, cell); this.group.add(cell.group); }
      const d = Math.hypot(s.x - camera.x, s.z - camera.z);
      // inside the cell you see the snow around you, not its curtain from outside
      const outside = THREE.MathUtils.smoothstep(d / s.radius, 0.45, 0.95);
      const fade = s.strength * outside;
      cell.group.visible = fade > 0.01;
      if (!cell.group.visible) continue;
      cell.group.position.set(s.x, 0, s.z);
      const g = ground(s.x, s.z), floor = Math.min(g, 2600);
      cell.curtains.forEach((c, i) => {
        const o = cell!.offsets[i];
        const h = CLOUD_BASE - floor + 120;
        c.position.set(o.x, floor - 80 + h / 2, o.z);
        c.scale.set(o.w, h, 1);
        // cylindrical billboard: turn to face the viewer around the vertical axis
        c.rotation.set(0, Math.atan2(camera.x - (s.x + o.x), camera.z - (s.z + o.z)), 0);
        (c.material as THREE.MeshBasicNodeMaterial).opacity = 0.85 * fade;
      });
      cell.base.position.set(0, CLOUD_BASE + 60, 0);
      (cell.base.material as THREE.MeshBasicNodeMaterial).opacity = 0.9 * s.strength;
      (cell.base.material as THREE.MeshBasicNodeMaterial).color.setRGB(0.42 * light, 0.46 * light, 0.52 * light);
      for (const c of cell.curtains) (c.material as THREE.MeshBasicNodeMaterial).color.setRGB(0.6 * light, 0.64 * light, 0.71 * light);
      for (const p of cell.puffs) { (p.material as THREE.SpriteMaterial).opacity = 0.92 * s.strength * outside + 0.5 * s.strength * (1 - outside); (p.material as THREE.SpriteMaterial).color.setRGB(0.86 * light, 0.88 * light, 0.92 * light); }
    }
    for (const [id, cell] of this.cells) if (!live.has(id)) { this.group.remove(cell.group); this.cells.delete(id); }
    return squallIntensity(this.squalls, camera.x, camera.z);
  }

  private build(s: Squall): Cell {
    const r = rng(s.id * 31 + 5), group = new THREE.Group(); group.name = `squall-${s.id}`;
    const curtains: THREE.Mesh[] = [], offsets: Cell['offsets'] = [];
    const plane = new THREE.PlaneGeometry(1, 1);
    for (let i = 0; i < 12; i++) {
      const a = r() * Math.PI * 2, d = Math.sqrt(r()) * s.radius * 0.6;
      offsets.push({ x: Math.cos(a) * d, z: Math.sin(a) * d, w: s.radius * (0.8 + r() * 0.6) });
      const m = new THREE.Mesh(plane, this.curtainMat.clone()); m.frustumCulled = false; m.renderOrder = 3;
      curtains.push(m); group.add(m);
    }
    const base = new THREE.Mesh(new THREE.CircleGeometry(s.radius * 1.35, 48), this.baseMat.clone());
    base.rotation.x = -Math.PI / 2; base.frustumCulled = false; base.renderOrder = 2;
    group.add(base);
    const puffs: THREE.Sprite[] = [];
    for (let i = 0; i < 14; i++) {
      const mat = this.puffMat.clone(); mat.map = cloudTexture(s.id * 13 + i);
      const p = new THREE.Sprite(mat);
      const a = r() * Math.PI * 2, d = Math.sqrt(r()) * s.radius * 0.85;
      const size = s.radius * (1.0 + r() * 0.8);
      // the heap sits on the cloud base: lower lobes wide and flat, a few towers above
      p.position.set(Math.cos(a) * d, CLOUD_BASE + size * 0.06 + r() * 550, Math.sin(a) * d);
      p.scale.set(size, size * 0.5, 1);
      p.renderOrder = 2; puffs.push(p); group.add(p);
    }
    return { group, curtains, base, puffs, offsets };
  }
}
