import { describe, expect, it } from 'vitest';
import { CHAIR_SWING, createChairSwing, stepChairSwing, swingingRiderPoint, chairReleaseVelocity, rotateChairVector, validChairSwing } from '../../shared/chairSwing';
import { LiftPath, type LiftDef } from '../../shared/lifts';
import { createSkier, fall, getUp, stepSkier, type TerrainProbe } from '../../shared/skiPhysics';

const path = new LiftPath({ name: 'Test', kind: 'chair_lift', seats: 3, speed: 2.3, capacity: 1200, chairSpacing: 20,
  bottom: [0, 0, 0], top: [0, 30, -100], horizontalLength: 100, slopeLength: 105, vertical: 30,
  supports: [{ s: 0, ground: 0, cable: 10, kind: 'bottom' }, { s: 100, ground: 30, cable: 40, kind: 'top' }] } as LiftDef);
const terrain: TerrainProbe = { height: () => 0, normal: (_x, _z, out) => Object.assign(out, { x: 0, y: 1, z: 0 }), surface: () => ({ groomed: 1, piste: 1, moguls: 0 }) };
const idle = { steer: 0, tuck: false, push: false, plow: 0, stop: false };

describe('chairlift weight shift and release', () => {
  it('stays exactly still with no input and settles after a held lean without releasing', () => {
    const s = createChairSwing();
    for (let i = 0; i < 600; i++) stepChairSwing(s, { right: 0, forward: 0 }, 1 / 60);
    expect(s).toEqual(createChairSwing());
    for (let i = 0; i < 1800; i++) expect(stepChairSwing(s, { right: 1, forward: 0 }, 1 / 60)).toBe(false);
    expect(Math.abs(s.roll)).toBeLessThan(.15);
    expect(Math.abs(s.rollV)).toBeLessThan(.03);
    for (let i = 0; i < 3600; i++) stepChairSwing(s, { right: 0, forward: 0 }, 1 / 60);
    expect(Math.abs(s.roll)).toBeLessThan(.005);
  });

  it('pumps gradually in either axis, with consistent release at 20, 60 and 144 fps', () => {
    for (const axis of ['right', 'forward'] as const) {
      const times: number[] = [];
      for (const fps of [20, 60, 144]) {
        const s = createChairSwing(); let time = 0;
        while (time < 25) {
          time += 1 / fps;
          const input = { right: 0, forward: 0, [axis]: Math.sign(Math.cos(time * 1.65)) };
          if (stepChairSwing(s, input, 1 / fps)) break;
        }
        expect(time).toBeGreaterThan(6); expect(time).toBeLessThan(13);
        expect(s.slip).toBe(CHAIR_SWING.releaseSlip); times.push(time);
      }
      expect(Math.max(...times) - Math.min(...times)).toBeLessThan(.3);
    }
  });

  it('does not build a swing from rapid key spam or a suspended-tab frame', () => {
    const s = createChairSwing();
    for (let i = 0; i < 2400; i++) stepChairSwing(s, { right: i % 2 ? 1 : -1, forward: 0 }, 1 / 60);
    expect(s.slip).toBe(0); expect(Math.abs(s.roll)).toBeLessThan(.02);
    stepChairSwing(s, { right: 1, forward: 1 }, 120);
    expect(s.slip).toBe(0); expect(Math.hypot(s.roll, s.pitch)).toBeLessThan(.05);
  });

  it('preserves the shared idle seat and rotates the body around the cable grip', () => {
    const s = createChairSwing(), t = path.sAtH(50) / path.def.speed;
    expect(swingingRiderPoint(path, 0, 1, t, s)).toEqual(path.riderPoint(0, 1, t));
    const point = { x: 1, y: -3.4, z: -.3 }, r = rotateChairVector(point, .3, .5, -.6);
    expect(Math.hypot(r.x, r.y, r.z)).toBeCloseTo(Math.hypot(point.x, point.y, point.z), 10);
    s.roll = .3;
    const tilted = swingingRiderPoint(path, 0, 1, t, s).p, base = path.riderPoint(0, 1, t).p;
    expect(Math.abs(tilted.x - base.x)).toBeGreaterThan(.8);
    expect(tilted.y).toBeGreaterThan(base.y);
  });

  it('carries cable and angular velocity into freefall, lands at that location, and gets up there', () => {
    const s = { ...createChairSwing(), roll: .6, rollV: .7, slip: .72, slipX: -.75, slipZ: -.66 };
    const t = path.sAtH(50) / path.def.speed, point = swingingRiderPoint(path, 0, 0, t, s).p;
    const v = chairReleaseVelocity(path, 0, 0, t, s);
    expect(Math.abs(v.x)).toBeGreaterThan(.5); expect(v.z).toBeLessThan(-path.def.speed);
    const st = createSkier(point); st.vel = v; st.grounded = false; fall(st, 0);
    expect(getUp(st)).toBe(false);
    const y = st.pos.y, vy = st.vel.y;
    stepSkier(st, idle, terrain, .1);
    expect(st.pos.y).toBeCloseTo(y + vy * .1 - .5 * 9.81 * .1 ** 2, 1);
    for (let i = 0; i < 1800 && (!st.grounded || st.speed > 1); i++) stepSkier(st, idle, terrain, 1 / 120);
    expect(st.mode).toBe('fallen'); expect(st.grounded).toBe(true); expect(st.lastImpact).toBeGreaterThan(10);
    const landing = { ...st.pos };
    expect(Math.hypot(landing.x - point.x, landing.z - point.z)).toBeLessThan(35);
    expect(getUp(st)).toBe(true);
    for (let i = 0; i < 200; i++) stepSkier(st, idle, terrain, 1 / 120);
    expect(st.mode).toBe('standing'); expect(st.pos).toEqual(landing);
    for (let i = 0; i < 120; i++) stepSkier(st, { ...idle, push: true }, terrain, 1 / 120);
    expect(st.speed).toBeGreaterThan(.3);
  });

  it('rejects nonfinite or impossible wire motion', () => {
    expect(validChairSwing(createChairSwing())).toBe(true);
    for (const bad of [{ roll: NaN }, { pitch: 2 }, { rollV: 10 }, { slip: 3 }, { slipZ: 1 }])
      expect(validChairSwing({ ...createChairSwing(), ...bad })).toBe(false);
  });
});
