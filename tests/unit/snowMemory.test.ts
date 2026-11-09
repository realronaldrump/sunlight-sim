import { describe, expect, it } from 'vitest';
import * as THREE from 'three/webgpu';
import { SnowState, SNOW_KEY } from '../../client/src/terrain/snowState';
import { SnowMemory } from '../../client/src/terrain/snowMemory';
import { SkiTracks } from '../../client/src/skier/tracks';
import { dayNumber, overnightSnow } from '../../client/src/world/conditions';

class MemoryStorage { m = new Map<string, string>(); getItem(k: string) { return this.m.get(k) ?? null; } setItem(k: string, v: string) { this.m.set(k, v); } removeItem(k: string) { this.m.delete(k); } clear() { this.m.clear(); } key() { return null; } get length() { return this.m.size; } }

const runs = [
  { id: 1, name: 'Groomer', difficulty: 'green', grooming: 'groomed', kind: 'line', points: [[0, 2600, 0], [0, 2500, -400]] },
  { id: 2, name: 'Glade', difficulty: 'black', grooming: 'moguls', kind: 'line', points: [[200, 2600, 0], [200, 2500, -400]] },
];
const lifts: { bottom: number[]; top: number[] }[] = [];
// groomed only on the left run
const surface = { at: (x: number) => ({ groomed: x < 100 ? 1 : 0, piste: 1, moguls: 0 }) } as any;

function lay(tracks: SkiTracks, x: number, z0: number, n = 20) {
  const dir = new THREE.Vector3(0, 0, -1);
  for (let i = 0; i < n; i++) {
    const z = z0 - i;
    tracks.add(new THREE.Vector3(x - 0.15, 2550, z), new THREE.Vector3(x + 0.15, 2550, z), dir, 0.2, 1.2);
  }
}

describe('snow memory', () => {
  it('wears busy lines, grooms them back and hides wear under new snow', () => {
    const s = new SnowState(runs as any, lifts);
    // a normal day's traffic makes the centre of the groomed run worn by afternoon, not at opening
    expect(s.wornAt(0, -200, 0)).toBe(0);
    expect(s.wornAt(0, -200, 6)).toBeGreaterThan(0.6);
    expect(s.wornAt(40, -200, 6)).toBeLessThan(0.05); // the edges of the line stay soft
    for (let i = 0; i < 40; i++) s.deposit(60, -100, 0.02);
    expect(s.wornAt(60, -100, 0)).toBeGreaterThan(0.6);
    s.groom(0, -200, 3);
    expect(s.wornAt(0, -200, 6)).toBe(0); // the groomer has been: fresh corduroy until tomorrow's traffic
    s.snowfall(4);
    expect(s.freshCover).toBeGreaterThan(0.7);
    expect(s.wornAt(60, -100, 0)).toBeLessThan(0.2);
    const saved = s.serialize();
    const t = new SnowState(runs as any, lifts);
    expect(t.restore(saved)).toBe(true);
    expect(t.wornAt(60, -100, 0)).toBeCloseTo(s.wornAt(60, -100, 0), 2);
    expect(t.wornAt(0, -200, 6)).toBe(0);
  });

  it('keeps tracks across a reload the same day, and grooms or snows them away overnight', () => {
    const storage = new MemoryStorage() as unknown as Storage;
    const now = Date.UTC(2027, 0, 12, 19) / 1000; // noon in Colorado
    const make = () => ({ state: new SnowState(runs as any, lifts), tracks: new SkiTracks(undefined, { max: 500, life: 3600 }), crowd: new SkiTracks(undefined, { max: 500, spray: false }) });
    const a = make();
    const ma = new SnowMemory(a.state, a.tracks, a.crowd, surface, storage);
    ma.load(now);
    lay(a.tracks, 0, -50);   // on the groomer
    lay(a.tracks, 200, -50); // in the glade
    expect(a.tracks.segments).toBe(38);
    ma.save(now);
    expect(storage.getItem(SNOW_KEY)).toBeTruthy();

    // later the same day
    const b = make();
    const note = new SnowMemory(b.state, b.tracks, b.crowd, surface, storage).load(now + 3600);
    expect(b.tracks.segments).toBe(38);
    expect(note).toBeNull(); // too few to mention
    // grooves come back where they were, to the millimetre
    const before = a.tracks.serialize(), after = b.tracks.serialize();
    expect(after.length).toBe(before.length);
    for (let i = 0; i < before.length; i++) expect(Math.abs(after[i] - before[i])).toBeLessThan(0.002);

    // the next morning: the groomed run's tracks are gone, the glade's remain (maybe under new snow)
    const c = make();
    const next = now + 86400;
    const msg = new SnowMemory(c.state, c.tracks, c.crowd, surface, storage).load(next);
    expect(c.tracks.segments).toBe(19);
    expect(msg).toMatch(/Overnight/);
    const snow = overnightSnow(dayNumber(next));
    expect(c.state.freshInches).toBe(snow);
    if (snow) expect(msg).toMatch(/new snow/);
  });
});
