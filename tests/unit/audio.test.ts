import { describe, expect, it } from 'vitest';
import { snowWindMix, sourcePan, terminalMix, nearbySkierMix, type AudioState } from '../../client/src/audio/audioModel';
import { AudioScene } from '../../client/src/audio/audioScene';
import { createSkier } from '../../shared/skiPhysics';
import { LiftPath, type LiftDef } from '../../shared/lifts';

const quiet: AudioState = { speed: 0, skid: 0, edge: 0, grounded: true, groomed: 1,
  moguls: 0, plow: 0, riding: false, nearTerminal: Infinity, towerPass: false, fell: false, inAir: false };
const snow = (s: AudioState) => { const m = snowWindMix(s, 4); return m.glide+m.edge+m.scrape+m.powder+m.slide+m.grain; };

describe('physical sound controls', () => {
  it('leaves stopped skis silent even with brake and steering inputs held', () => {
    expect(snow({ ...quiet, plow: 1, skid: 1, edge: .8 })).toBe(0);
    expect(snow({ ...quiet, speed: 5 })).toBeGreaterThan(0);
  });
  it('removes every snow layer in midair and on a chair, while retaining airflow', () => {
    for (const change of [{ inAir: true }, { grounded: false }, { riding: true }]) {
      const s = { ...quiet, speed: 15, skid: .8, edge: .7, ...change };
      expect(snow(s)).toBe(0);
      expect(snowWindMix(s, 4).wind).toBeGreaterThan(0);
    }
  });
  it('separates edged hard snow, braking scrape and soft snow displacement', () => {
    const carving = snowWindMix({ ...quiet, speed: 10, edge: .7 }, 4);
    const braking = snowWindMix({ ...quiet, speed: 10, edge: .7, skid: 1, plow: 1 }, 4);
    const powder = snowWindMix({ ...quiet, speed: 10, edge: .7, groomed: 0 }, 4);
    expect(braking.scrape).toBeGreaterThan(carving.scrape+.2);
    expect(carving.edge).toBeGreaterThan(braking.edge);
    expect(powder.edge).toBe(0);
    expect(powder.powder).toBeGreaterThan(.2);
    expect(carving.powder).toBe(0);
    expect(snowWindMix({ ...quiet, speed: 10, groomed: .501 }, 4).powder)
      .toBeCloseTo(snowWindMix({ ...quiet, speed: 10, groomed: .499 }, 4).powder, 2);
  });
  it('keeps freefall wind and reduces helmet turbulence in a tuck', () => {
    const upright = snowWindMix({ ...quiet, speed: 22 }, 1);
    expect(snowWindMix({ ...quiet, speed: 22, inAir: true }, 1).wind).toBe(upright.wind);
    expect(snowWindMix({ ...quiet, speed: 22, tuck: 1 }, 1).wind).toBeLessThan(upright.wind);
    expect(snowWindMix({ ...quiet, speed: 30 }, 1).wind).toBeGreaterThan(upright.wind);
    for (const v of Object.values(snowWindMix({ ...quiet, speed: Infinity, groomed: -1, skid: 12 }, 1))) expect(Number.isFinite(v)).toBe(true);
  });
  it('places machinery relative to view direction and absorbs highs with distance', () => {
    const ear = { x: 0, y: 1.6, z: 0 }, east = { x: 8, y: 3, z: 0 };
    expect(sourcePan(ear, { x: 0, y: 0, z: -1 }, east)).toBeGreaterThan(.8);
    expect(sourcePan(ear, { x: 0, y: 0, z: 1 }, east)).toBeLessThan(-.8);
    expect(sourcePan(ear, { x: 1, y: 0, z: 0 }, east)).toBe(0);
    const a = terminalMix(5), b = terminalMix(45), c = terminalMix(100);
    expect(a.gain).toBeGreaterThan(b.gain*4);
    expect(b.gain).toBeGreaterThan(c.gain);
    expect(b.cutoff).toBeLessThan(a.cutoff);
    expect(terminalMix(150).gain).toBe(0);
    expect(terminalMix(Infinity).gain).toBe(0);
  });
  it('makes nearby skiers audible only with moving snow contact, falling away with distance', () => {
    const p = { active: true, distance: 3, pan: 0, speed: 12, skid: .3, groomed: 1 };
    expect(nearbySkierMix(p).gain).toBeGreaterThan(.1);
    expect(nearbySkierMix({ ...p, speed: 0 }).gain).toBe(0);
    expect(nearbySkierMix({ ...p, active: false }).gain).toBe(0);
    expect(nearbySkierMix({ ...p, distance: 51 }).gain).toBe(0);
    expect(nearbySkierMix({ ...p, distance: 25 }).gain).toBeLessThan(nearbySkierMix(p).gain/5);
  });
});

