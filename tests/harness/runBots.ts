// Physics test harness: scripted skiers descend runs and log speed and path statistics.
// Usage: npx tsx tests/harness/runBots.ts [runName ...]
import { writeFileSync, mkdirSync } from 'node:fs';
import { loadWorld, makeProbe, loadAreaForPath } from './world';
import { createSkier, stepSkier, headingFromDir, SkierState } from '../../shared/skiPhysics';
import { SkiBot, PERSONAS, Persona } from '../../shared/skiBot';

export interface BotResult {
  run: string; difficulty: string; persona: Persona; finished: boolean; falls: number; nudges: number; time: number;
  distance: number; avgKmh: number; maxKmh: number; p90Kmh: number; maxSlope: number;
}

export async function simulateRun(world: Awaited<ReturnType<typeof loadWorld>>, runName: string, persona: Persona, maxTime = 1800): Promise<BotResult> {
  const { hf, resort, surface } = world;
  const ways = resort.runs.filter((r) => r.name === runName && r.kind === 'line');
  if (!ways.length) throw new Error('no line run ' + runName);
  // use the longest way of that name
  const run = ways.sort((a, b) => b.points.length - a.points.length)[0];
  await loadAreaForPath(hf, run.points);
  // densify path
  const path: { x: number; z: number }[] = [];
  for (let i = 0; i < run.points.length - 1; i++) {
    const a = run.points[i], b = run.points[i + 1];
    const d = Math.hypot(b[0] - a[0], b[2] - a[2]);
    const n = Math.max(1, Math.ceil(d / 4));
    for (let k = 0; k < n; k++) path.push({ x: a[0] + (b[0] - a[0]) * k / n, z: a[2] + (b[2] - a[2]) * k / n });
  }
  path.push({ x: run.points.at(-1)![0], z: run.points.at(-1)![2] });
  const probe = makeProbe(hf, surface);
  const p0 = path[0];
  const st: SkierState = createSkier({ x: p0.x, y: hf.heightAt(p0.x, p0.z), z: p0.z }, headingFromDir(path[3].x - p0.x, path[3].z - p0.z));
  const bot = new SkiBot(path, PERSONAS[persona]);
  const dt = 1 / 60;
  let t = 0, dist = 0, falls = 0, maxV = 0, maxSlope = 0;
  const speeds: number[] = [];
  let lastFall = false;
  let stuck = 0, nudges = 0;
  while (t < maxTime && !bot.done) {
    const inp = bot.input(st, dt);
    const px = st.pos.x, pz = st.pos.z;
    stepSkier(st, inp, probe, dt);
    if (st.mode === 'fallen' && !lastFall) falls++;
    lastFall = st.mode === 'fallen';
    if (st.mode === 'fallen' && st.speed < 0.5) { st.mode = 'standing'; st.vel = { x: 0, y: 0, z: 0 }; }
    dist += Math.hypot(st.pos.x - px, st.pos.z - pz);
    // harness only: the summer DEM has road-cut banks across some centerlines; nudge stuck bots forward
    stuck = st.speed < 0.3 ? stuck + dt : 0;
    if (stuck > 15) {
      const i = Math.min(path.length - 1, (bot as unknown as { idx: number }).idx + 5);
      st.pos.x = path[i].x; st.pos.z = path[i].z; st.pos.y = hf.heightAt(path[i].x, path[i].z);
      (bot as unknown as { idx: number }).idx = i; stuck = 0; nudges++;
    }
    speeds.push(st.speed);
    maxV = Math.max(maxV, st.speed);
    maxSlope = Math.max(maxSlope, st.slopeDeg);
    t += dt;
  }
  const moving = speeds.filter((s) => s > 0.5).sort((a, b) => a - b);
  const avg = moving.reduce((a, b) => a + b, 0) / Math.max(1, moving.length);
  return {
    run: runName, difficulty: run.difficulty, persona, finished: bot.done, falls, nudges, time: Math.round(t), distance: Math.round(dist),
    avgKmh: +(avg * 3.6).toFixed(1), maxKmh: +(maxV * 3.6).toFixed(1),
    p90Kmh: +((moving[Math.floor(moving.length * 0.9)] ?? 0) * 3.6).toFixed(1), maxSlope: +maxSlope.toFixed(1),
  };
}

async function main() {
  const world = await loadWorld();
  const names = process.argv.slice(2);
  const runs = names.length ? names : ['Ute', 'Midway', 'Grizzly Road', 'Sun King', 'Beaujolais', 'Rebel', 'Primo', 'The Heathen'];
  const results: BotResult[] = [];
  for (const r of runs) {
    for (const p of ['beginner', 'intermediate', 'racer'] as Persona[]) {
      try {
        const res = await simulateRun(world, r, p);
        results.push(res);
        console.log(JSON.stringify(res));
      } catch (e) { console.log('skip', r, (e as Error).message); }
    }
  }
  mkdirSync('tests/harness/out', { recursive: true });
  writeFileSync('tests/harness/out/bot_results.json', JSON.stringify(results, null, 1));
}

if (process.argv[1]?.endsWith('runBots.ts')) main();
