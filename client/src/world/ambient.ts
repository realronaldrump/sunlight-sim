// Ambient skiers using the same physics and bot logic as the test harness. They come from the lifts:
// whenever a chair carrying riders reaches the unload line, its riders ski off the ramp and down a run
// that starts near that lift's top, chosen to suit their ability. At the bottom they head back into the
// lift lines (handled by baseLife.ts). A few more start mid-run near the player so slopes are never empty.
import * as THREE from 'three/webgpu';
import { createSkier, stepSkier, SkierState, TerrainProbe, headingFromDir } from '../../../shared/skiPhysics';
import { SkiBot, PERSONAS, Persona } from '../../../shared/skiBot';
import { SkierModel } from '../skier/skierModel';
import { orientSkier } from '../skier/orientation';
import type { RunInfo } from '../game';
import type { LiftSystem } from '../lifts/liftSystem';
import { makeGuest, type Guest } from './guests';

interface Agent { st: SkierState; bot: SkiBot; model: SkierModel; time: number; run: string; fromLift: boolean; guest: Guest }

export class AmbientSkiers {
  readonly group = new THREE.Group();
  private agents: Agent[] = [];
  private spare: SkierModel[] = [];
  private runs: RunInfo[];
  private lastLiftT: number[] = [];
  /** A skier finished their run at the bottom. Return true when the base area takes them (into a lift line). */
  onFinish: ((guest: Guest, st: SkierState) => boolean) | null = null;
  /** Share of the usual number of skiers on the hill (Resort Day: quiet early, busy midday, none after the sweep). */
  level = 1;

  constructor(runs: RunInfo[], private probe: TerrainProbe, private count = 8, private lifts: LiftSystem | null = null) {
    this.group.name = 'ambient-skiers';
    this.runs = runs.filter((r) => r.kind === 'line' && ['green', 'blue', 'black'].includes(r.difficulty) && r.points.length > 3);
  }

  /** Skiers on the snow right now (for their tracks and wear). */
  skiers() { return this.agents.map((a) => ({ id: a.guest.id, st: a.st })); }

  /** Read-only contacts for spatial pass-by sound; uses the same state as the visible skiers. */
  soundSources() {
    return this.agents.map(a => ({ pos: a.st.pos, speed: a.st.speed, skid: a.st.skid,
      groomed: this.probe.surface(a.st.pos.x, a.st.pos.z).groomed,
      active: a.st.grounded && a.st.mode !== 'riding' && a.st.mode !== 'air' }));
  }

  private model(guest: Guest) {
    let m = this.spare.pop();
    if (m) m.root.visible = true;
    else { m = new SkierModel(new THREE.Color(guest.look.jacket), 'crowd'); this.group.add(m.root); }
    m.dress(guest.look);
    return m;
  }

  private release(a: Agent) { a.model.root.visible = false; this.spare.push(a.model); }

  /** A guest skis to their own ability: beginners stay on greens where they can, nobody below intermediate on a black. */
  private persona(difficulty: string, guest: Guest): Persona {
    if (difficulty === 'black') return 'intermediate';
    return guest.persona;
  }

  private suits(run: RunInfo, guest: Guest) {
    return guest.persona === 'beginner' ? run.difficulty === 'green' : run.difficulty !== 'black' || Math.random() < 0.35;
  }

  /** Densify a run centerline into bot waypoints with a little personal line choice. */
  private waypoints(points: number[][], from = 0) {
    const path: { x: number; z: number }[] = [];
    const wander = (Math.random() - 0.5) * 8;
    for (let i = from; i < points.length - 1; i++) {
      const a = points[i], b = points[i + 1];
      const n = Math.max(1, Math.ceil(Math.hypot(b[0] - a[0], b[2] - a[2]) / 4));
      const L = Math.hypot(b[0] - a[0], b[2] - a[2]) || 1, nx = -(b[2] - a[2]) / L, nz = (b[0] - a[0]) / L;
      for (let k = 0; k < n; k++) {
        const t = k / n, w = wander + Math.sin((i + t) * 0.7) * 2;
        path.push({ x: a[0] + (b[0] - a[0]) * t + nx * w, z: a[2] + (b[2] - a[2]) * t + nz * w });
      }
    }
    return path;
  }

  private agent(path: { x: number; z: number }[], run: RunInfo, fromLift: boolean, guest: Guest, heading?: number): Agent | null {
    if (path.length < 4) return null;
    const persona = this.persona(run.difficulty, guest);
    const cfg = { ...PERSONAS[persona], targetSpeed: PERSONAS[persona].targetSpeed * (0.8 + Math.random() * 0.4) };
    const p0 = path[0];
    const st = createSkier({ x: p0.x, y: this.probe.height(p0.x, p0.z), z: p0.z }, heading ?? headingFromDir(path[3].x - p0.x, path[3].z - p0.z));
    return { st, bot: new SkiBot(path, cfg), model: this.model(guest), time: Math.random() * 10, run: run.name, fromLift, guest };
  }

