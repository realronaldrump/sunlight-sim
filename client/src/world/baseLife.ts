// Life around the base area: people eating in the lodge and on the sun deck, walking in ski boots
// between the lodge doors, ski racks, lift lines and the parking lot, standing and chatting with their
// skis planted, and queuing in roped lift mazes. Queues board exactly the chairs that carry ambient
// riders, so every departing chair you watch was loaded by someone you saw waiting.
import * as THREE from 'three/webgpu';
import { createWalker, stepWalker, supportHeight, type WalkState } from '../../../shared/walk';
import { collideCylinder, type SkierState } from '../../../shared/skiPhysics';
import type { ColliderGrid, Collider } from '../../../shared/collision';
import type { LiftSystem } from '../lifts/liftSystem';
import type { LiftPath } from '../../../shared/lifts';
import { walkable, type Poi } from './walkable';
import { PedestrianModel, type Appearance, type SignWalkerOutfit } from './pedestrian';
import { CrowdGear } from './crowdGear';
import { LODGE_SKI_START } from './mainLodge';
import { dressSignWalker, LODGE_SIGN_WALKER, makeSignWalkerOutfit } from './lodgeSignWalker';
import { makeGuest, guestAppearance, rng, pick, type Guest } from './guests';

function appearance(r: () => number, indoor = false): Appearance {
  return guestAppearance(makeGuest(r, { indoor }));
}

// ---------------------------------------------------------------- navigation graph
interface Waypoint { x: number; y: number; z: number }
interface NavNode extends Waypoint { id: number; links: number[]; tag?: string }
type Terrain = (x: number, z: number) => number;

class NavGraph {
  nodes: NavNode[] = [];
  private grid = new Map<number, number[]>();
  private hits: Collider[] = [];
  constructor(private terrain: Terrain, private colliders: ColliderGrid) {}
  private key(x: number, z: number) { return Math.floor(x / 8) * 100003 + Math.floor(z / 8); }

  blockedAt(x: number, y: number, z: number, r = 0.3) {
    for (const c of this.colliders.query(x, z, this.hits)) {
      if (!(y < c.top - 0.35 && (c.bottom === undefined || y + 1.75 > c.bottom))) continue;
      if (c.type === 'cyl') { if (Math.hypot(x - c.x, z - c.z) < c.r! + r) return true; continue; }
      const cs = Math.cos(c.yaw ?? 0), sn = Math.sin(c.yaw ?? 0), dx = x - c.x, dz = z - c.z;
      const lx = cs * dx - sn * dz, lz = sn * dx + cs * dz;
      const qx = Math.max(-c.hx!, Math.min(c.hx!, lx)), qz = Math.max(-c.hz!, Math.min(c.hz!, lz));
      if (Math.hypot(lx - qx, lz - qz) < r) return true;
    }
    return false;
  }

  add(x: number, z: number, yHint: number, tag?: string) {
    const s = supportHeight(x, z, yHint + 0.2, this.terrain, walkable.surfaces);
    if (!s || Math.abs(s.h - yHint) > 1.0 || this.blockedAt(x, s.h, z)) return null;
    const n: NavNode = { id: this.nodes.length, x, y: s.h, z, links: [], tag };
    this.nodes.push(n);
    const k = this.key(x, z); let a = this.grid.get(k); if (!a) this.grid.set(k, a = []); a.push(n.id);
    return n;
  }

  clear(a: Waypoint, b: Waypoint, radius = 0.3) {
    const d = Math.hypot(b.x - a.x, b.z - a.z), n = Math.max(1, Math.ceil(d / 0.4));
    let y = a.y;
    for (let i = 1; i <= n; i++) {
      const t = i / n, x = a.x + (b.x - a.x) * t, z = a.z + (b.z - a.z) * t;
      const s = supportHeight(x, z, y, this.terrain, walkable.surfaces);
      if (!s) return false;
      const rise = Math.abs(s.h - y), step = d / n;
      if (rise > 0.45 || (s.onSnow && rise > step * 0.45)) return false; // ledges and snow steeper than ~24 degrees
      y = s.h;
      if (this.blockedAt(x, y, z, radius)) return false;
    }
    return Math.abs(y - b.y) < 0.5;
  }

  near(x: number, z: number, r: number) {
    const out: NavNode[] = [];
    for (let i = Math.floor((x - r) / 8); i <= Math.floor((x + r) / 8); i++)
      for (let j = Math.floor((z - r) / 8); j <= Math.floor((z + r) / 8); j++)
        for (const id of this.grid.get(i * 100003 + j) ?? []) { const n = this.nodes[id]; if (Math.hypot(n.x - x, n.z - z) <= r) out.push(n); }
    return out;
  }

