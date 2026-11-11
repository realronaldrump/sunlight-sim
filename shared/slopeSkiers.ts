// Room-owned slope guests. Unlike browser-local crowd decoration these skiers can be hit by anyone.
import { createSkier, getUp, headingFromDir, stepSkier, type SkierState, type TerrainProbe, type Vec3 } from './skiPhysics';
import { SkiBot, PERSONAS } from './skiBot';
import type { GuestRun } from './mountainGuestNavigation';
import type { ColliderGrid } from './collision';
import { snowballKnockdown, type SnowballActor, type SnowballFall, type SnowballHit } from './snowballs';

export interface SlopeSkier {
  id: number; st: SkierState; jacket: number; skin: number[]; hatColor: number; snowballFall?: SnowballFall;
}
interface Agent extends SlopeSkier { bot: SkiBot; age: number }
const jackets = [0x1d2a44, 0xb3262e, 0x1f6f78, 0xd8642a, 0x55306f, 0xc9a227, 0x2e9e44];

export class SlopeSkiers {
  readonly agents: Agent[] = [];
  private next = 1;
  private seed: number;
  private runs: GuestRun[];
  constructor(runs: GuestRun[], private probe: TerrainProbe, private colliders: ColliderGrid, seed: number) {
    this.seed = seed >>> 0 || 1;
    this.runs = runs.filter(r => r.kind === 'line' && ['green', 'blue', 'black'].includes(r.difficulty) && r.points.length >= 4);
  }
  private random() { this.seed = (Math.imul(this.seed, 1664525) + 1013904223) >>> 0; return this.seed / 4294967296; }

  private spawn(viewers: readonly Vec3[]) {
    const near = viewers[this.agents.length % viewers.length];
    const choices: { run: GuestRun; i: number; d: number }[] = [];
    for (const run of this.runs) for (let i = 0; i < run.points.length - 3; i++) {
      const p = run.points[i], d = Math.hypot(p[0] - near.x, p[2] - near.z);
      if (d < 550) choices.push({ run, i, d });
    }
    choices.sort((a, b) => a.d - b.d);
    const choice = choices[Math.floor(this.random() * Math.min(12, choices.length))];
    if (!choice) return false;
    const path: { x: number; z: number }[] = [], lateral = (this.random() - .5) * 7;
    for (let i = choice.i; i < choice.run.points.length - 1; i++) {
      const a = choice.run.points[i], b = choice.run.points[i + 1], len = Math.hypot(b[0] - a[0], b[2] - a[2]) || 1;
      for (let j = 0, n = Math.ceil(len / 4); j < n; j++) {
        const k = j / n, x = a[0] + (b[0] - a[0]) * k - (b[2] - a[2]) / len * lateral;
        const z = a[2] + (b[2] - a[2]) * k + (b[0] - a[0]) / len * lateral;
        path.push({ x, z });
      }
    }
    if (path.length < 4) return false;
    const p = path[0];
    if (this.colliders.query(p.x, p.z).some(c => c.top > this.probe.height(p.x, p.z) + .2 &&
        Math.hypot(c.x - p.x, c.z - p.z) < (c.r ?? Math.hypot(c.hx!, c.hz!)) + 1)) return false;
    const st = createSkier({ x: p.x, y: this.probe.height(p.x, p.z), z: p.z }, headingFromDir(path[3].x - p.x, path[3].z - p.z));
    const cfg = choice.run.difficulty === 'black' ? PERSONAS.intermediate : PERSONAS.beginner;
    this.agents.push({ id: this.next++, st, jacket: jackets[Math.floor(this.random() * jackets.length)], skin: [1, .91, .82],
      hatColor: this.random() < .5 ? 0xf2f2f0 : 0x1a1a1c, bot: new SkiBot(path, { ...cfg }), age: 0 });
    return true;
  }

  advance(dt: number, viewers: readonly Vec3[]) {
    if (!viewers.length) return;
    for (let i = this.agents.length - 1; i >= 0; i--) {
      const a = this.agents[i]; a.age += dt;
      for (let t = 0; t < Math.min(.25, dt); t += 1 / 60) {
        const step = Math.min(1 / 60, dt - t);
        if (a.st.mode === 'fallen' && a.st.modeTime > 3) getUp(a.st);
        stepSkier(a.st, a.bot.input(a.st, step), this.probe, step);
        this.colliders.collide(a.st);
      }
      if (a.snowballFall && a.st.mode !== 'fallen' && a.st.mode !== 'gettingUp') a.snowballFall = undefined;
      if (a.age > 900 || (a.bot.done && !a.snowballFall) || viewers.every(p => Math.hypot(p.x - a.st.pos.x, p.z - a.st.pos.z) > 900)) this.agents.splice(i, 1);
    }
    const budget = Math.min(16, Math.max(6, viewers.length * 4));
    for (let attempts = 0; this.agents.length < budget && attempts < 12; attempts++) this.spawn(viewers);
  }
  actors(): SnowballActor[] { return this.agents.map(a => ({ id: `npc/${a.id}`, name: 'Skier', kind: 'npc', pos: a.st.pos, vel: a.st.vel,
    heading: a.st.heading, active: a.st.grounded && ['skiing', 'standing'].includes(a.st.mode) })); }
  hit(hit: SnowballHit) {
    const a = this.agents.find(a => `npc/${a.id}` === hit.target);
    if (a) { snowballKnockdown(a.st, hit); a.snowballFall = { at: hit.at, seed: hit.seed }; }
  }
  snapshot(): SlopeSkier[] { return this.agents.map(({ id, st, jacket, skin, hatColor, snowballFall }) => ({ id, st, jacket, skin, hatColor, snowballFall })); }
}