const def: LiftDef = { name: 'Test lift', kind: 'chair_lift', seats: 3, speed: 2.3, capacity: 1200, chairSpacing: 20,
  bottom: [0, 2400, 0], top: [0, 2500, -300], horizontalLength: 300, slopeLength: 320, vertical: 100,
  supports: [{ s: 0, ground: 2400, cable: 2406 }, { s: 100, ground: 2430, cable: 2438 },
    { s: 200, ground: 2460, cable: 2468 }, { s: 300, ground: 2500, cable: 2506 }].map((p, i) => ({ ...p, kind: i === 0 ? 'bottom' : i === 3 ? 'top' : 'tower' })) };
const path = new LiftPath(def), surf = { groomed: 1, piste: 1, moguls: 0 }, forward = { x: 0, y: 0, z: -1 };

describe('sound event tracking', () => {
  it('triggers one tower traversal and suppresses skipped ride distances', () => {
    const scene = new AudioScene(), st = createSkier({ x: 0, y: 2440, z: -99.8 }, 0);
    const ride = { lift: 0, chair: 2 };
    expect(scene.sample(.1, st, ride, [path], surf, forward, false).towerPass).toBe(false);
    st.pos.z = -100.03;
    expect(scene.sample(.1, st, ride, [path], surf, forward, false).towerPass).toBe(true);
    st.pos.z = -100.26;
    expect(scene.sample(.1, st, ride, [path], surf, forward, false).towerPass).toBe(false);
    st.pos.z = -260;
    const skipped = scene.sample(.1, st, ride, [path], surf, forward, false);
    expect(skipped.discontinuity).toBe(true);
    expect(skipped.towerPass).toBe(false);
    expect(skipped.fell).toBe(false);
  });
  it('makes landings depend on actual air time and normal impact speed', () => {
    const scene = new AudioScene(), st = createSkier({ x: 0, y: 2400, z: 0 }, 0);
    expect(scene.sample(.1, st, null, [path], surf, forward, false).landing).toBe(0);
    st.grounded = false; st.mode = 'air'; st.vel.y = -3;
    scene.sample(.1, st, null, [path], surf, forward, false);
    st.grounded = true; st.mode = 'skiing'; st.vel.y = 0;
    expect(scene.sample(.1, st, null, [path], surf, forward, false).landing).toBe(3);
    expect(scene.sample(.1, st, null, [path], surf, forward, false).landing).toBe(0);
    st.pos.z = -200; st.mode = 'fallen';
    expect(scene.sample(.1, st, null, [path], surf, forward, false).fell).toBe(false);
  });
  it('does not confuse boarding or unloading with hitting the snow', () => {
    const scene = new AudioScene(), st = createSkier({ x: 0, y: 2400, z: 0 }, 0);
    scene.sample(.1, st, null, [path], surf, forward, false);
    st.grounded = false;
    expect(scene.sample(.1, st, { lift: 0, chair: 2 }, [path], surf, forward, false).boarded).toBe(true);
    st.grounded = true;
    const unloaded = scene.sample(.1, st, null, [path], surf, forward, false);
    expect(unloaded.unloaded).toBe(true);
    expect(unloaded.landing).toBe(0);
  });
});