  linkAll() {
    for (const a of this.nodes) {
      const r = a.tag === 'grid' ? 10.5 : 4.2;
      for (const b of this.near(a.x, a.z, r)) {
        if (b.id <= a.id || Math.abs(b.y - a.y) > 4.5) continue;
        if (a.tag === 'grid' && b.tag === 'grid' && Math.hypot(b.x - a.x, b.z - a.z) > 10.5) continue;
        if (this.clear(a, b)) { a.links.push(b.id); b.links.push(a.id); }
      }
    }
  }

  nearest(x: number, y: number, z: number) {
    let best: NavNode | null = null, bd = Infinity;
    for (const n of this.near(x, z, 12)) { const d = Math.hypot(n.x - x, n.z - z) + Math.abs(n.y - y) * 3; if (d < bd && n.links.length) { bd = d; best = n; } }
    return best;
  }

  path(from: NavNode, to: NavNode) {
    const g = new Map<number, number>([[from.id, 0]]), came = new Map<number, number>();
    const open = new Set([from.id]);
    const h = (n: NavNode) => Math.hypot(n.x - to.x, n.z - to.z);
    for (let guard = 0; open.size && guard < 4000; guard++) {
      let cur = -1, best = Infinity;
      for (const id of open) { const f = g.get(id)! + h(this.nodes[id]); if (f < best) { best = f; cur = id; } }
      if (cur === to.id) break;
      open.delete(cur);
      const c = this.nodes[cur];
      for (const nid of c.links) {
        const n = this.nodes[nid], cost = g.get(cur)! + Math.hypot(n.x - c.x, n.z - c.z) + Math.abs(n.y - c.y) * 2;
        if (cost < (g.get(nid) ?? Infinity)) { g.set(nid, cost); came.set(nid, cur); open.add(nid); }
      }
    }
    if (!came.has(to.id) && from.id !== to.id) return null;
    const out: NavNode[] = [to];
    let cur = to.id;
    while (came.has(cur)) { cur = came.get(cur)!; out.unshift(this.nodes[cur]); }
    return out;
  }
}

// ---------------------------------------------------------------- people
type Kind = 'seated' | 'walker' | 'group' | 'queue' | 'staff';
interface Person {
  kind: Kind; model: PedestrianModel; st: WalkState; time: number;
  seatH?: number; tableH?: number; lookYaw: number; lookTimer: number;
  path?: Waypoint[]; patrol?: Waypoint[]; dest?: NavNode; wait: number; stuck: number; lastD: number;
  /** In a lift line. seat -1: just arrived from a run, waiting at the maze entrance for a place in the back row. */
  queue?: { q: LiftQueue; row: number; seat: number; boarding: number };
  guest?: Guest;
  skis: 'shoulder' | 'feet' | 'planted' | 'none'; outdoorSkis: 'shoulder' | 'feet' | 'planted' | 'none'; visible: boolean; frame: number;
  /** Guests come and go with the day: present while the day's crowd level exceeds this. */
  presence: number;
  /** Lift operator: which line they run, and their signal arm (0..1). */
  operates?: LiftQueue; signal?: number;
}

interface LiftQueue { li: number; path: LiftPath; rows: number; seats: number; members: (Person | null)[][]; lastT: number; heading: number; boarding: Map<number, Person[]>; arrivals: Person[]; closure?: THREE.Group; rope?: Collider }

export class BaseLife {
  readonly group = new THREE.Group();
  private gear: CrowdGear;
  private people: Person[] = [];
  private nav: NavGraph;
  private queues: LiftQueue[] = [];
  private destinations: NavNode[] = [];
  private built = false;
  private clock = 0;
  private frameNo = 0;
  private r = rng(4217);
  /** Resort Day: 0..1 share of the usual crowd at this hour. */
  private level = 1;
  private open = true;

  constructor(private lifts: LiftSystem, private terrain: Terrain, private colliders: ColliderGrid,
    private budget: { seated: number; walkers: number; groups: number; queueRows: number }) {
    this.group.name = 'base-life';
    this.gear = new CrowdGear(budget.seated + budget.walkers + budget.groups * 4 + 90);
    this.group.add(this.gear.group);
    this.nav = new NavGraph(terrain, colliders);
    this.buildMazes();
  }

  private person(kind: Kind, look: Appearance, x: number, y: number, z: number, heading: number, skis: Person['skis'], outfit?: SignWalkerOutfit): Person {
    const model = new PedestrianModel(look, outfit);
    model.root.visible = false;
    this.group.add(model.root);
    const p: Person = { kind, model, st: createWalker(x, y, z, heading), time: this.r() * 100, lookYaw: 0, lookTimer: this.r() * 5,
      wait: this.r() * 8, stuck: 0, lastD: Infinity, skis, outdoorSkis: skis, visible: false, frame: Math.floor(this.r() * 3), presence: this.r() * 0.98 };
    this.people.push(p);
    return p;
  }

