// In-game run statistics measured through the game's own heightfield (what the player skis on).
// Usage: npx tsx tests/harness/accuracy.ts  -> tests/harness/out/ingame_stats.json
import { writeFileSync, mkdirSync } from 'node:fs';
import { loadWorld, loadAreaForPath } from './world';

export async function ingameStats() {
  const { hf, resort } = await loadWorld();
  const out: Record<string, any> = {};
  const byName = new Map<string, typeof resort.runs>();
  for (const r of resort.runs) { if (!byName.has(r.name)) byName.set(r.name, []); byName.get(r.name)!.push(r); }
  for (const [name, ways] of byName) {
    let len3 = 0, lenH = 0, hiMax = -Infinity, loMin = Infinity, max10 = 0;
    for (const r of ways) {
      if (r.kind !== 'line') continue;
      await loadAreaForPath(hf, r.points, 20);
      const samples: { x: number; z: number; h: number }[] = [];
      for (let i = 0; i < r.points.length - 1; i++) {
        const a = r.points[i], b = r.points[i + 1];
        const d = Math.hypot(b[0] - a[0], b[2] - a[2]);
        const n = Math.max(1, Math.ceil(d));
        for (let k = 0; k < n; k++) {
          const x = a[0] + (b[0] - a[0]) * k / n, z = a[2] + (b[2] - a[2]) * k / n;
          samples.push({ x, z, h: hf.heightAt(x, z) });
        }
      }
      const last = r.points.at(-1)!;
      samples.push({ x: last[0], z: last[2], h: hf.heightAt(last[0], last[2]) });
      for (let i = 1; i < samples.length; i++) {
        const dh = Math.hypot(samples[i].x - samples[i - 1].x, samples[i].z - samples[i - 1].z);
        lenH += dh; len3 += Math.hypot(dh, samples[i].h - samples[i - 1].h);
      }
      for (const s of samples) { hiMax = Math.max(hiMax, s.h); loMin = Math.min(loMin, s.h); }
      // steepest 10 m pitch along the centerline
      let acc = 0, j = 0;
      for (let i = 1; i < samples.length; i++) {
        acc += Math.hypot(samples[i].x - samples[i - 1].x, samples[i].z - samples[i - 1].z);
        while (acc > 10 && j < i) {
          acc -= Math.hypot(samples[j + 1].x - samples[j].x, samples[j + 1].z - samples[j].z); j++;
        }
        if (acc >= 9) max10 = Math.max(max10, Math.atan(Math.abs(samples[i].h - samples[j].h) / acc) * 180 / Math.PI);
      }
    }
    if (lenH === 0) continue;
    const drop = hiMax - loMin;
    out[name] = {
      difficulty: ways[0].difficulty, lengthM: Math.round(len3), horizM: Math.round(lenH), top: Math.round(hiMax), bottom: Math.round(loMin),
      dropM: Math.round(drop), avgDeg: +((Math.atan(drop / lenH) * 180) / Math.PI).toFixed(1), maxCenterline10mDeg: +max10.toFixed(1),
    };
  }
  return out;
}

if (process.argv[1]?.endsWith('accuracy.ts')) {
  ingameStats().then((o) => {
    mkdirSync('tests/harness/out', { recursive: true });
    writeFileSync('tests/harness/out/ingame_stats.json', JSON.stringify(o, null, 1));
    console.log(Object.keys(o).length, 'runs');
  });
}
