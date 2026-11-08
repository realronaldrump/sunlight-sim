// Ambient skiers: a handful of AI skiers using the same physics and bot logic as the test harness,
// skiing runs near the player so the mountain feels alive. Hidden when far from the camera.
import * as THREE from 'three/webgpu';
import { createSkier, stepSkier, SkierState, TerrainProbe, headingFromDir } from '../../../shared/skiPhysics';
import { SkiBot, PERSONAS, Persona } from '../../../shared/skiBot';
import { SkierModel } from '../skier/skierModel';
import type { RunInfo } from '../game';

const COLORS = ['#1f6fd1', '#f2b705', '#2e9e44', '#7b3fbf', '#ff6f91', '#111111', '#1aa3a3', '#e86a1a', '#f5f5f5', '#8b1e3f'];

interface Agent { st: SkierState; bot: SkiBot; model: SkierModel; time: number; run: string }

export class AmbientSkiers {
  readonly group = new THREE.Group();
  private agents: Agent[] = [];
  private runs: RunInfo[];

  constructor(runs: RunInfo[], private probe: TerrainProbe, private count = 8) {
    this.group.name = 'ambient-skiers';
    // greens and blues mostly (where beginners and intermediates are)
    this.runs = runs.filter((r) => r.kind === 'line' && ['green', 'blue', 'black'].includes(r.difficulty) && r.points.length > 3);
  }

  private spawn(near: THREE.Vector3, agent?: Agent): Agent | null {
    const cands = this.runs.filter((r) => {
      const p = r.points[0];
      return Math.hypot(p[0] - near.x, p[2] - near.z) < 900;
    });
    const pool = cands.length ? cands : this.runs;
    const run = pool[Math.floor(Math.random() * pool.length)];
    const path: { x: number; z: number }[] = [];
    for (let i = 0; i < run.points.length - 1; i++) {
      const a = run.points[i], b = run.points[i + 1];
      const n = Math.max(1, Math.ceil(Math.hypot(b[0] - a[0], b[2] - a[2]) / 4));
      for (let k = 0; k < n; k++) path.push({ x: a[0] + (b[0] - a[0]) * k / n + (Math.random() - 0.5) * 6, z: a[2] + (b[2] - a[2]) * k / n + (Math.random() - 0.5) * 6 });
    }
    if (path.length < 4) return null;
    const persona: Persona = run.difficulty === 'green' ? (Math.random() < 0.6 ? 'beginner' : 'intermediate') : Math.random() < 0.8 ? 'intermediate' : 'beginner';
    const cfg = { ...PERSONAS[persona], targetSpeed: PERSONAS[persona].targetSpeed * (0.8 + Math.random() * 0.4) };
    const p0 = path[0];
    const st = createSkier({ x: p0.x, y: this.probe.height(p0.x, p0.z), z: p0.z }, headingFromDir(path[3].x - p0.x, path[3].z - p0.z));
    const model = agent?.model ?? new SkierModel(new THREE.Color(COLORS[Math.floor(Math.random() * COLORS.length)]));
    if (!agent) this.group.add(model.root);
    return { st, bot: new SkiBot(path, cfg), model, time: Math.random() * 10, run: run.name };
  }

  update(dt: number, player: THREE.Vector3, camera: THREE.Vector3) {
    while (this.agents.length < this.count) {
      const a = this.spawn(player);
      if (!a) break;
      // stagger: advance new agents a random distance down their run
      this.agents.push(a);
    }
    for (let i = 0; i < this.agents.length; i++) {
      const a = this.agents[i];
      a.time += dt;
      const inp = a.bot.input(a.st, dt);
      stepSkier(a.st, inp, this.probe, dt);
      if (a.st.mode === 'fallen' && a.st.speed < 0.5) { a.st.mode = 'standing'; }
      const far = Math.hypot(a.st.pos.x - player.x, a.st.pos.z - player.z) > 1400;
      if (a.bot.done || far || a.time > 900) {
        const n = this.spawn(player, a);
        if (n) this.agents[i] = n;
        continue;
      }
      const dCam = Math.hypot(a.st.pos.x - camera.x, a.st.pos.z - camera.z);
      a.model.root.visible = dCam < 350;
      if (!a.model.root.visible) continue;
      a.model.root.position.set(a.st.pos.x, a.st.pos.y, a.st.pos.z);
      a.model.root.rotation.set(0, a.st.heading, 0);
      a.model.update({ speed: a.st.speed, edge: a.st.edge, plow: a.st.plow, tuck: a.st.tuck, skid: a.st.skid, fallen: a.st.mode === 'fallen' ? 1 : 0, sitting: 0, time: a.time, pushing: inp.push && a.st.speed < 3 });
    }
  }
}