  // ---------- lift mazes: an open lane straight to the load line and a crowd lane beside it that merges
  // in front of the line, as at real chairlift mazes. Posts and ropes block skiers and walkers.
  private laneShift(path: LiftPath) { return path.def.seats * 0.6 + 1.3; }
  private mazeGeo(path: LiftPath, rows: number) {
    const lp = path.loadPoint(), w = this.laneShift(path), half = w / 2;
    const post = new THREE.MeshStandardNodeMaterial({ color: 0x2c8a3c, roughness: 0.6 });
    const rope = new THREE.MeshStandardNodeMaterial({ color: 0xc8202a, roughness: 0.7 });
    const len = 3 + rows * 1.75 + 2;
    const g = new THREE.Group();
    // lines across the lift axis: player lane outer edge, the divider, and the crowd lane outer edge
    for (const [lateral, from] of [[-half, 1.5], [half, 3.6], [half + w, 1.5]] as const) {
      let prev: THREE.Vector3 | null = null;
      for (let d = from; d <= len + 0.01; d += (len - from) / Math.ceil((len - from) / 3)) {
        const x = lp.x - path.ax * d + path.rx * lateral, z = lp.z - path.az * d + path.rz * lateral;
        const y = this.terrain(x, z);
        if (!Number.isFinite(y)) continue;
        const m = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.035, 1.15, 8), post); m.position.set(x, y + 0.5, z); g.add(m);
        const top = new THREE.Vector3(x, y + 0.98, z);
        if (prev) {
          const mid = prev.clone().add(top).multiplyScalar(0.5); mid.y -= 0.06;
          const curve = new THREE.QuadraticBezierCurve3(prev, mid, top);
          g.add(new THREE.Mesh(new THREE.TubeGeometry(curve, 6, 0.008, 4), rope));
          this.colliders.add({ type: 'box', x: mid.x, z: mid.z, hx: prev.distanceTo(top) / 2, hz: 0.05, yaw: Math.atan2(-(top.z - prev.z), top.x - prev.x), top: y + 1.0 });
        }
        prev = top;
      }
    }
    // lift name board on two posts at the maze entrance, facing arriving skiers
    const cv = document.createElement('canvas'); cv.width = 512; cv.height = 192;
    const c2 = cv.getContext('2d')!;
    c2.fillStyle = '#163f2a'; c2.fillRect(0, 0, 512, 192); c2.strokeStyle = '#e9e2c8'; c2.lineWidth = 8; c2.strokeRect(10, 10, 492, 172);
    c2.fillStyle = '#f3eedc'; c2.font = 'bold 84px Helvetica, Arial, sans-serif'; c2.textAlign = 'center'; c2.textBaseline = 'middle';
    c2.fillText(path.def.name.toUpperCase(), 256, 84);
    c2.font = '30px Helvetica, Arial, sans-serif'; c2.fillText(`${path.def.seats}-person chair  ·  load here`, 256, 148);
    const tex = new THREE.CanvasTexture(cv); tex.colorSpace = THREE.SRGBColorSpace;
    const bx = lp.x - path.ax * (len + 1.2) + path.rx * w * 0.5, bz = lp.z - path.az * (len + 1.2) + path.rz * w * 0.5;
    const by = this.terrain(bx, bz);
    if (Number.isFinite(by)) {
      const board = new THREE.Mesh(new THREE.PlaneGeometry(1.8, 0.68), new THREE.MeshStandardNodeMaterial({ map: tex, roughness: 0.7, side: THREE.DoubleSide }));
      board.position.set(bx, by + 1.75, bz); board.rotation.y = lp.heading; g.add(board); // faces arriving skiers
      const wood = new THREE.MeshStandardNodeMaterial({ color: 0x5a3f2a, roughness: 0.9 });
      for (const s of [-0.8, 0.8]) { const postM = new THREE.Mesh(new THREE.BoxGeometry(0.1, 2.1, 0.1), wood); postM.position.set(bx + path.rx * s, by + 1.0, bz + path.rz * s); g.add(postM); }
    }
    g.traverse((o) => { if ((o as THREE.Mesh).isMesh) { o.castShadow = true; o.receiveShadow = true; } });
    return g;
  }

  private buildMazes() {
    this.lifts.paths.forEach((path, li) => {
      const rows = Math.max(1, Math.round(this.budget.queueRows * (path.def.name === 'Segundo' ? 1.3 : path.def.name === 'Tercero' ? 1 : 0.8)));
      const lp = path.loadPoint();
      const q: LiftQueue = { li, path, rows, seats: path.def.seats, members: [], lastT: this.lifts.now(li), heading: lp.heading, boarding: new Map(), arrivals: [] };
      this.group.add(this.mazeGeo(path, rows));
      this.buildClosure(q);
      this.queues.push(q);
    });
  }

  /** A rope across both lanes at the back of the maze with a LIFT CLOSED sign, raised outside operating hours. */
  private buildClosure(q: LiftQueue) {
    const path = q.path, lp = path.loadPoint(), w = this.laneShift(path), half = w / 2;
    const d = 2 + q.rows * 1.75 + 3.4;
    const g = new THREE.Group(); g.name = `${path.def.name}-closed`;
    const pts: THREE.Vector3[] = [];
    for (const lat of [-half - 0.3, half + w + 0.3]) {
      const x = lp.x - path.ax * d + path.rx * lat, z = lp.z - path.az * d + path.rz * lat, y = this.terrain(x, z);
      if (!Number.isFinite(y)) return;
      const post = new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.04, 1.2, 8), new THREE.MeshStandardNodeMaterial({ color: 0x2c8a3c, roughness: 0.6 }));
      post.position.set(x, y + 0.55, z); g.add(post);
      pts.push(new THREE.Vector3(x, y + 1.0, z));
    }
    const mid = pts[0].clone().add(pts[1]).multiplyScalar(0.5); mid.y -= 0.08;
    g.add(new THREE.Mesh(new THREE.TubeGeometry(new THREE.QuadraticBezierCurve3(pts[0], mid, pts[1]), 12, 0.012, 5), new THREE.MeshStandardNodeMaterial({ color: 0xf4a300, roughness: 0.7 })));
    const cv = document.createElement('canvas'); cv.width = 384; cv.height = 128;
    const c2 = cv.getContext('2d')!;
    c2.fillStyle = '#c8202a'; c2.fillRect(0, 0, 384, 128); c2.strokeStyle = '#fff'; c2.lineWidth = 8; c2.strokeRect(6, 6, 372, 116);
    c2.fillStyle = '#fff'; c2.font = 'bold 52px Helvetica, Arial, sans-serif'; c2.textAlign = 'center'; c2.textBaseline = 'middle'; c2.fillText('LIFT CLOSED', 192, 52);
    c2.font = '24px Helvetica, Arial, sans-serif'; c2.fillText('Open 9 AM to 4 PM', 192, 98);
    const tex = new THREE.CanvasTexture(cv); tex.colorSpace = THREE.SRGBColorSpace;
    const sign = new THREE.Mesh(new THREE.PlaneGeometry(1.1, 0.37), new THREE.MeshStandardNodeMaterial({ map: tex, side: THREE.DoubleSide, roughness: 0.7 }));
    sign.position.set(mid.x, mid.y - 0.25, mid.z); sign.rotation.y = lp.heading; g.add(sign);
    g.visible = false;
    this.group.add(g);
    q.closure = g;
    // the rope blocks the lanes only while it is up (its top sits below the snow otherwise)
    q.rope = { type: 'box', x: mid.x, z: mid.z, hx: pts[0].distanceTo(pts[1]) / 2, hz: 0.1, yaw: Math.atan2(-(pts[1].z - pts[0].z), pts[1].x - pts[0].x), top: -1e9 };
    this.colliders.add(q.rope);
  }

  /** Resort Day: whether the lifts run, and how busy the base is at this hour. */
  setOperating(open: boolean, level: number) {
    this.open = open; this.level = level;
    for (const q of this.queues) {
      if (q.closure) q.closure.visible = !open;
      if (q.rope) q.rope.top = open ? -1e9 : this.terrain(q.rope.x, q.rope.z) + 1.0;
    }
  }

  /** Row 0 waits at the merge; boarding skiers step diagonally into their seat lane just behind the line. */
  private queueSpot(q: LiftQueue, row: number, seat: number) {
    const lp = q.path.loadPoint(), d = row < 0 ? 0.7 : 3.0 + row * 1.75;
    const off = q.path.seatOffset(seat) + (row < 0 ? 0 : this.laneShift(q.path));
    const x = lp.x - q.path.ax * d + q.path.rx * off, z = lp.z - q.path.az * d + q.path.rz * off;
    return { x, z, y: this.terrain(x, z) };
  }

  /** Build the navigation graph and populate the base once terrain, buildings and nearby trees exist. */
  private build() {
    this.built = true;
    const lodgeDoor = walkable.pois.find((p) => p.tag === 'south-door');
    const centers = [
      ...this.lifts.paths.filter((p) => p.def.name !== 'Primo').map((p) => p.loadPoint()),
      ...(lodgeDoor ? [lodgeDoor] : []),
    ];
    // outdoor grid over the base area (snow, roads, decks), excluding steep or obstructed spots
    const xs = centers.map((c) => c.x), zs = centers.map((c) => c.z);
    const x0 = Math.min(...xs) - 70, x1 = Math.max(...xs) + 150, z0 = Math.min(...zs) - 70, z1 = Math.max(...zs) + 70;
    for (let x = x0; x <= x1; x += 7) for (let z = z0; z <= z1; z += 7) {
      const y = this.terrain(x, z); if (!Number.isFinite(y)) continue;
      this.nav.add(x, z, y, 'grid');
    }
    // interiors and decks at finer spacing
    for (const v of walkable.surfaces.volumes) {
      const c = Math.cos(v.yaw), s = Math.sin(v.yaw);
      for (let lx = -v.hx + 1; lx <= v.hx - 1; lx += 2.2) for (let lz = -v.hz + 1; lz <= v.hz - 1; lz += 2.2) {
        this.nav.add(v.cx + c * lx + s * lz, v.cz - s * lx + c * lz, v.y0, 'room');
      }
    }
    for (const f of walkable.surfaces.surfaces) {
      if (!/deck|entrance/i.test(f.name ?? '')) continue;
      const c = Math.cos(f.yaw), s = Math.sin(f.yaw);
      for (let lx = -f.hx + 0.8; lx <= f.hx - 0.8; lx += 2) for (let lz = -f.hz + 0.8; lz <= f.hz - 0.8; lz += 2) this.nav.add(f.cx + c * lx + s * lz, f.cz - s * lx + c * lz, f.y0, 'deck');
    }
    for (const p of walkable.pois) if (p.kind !== 'seat') { const n = this.nav.add(p.x, p.z, p.y, p.tag); if (n) this.destinations.push(n); }
    for (const q of this.queues) { const s = this.queueSpot(q, q.rows + 1.5, (q.seats - 1) / 2); if (Number.isFinite(s.y)) { const n = this.nav.add(s.x, s.z, s.y, 'lift-line'); if (n) this.destinations.push(n); } }
    this.nav.linkAll();
    this.destinations = this.destinations.filter((n) => n.links.length);
    this.populate();
    this.populateSignWalker();
  }

  private populate() {
    const r = this.r, B = this.budget;
    // diners and drinkers: whole tables, not evenly scattered singles
    const seats = walkable.pois.filter((p) => p.kind === 'seat');
    const indoorSeats = seats.filter((p) => p.indoor), deckSeats = seats.filter((p) => !p.indoor);
    const take = (list: Poi[], n: number) => {
      const chosen: Poi[] = [];
      while (chosen.length < n && list.length) {
        const a = list[Math.floor(r() * list.length)];
        const table = list.filter((q) => Math.hypot(q.x - a.x, q.z - a.z) < 1.6).slice(0, 2 + Math.floor(r() * 3));
        for (const q of table) { if (chosen.length < n && !chosen.includes(q)) chosen.push(q); list.splice(list.indexOf(q), 1); }
      }
      return chosen;
    };
    for (const s of [...take(indoorSeats, Math.round(B.seated * 0.78)), ...take(deckSeats, Math.round(B.seated * 0.22))]) {
      const floor = Math.max(-Infinity, ...walkable.surfaces.heightsAt(s.x, s.z).filter((h) => h <= s.y));
      const fy = Number.isFinite(floor) ? floor : s.y - 0.45;
      const p = this.person('seated', appearance(r, !!s.indoor), s.x, fy, s.z, s.heading, 'none');
      p.seatH = s.y - fy;
      p.tableH = s.tag === 'stool' ? 1.06 : s.tag === 'bench' ? undefined : 0.76;
      if (s.tag === 'deck') p.tableH = 0.79;
    }
    // walkers carrying their skis between the lodge, racks, lift lines and the parking lot
    const outside = this.destinations.filter((n) => n.tag && !/-in$|servery|register|rentals/.test(n.tag));
    for (let i = 0; i < B.walkers && this.destinations.length; i++) {
      const start = pick(outside.length ? outside : this.destinations, r);
      const p = this.person('walker', appearance(r), start.x + (r() - 0.5), start.y, start.z + (r() - 0.5), r() * 6.28, r() < 0.8 ? 'shoulder' : 'none');
      p.wait = r() * 4;
    }
    // small groups standing and talking, skis planted beside them
    const spots = this.destinations.filter((n) => /rack|deck-steps|lower-door|lift-line/.test(n.tag ?? ''));
    for (let gI = 0; gI < B.groups && spots.length; gI++) {
      const c = pick(spots, r), n = 2 + Math.floor(r() * 3), base = r() * 6.28;
      const cx = c.x + (r() - 0.5) * 6, cz = c.z + (r() - 0.5) * 6, cy = this.terrain(cx, cz);
      if (!Number.isFinite(cy) || this.nav.blockedAt(cx, cy, cz, 1.2)) continue;
      for (let k = 0; k < n; k++) {
        const a = base + k * Math.PI * 2 / n, x = cx + Math.cos(a) * 0.85, z = cz + Math.sin(a) * 0.85;
        const heading = Math.atan2(-(cx - x), -(cz - z));
        this.person('group', appearance(r), x, this.terrain(x, z), z, heading, r() < 0.75 ? 'planted' : 'shoulder');
      }
    }
    // a lift operator stands at each load area, between the hut and the line, watching the chairs
    for (const q of this.queues) {
      const lp = q.path.loadPoint(), w = this.laneShift(q.path);
      const x = lp.x - q.path.ax * 1.5 - q.path.rx * (w * 0.5 + 1.4), z = lp.z - q.path.az * 1.5 - q.path.rz * (w * 0.5 + 1.4);
      const y = this.terrain(x, z);
      if (!Number.isFinite(y)) continue;
      const look = appearance(r); look.jacket = new THREE.Color(0x1b1d22); look.hat = 'beanie'; look.hatColor = new THREE.Color(0xb3262e);
      const op = this.person('staff', look, x, y, z, Math.atan2(q.path.rx, q.path.rz) + Math.PI, 'none');
      op.operates = q; op.signal = 0;
    }
    // lift lines: rows of skiers standing on their skis, facing uphill
    for (const q of this.queues) {
      for (let row = 0; row < q.rows; row++) {
        q.members.push([]);
        for (let seat = 0; seat < q.seats; seat++) {
          if (row === q.rows - 1 && r() < 0.4) { q.members[row].push(null); continue; }
          const s = this.queueSpot(q, row, seat);
          if (!Number.isFinite(s.y)) { q.members[row].push(null); continue; }
          q.members[row].push(this.queuer(q, row, seat, s, makeGuest(r)));
        }
      }
    }
  }

  private queuer(q: LiftQueue, row: number, seat: number, at: Waypoint, guest: Guest) {
    const p = this.person('queue', guestAppearance(guest), at.x, at.y, at.z, q.heading, 'feet');
    p.queue = { q, row, seat, boarding: 0 };
    p.guest = guest;
    return p;
  }

  /** Where people who have just skied down wait, single file, before stepping into the back row. */
  private entrance(q: LiftQueue, k = 0) { return this.queueSpot(q, q.rows + 1.5 + k * 1.6, (q.seats - 1) / 2); }

  /** A skier finished a run near a lift: they ski over and join the back of its line, keeping who they are. */
  arrive(guest: Guest, x: number, z: number) {
    if (!this.built) return false;
    let best: LiftQueue | null = null, bd = 160;
    for (const q of this.queues) {
      const e = this.entrance(q), d = Math.hypot(e.x - x, e.z - z);
      if (d < bd && q.arrivals.length < 6) { bd = d; best = q; }
    }
    const y = this.terrain(x, z);
    if (!best || !Number.isFinite(y)) return false;
    const e = this.entrance(best);
    const from = this.nav.nearest(x, y, z), to = Number.isFinite(e.y) ? this.nav.nearest(e.x, e.y, e.z) : null;
    const route = from && to ? this.nav.path(from, to) : null;
    if (!route) return false;
    const p = this.queuer(best, best.rows, -1, { x, y, z }, guest);
    p.path = [...route, e];
    best.arrivals.push(p);
    return true;
  }

  /** Fill an empty back-row place with the next person waiting at the entrance. */
  private admit(q: LiftQueue, seat: number) {
    const i = q.arrivals.findIndex((m) => !m.path?.length);
    if (i < 0) return null;
    const [m] = q.arrivals.splice(i, 1);
    m.queue!.row = q.rows - 1; m.queue!.seat = seat;
    return m;
  }

  private populateSignWalker() {
    // Open apron between the west ski rack and the ticket side of the lodge.
    const stops = [[-4.3, -0.8], [0.1, 3.5], [4.9, 6.9], [3.1, 11.6], [-3.6, 9.8], [-9.2, 3.6], [-7.6, -2.6]].map(([dx, dz]) => {
      const x = LODGE_SKI_START.x + dx, z = LODGE_SKI_START.z + dz;
      return { x, y: this.terrain(x, z), z };
    });
    if (!stops.every((a, i) => Number.isFinite(a.y) && this.nav.clear(a, stops[(i + 1) % stops.length], 0.78))) return;
    const [start, next] = stops;
    const heading = Math.atan2(start.x - next.x, start.z - next.z);
    const p = this.person('walker', { jacket: new THREE.Color(0xa5232c) }, start.x, start.y, start.z, heading, 'none', makeSignWalkerOutfit());
    p.model.root.name = LODGE_SIGN_WALKER;
    dressSignWalker(p.model.human);
    p.patrol = [...stops.slice(1), start];
    p.wait = 0;
  }

  private newDestination(p: Person) {
    if (p.patrol) {
      p.path = [...p.patrol]; p.lastD = Infinity; p.stuck = 0;
      return;
    }
    const start = this.nav.nearest(p.st.pos.x, p.st.pos.y, p.st.pos.z);
    if (!start) { p.wait = 5; return; }
    for (let tries = 0; tries < 6; tries++) {
      const dest = pick(this.destinations, this.r);
      if (dest.id === start.id || Math.hypot(dest.x - start.x, dest.z - start.z) > 260) continue;
      const path = this.nav.path(start, dest);
      if (path && path.length > 1) { p.path = path; p.dest = dest; p.lastD = Infinity; p.stuck = 0; return; }
    }
    p.wait = 4;
  }

  /** Skiers bump into people: a gentle push, a fall if they hit someone fast. */
  collidePlayer(st: SkierState) {
    let n = 0;
    for (const p of this.people) {
      if (p.kind === 'seated' || Math.abs(p.st.pos.y - st.pos.y) > 1.5) continue;
      if (Math.abs(p.st.pos.x - st.pos.x) > 1 || Math.abs(p.st.pos.z - st.pos.z) > 1) continue;
      if (collideCylinder(st, p.st.pos.x, p.st.pos.z, 0.28)) n++;
    }
    return n;
  }

  update(dt: number, camera: THREE.Vector3, playerLoadLift: number) {
    this.clock += dt; this.frameNo++;
    if (!this.built) { if (this.clock > 2.5) this.build(); return; }
    // Lift queues: 2.6 s before a chair carrying riders reaches the load line, the front row merges into
    // its seat lanes; when that chair passes the line, they are its riders.
    for (const q of this.queues) {
      const t = this.lifts.now(q.li);
      const lead = q.path.def.speed * 2.6;
      const merging = this.lifts.chairsPassing(q.li, (q.path.loadU - lead + q.path.loopLen) % q.path.loopLen, q.lastT, t);
      const passing = this.lifts.chairsPassing(q.li, q.path.loadU, q.lastT, t);
      q.lastT = t;
      for (const chair of merging) {
        if (playerLoadLift === q.li) continue; // the player has this chair; the crowd waits for the next
        const seats = this.lifts.riderSeats(q.li, chair);
        const front = q.members[0];
        const group: Person[] = [];
        for (const seat of seats) { const m = front?.[seat]; if (m?.queue) { m.queue.boarding = 1; m.queue.row = -1; group.push(m); front[seat] = null; } }
        if (group.length) q.boarding.set(chair, group);
        if (front && front.every((m) => !m)) {
          q.members.shift();
          q.members.push(Array.from({ length: q.seats }, () => null));
          q.members.forEach((row, ri) => row.forEach((m) => { if (m?.queue) m.queue.row = ri; }));
          // new arrivals glide into the back row: first whoever just skied down, then newcomers from the base
          const back = q.members[q.rows - 1];
          for (let seat = 0; seat < q.seats; seat++) {
            const known = this.admit(q, seat);
            if (known) { back[seat] = known; continue; }
            if (this.r() < 0.35) continue;
            const s = this.queueSpot(q, q.rows + 1.5, seat);
            if (!Number.isFinite(s.y)) continue;
            back[seat] = this.queuer(q, q.rows - 1, seat, s, makeGuest(this.r));
          }
        }
      }
      for (const chair of passing) {
        const group = q.boarding.get(chair);
        if (!group) continue;
        q.boarding.delete(chair);
        for (const m of group) {
          // the chair carries exactly these people up the mountain
          if (m.guest && m.queue) this.lifts.assignRider(q.li, chair, m.queue.seat, m.guest);
          m.model.root.visible = false; m.visible = false; this.people.splice(this.people.indexOf(m), 1); this.group.remove(m.model.root);
        }
      }
      // people who skied down fill any gap in the back row
      const back = q.members[q.rows - 1];
      if (back && q.arrivals.length) for (let seat = 0; seat < q.seats; seat++) if (!back[seat]) { const m = this.admit(q, seat); if (m) back[seat] = m; }
    }
    this.gear.begin();
    for (const p of this.people) {
      p.time += dt;
      const dx = p.st.pos.x - camera.x, dz = p.st.pos.z - camera.z, dist = Math.hypot(dx, dz);
      const indoorPerson = p.kind === 'seated' && !!walkable.surfaces.indoor(p.st.pos.x, p.st.pos.y + 0.9, p.st.pos.z);
      const camIn = walkable.surfaces.indoor(camera.x, camera.y, camera.z);
      // the day's crowd: guests beyond today's level have gone home (staff stay); lines empty when the lifts close
      const here = p.kind === 'staff' || p.model.root.name === LODGE_SIGN_WALKER || (p.presence < this.level && (p.kind !== 'queue' || this.open));
      const visible = here && dist < (indoorPerson ? (camIn ? 45 : 30) : 160);
      // movement continues off screen so the base stays consistent
      let inputX = 0, inputZ = 0, moving = false;
      if (p.kind === 'walker') {
        if (p.wait > 0) p.wait -= dt;
        else if (!p.path) this.newDestination(p);
        else {
          const next = p.path[0];
          const ddx = next.x - p.st.pos.x, ddz = next.z - p.st.pos.z, d = Math.hypot(ddx, ddz);
          if (d < (p.path.length > 1 ? 0.9 : 0.4)) {
            p.path.shift(); p.lastD = Infinity; p.stuck = 0;
            if (!p.path.length) { p.path = undefined; p.wait = p.patrol ? 1.5 : 4 + this.r() * 25; }
          } else {
            inputX = ddx / d; inputZ = ddz / d; moving = true;
            if (d < p.lastD - 0.05) { p.lastD = d; p.stuck = 0; } else if ((p.stuck += dt) > 3) { p.path = undefined; p.wait = 0.5; }
          }
        }
        if (dist < 220 || moving) stepWalker(p.st, { x: inputX, z: inputZ, run: false }, this.terrain, walkable.surfaces, this.colliders, dt);
        // skis stay in the racks outside; nobody carries them through the lodge
        p.skis = p.st.indoor ? 'none' : p.outdoorSkis;
      } else if (p.kind === 'queue' && p.queue && p.queue.seat < 0) {
        // skiing over from the bottom of a run, then waiting single file at the maze entrance
        const q = p.queue.q, k = q.arrivals.indexOf(p);
        const next = p.path?.length ? p.path[0] : this.entrance(q, Math.max(0, k));
        const ddx = next.x - p.st.pos.x, ddz = next.z - p.st.pos.z, d = Math.hypot(ddx, ddz);
        if (p.path?.length && d < 1.2) p.path.shift();
        else if (d > 0.15) {
          const v = Math.min(p.path?.length ? 2.6 : 1.0, d * 1.5);
          p.st.pos.x += ddx / d * v * dt; p.st.pos.z += ddz / d * v * dt;
          const y = this.terrain(p.st.pos.x, p.st.pos.z); if (Number.isFinite(y)) p.st.pos.y = y;
          p.st.speed = v; p.st.stride += v * dt / 0.4; moving = true;
          p.st.heading = Math.atan2(-ddx, -ddz);
        } else { p.st.speed = 0; p.st.heading = q.heading; }
      } else if (p.kind === 'queue' && p.queue) {
        const s = this.queueSpot(p.queue.q, p.queue.row, p.queue.seat);
        const ddx = s.x - p.st.pos.x, ddz = s.z - p.st.pos.z, d = Math.hypot(ddx, ddz);
        if (d > 0.12) { // shuffle forward on skis toward the next row, or step briskly into the lane
          const v = Math.min(p.queue.boarding ? 1.6 : 0.9, d * 1.5);
          p.st.pos.x += ddx / d * v * dt; p.st.pos.z += ddz / d * v * dt; p.st.pos.y = this.terrain(p.st.pos.x, p.st.pos.z);
          p.st.speed = v; p.st.stride += v * dt / 0.4; moving = true;
        } else p.st.speed = 0;
        p.st.heading = p.queue.q.heading;
      }
      p.visible = visible; p.model.root.visible = visible;
      if (p.operates) {
        // watch the incoming chairs; raise an arm as one with riders (or you) comes into the load line
        const q = p.operates, t = this.lifts.now(q.li), next = q.path.nextChairAt(q.path.loadU, t);
        const loaded = this.open && next.arrive - t < 3.2 && (this.lifts.riderSeats(q.li, next.index).length > 0 || playerLoadLift === q.li);
        p.signal! += ((loaded ? 1 : 0) - p.signal!) * Math.min(1, dt * 4);
        p.lookYaw = loaded ? 0.6 : p.lookYaw;
      }
      if (!visible) continue;
      // head turns: talk to neighbours, glance around
      if ((p.lookTimer -= dt) < 0) { p.lookTimer = 1.5 + this.r() * 5; p.lookYaw = (this.r() - 0.5) * (p.kind === 'group' || p.kind === 'seated' ? 1.4 : 0.8); }
      const throttle = dist > 60 ? 3 : dist > 25 ? 2 : 1;
      if ((this.frameNo + p.frame) % throttle === 0) {
        p.model.root.position.set(p.st.pos.x, p.st.pos.y, p.st.pos.z);
        p.model.root.rotation.set(0, p.st.heading, 0);
        const mode = p.kind === 'seated' ? 'sit' : (moving && p.st.speed > 0.1) ? 'walk' : 'stand';
        p.model.update({ mode, stride: p.st.stride, speed: p.st.speed, time: p.time, skis: p.skis, seat: p.seatH, handsOnTable: p.tableH, lookYaw: p.lookYaw * 0.6,
          gesture: p.signal ? { kind: 'signal', amount: p.signal } : undefined });
      }
      p.model.human.mesh.castShadow = dist < 45;
      if (dist < 110 && p.model.look.instancedGear) p.model.pushGear(this.gear, dist < 50);
    }
    this.gear.end();
  }

  /** People currently simulated (for tests). */
  stats() {
    const by: Record<string, number> = {};
    for (const p of this.people) by[p.kind] = (by[p.kind] ?? 0) + 1;
    return { built: this.built, nodes: this.nav.nodes.length, links: this.nav.nodes.reduce((a, n) => a + n.links.length, 0) / 2, destinations: this.destinations.length, people: by, visible: this.people.filter((p) => p.visible).length };
  }
}