  /** Riders leaving a chair at the unload line ski off the ramp onto a run that starts near that lift top. */
  private fromLiftTop(li: number, chair: number, seat: number) {
    const path = this.lifts!.paths[li], up = path.unloadPoint(seat);
    // the person who rode this seat stands up and skis away
    const guest = this.lifts!.takeRider(li, chair, seat);
    const near = this.runs.filter((r) => Math.hypot(r.points[0][0] - up.x, r.points[0][2] - up.z) < 260);
    if (!near.length) return null;
    const fits = near.filter((r) => this.suits(r, guest));
    const pool = fits.length ? fits : near;
    const run = pool[Math.floor(Math.random() * pool.length)];
    // straight off the unload ramp, peel away to the side, then join the run's line
    const fx = -Math.sin(up.heading), fz = -Math.cos(up.heading), side = seat < (path.def.seats - 1) / 2 ? -1 : 1;
    const lead = [{ x: up.x, z: up.z }, { x: up.x + fx * 5, z: up.z + fz * 5 }, { x: up.x + fx * 10 - fz * side * 6, z: up.z + fz * 10 + fx * side * 6 }];
    const pts = this.waypoints(run.points);
    return this.agent([...lead, ...pts], run, true, guest, up.heading);
  }

  private onSlopeNear(near: THREE.Vector3) {
    const cands = this.runs.filter((r) => r.points.some((p) => Math.hypot(p[0] - near.x, p[2] - near.z) < 700));
    const pool = cands.length ? cands : this.runs;
    const run = pool[Math.floor(Math.random() * pool.length)];
    // start a little above the point of the run nearest the player, so they ski past
    let nearest = 0, best = Infinity;
    run.points.forEach((p, i) => { const d = Math.hypot(p[0] - near.x, p[2] - near.z); if (d < best) { best = d; nearest = i; } });
    const from = Math.max(0, Math.min(run.points.length - 4, nearest - 1 - Math.floor(Math.random() * 3)));
    return this.agent(this.waypoints(run.points, from), run, false, makeGuest(Math.random));
  }

  update(dt: number, player: THREE.Vector3, camera: THREE.Vector3) {
    if (this.lifts) {
      {
        this.lifts.paths.forEach((path, li) => {
          const t = this.lifts!.now(li), previous = this.lastLiftT[li] ?? t;
          this.lastLiftT[li] = t;
          const top = path.unloadPoint();
          if (Math.hypot(top.x - player.x, top.z - player.z) > 1600) return;
          for (const chair of this.lifts!.chairsPassing(li, path.unloadU, previous, t)) {
            for (const seat of this.lifts!.riderSeats(li, chair)) {
              if (this.agents.length >= Math.round(this.count * this.level)) return;
              const a = this.fromLiftTop(li, chair, seat);
              if (a) this.agents.push(a);
            }
          }
        });
      }
    }
    // half the budget belongs to riders arriving off the lifts; the rest keep the slopes near the player busy
    const budget = Math.round(this.count * this.level);
    while (this.agents.filter((a) => !a.fromLift).length < Math.ceil(budget / 2) && this.agents.length < budget) {
      const a = this.onSlopeNear(player);
      if (!a) break;
      this.agents.push(a);
    }
    for (let i = this.agents.length - 1; i >= 0; i--) {
      const a = this.agents[i];
      a.time += dt;
      const inp = a.bot.input(a.st, dt);
      stepSkier(a.st, inp, this.probe, dt);
      if (a.st.mode === 'fallen' && a.st.speed < 0.5 && a.st.modeTime > 2.5) { a.st.mode = 'standing'; }
      const far = Math.hypot(a.st.pos.x - player.x, a.st.pos.z - player.z) > 1700;
      if (a.bot.done && !far) this.onFinish?.(a.guest, a.st);
      if (a.bot.done || far || a.time > 900) { this.release(a); this.agents.splice(i, 1); continue; }
      const dCam = Math.hypot(a.st.pos.x - camera.x, a.st.pos.z - camera.z);
      a.model.root.visible = dCam < 400;
      if (!a.model.root.visible) continue;
      a.model.root.position.set(a.st.pos.x, a.st.pos.y, a.st.pos.z);
      orientSkier(a.model.root, a.st.heading, a.st.normal);
      a.model.update({ speed: a.st.speed, edge: a.st.edge, plow: a.st.plow, tuck: a.st.tuck, skid: a.st.skid, fallen: a.st.mode === 'fallen' ? 1 : 0, sitting: 0, time: a.time, pushing: inp.push && a.st.speed < 3 });
    }
  }
}
