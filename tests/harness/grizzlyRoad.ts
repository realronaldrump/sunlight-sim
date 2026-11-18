// Sample by distance along the playable ski line, including both sides of the summit dip.
import { loadAreaForPath, loadWorld } from './world';

export async function sampleGrizzlyOpening(world: Awaited<ReturnType<typeof loadWorld>>) {
  const road = world.resort.runs.find(r => r.name === 'Grizzly Road')!;
  const samples: { x: number; z: number; height: number }[] = [];
  let along = 0;
  for (let i = 1; i < road.points.length && samples.length <= 400; i++) {
    const a = road.points[i - 1], b = road.points[i];
    const dx = b[0] - a[0], dz = b[2] - a[2], length = Math.hypot(dx, dz);
    await loadAreaForPath(world.hf, [a, b], 10);
    while (samples.length <= 400 && samples.length < along + length) {
      const t = (samples.length - along) / length;
      const x = a[0] + t * dx, z = a[2] + t * dz;
      if (world.hf.bestLevel(x, -z) !== 0) throw new Error('Missing 1 m tile on Grizzly Road');
      samples.push({ x, z, height: world.hf.heightAt(x, z) });
    }
    along += length;
  }
  return samples;
}

if (process.argv[1]?.endsWith('/grizzlyRoad.ts')) {
  console.log(JSON.stringify(await sampleGrizzlyOpening(await loadWorld())));
}
