import { describe, expect, it } from 'vitest';
import { Route, Schedule } from '../../client/src/world/lesson';
import { guestLook, rng } from '../../client/src/world/guests';
import { conditionsFor, formatClock, groomedRuns, overnightSnow } from '../../client/src/world/conditions';

const straight = new Route([{ x: 0, z: 0 }, { x: 0, z: -300 }], 3);

describe('lesson route and schedule', () => {
  it('measures arc length along the smoothed centreline', () => {
    expect(straight.length).toBeCloseTo(300, 0);
    const p = straight.at(120);
    expect(p.x).toBeCloseTo(0, 3); expect(p.z).toBeCloseTo(-120, 1);
    expect(straight.project(4, -200).s).toBeCloseTo(200, 0);
    // beyond the ends it extrapolates along the end tangents
    expect(straight.at(-10).z).toBeCloseTo(10, 1);
  });

  it('dwells at each stop and replays the leader for followers, shifted back', () => {
    const stops = [
      { s: 30, dwell: 20, start: true, label: 'top', side: 1 },
      { s: 150, dwell: 10, label: 'mid', side: 1 },
    ];
    const sched = new Schedule(straight, stops, [{ to: Infinity, pace: 4 }]);
    // starts waiting at the first stop, leaves after its dwell
    expect(sched.s(0)).toBe(30); expect(sched.s(19.9)).toBe(30);
    expect(sched.s(20 + 30)).toBeCloseTo(150, 5);   // 120 m at 4 m/s
    expect(sched.s(20 + 30 + 9)).toBeCloseTo(150, 5); // still at the mid stop
    expect(sched.s(20 + 30 + 10 + 25)).toBeCloseTo(250, 5);
    expect(sched.duration).toBeCloseTo(20 + 30 + 10 + 150 / 4, 5);
    expect(sched.stopNear(150)?.stop.label).toBe('mid');
  });

  it('uses section paces, such as skating back to the lodge', () => {
    const sched = new Schedule(straight, [], [{ to: 200, pace: 4 }, { to: Infinity, pace: 1 }]);
    expect(sched.duration).toBeCloseTo(50 + 100, 5);
    expect(sched.section(250).pace).toBe(1);
  });
});

describe('guests and conditions', () => {
  it('gives a chair regular the same look on the chair and on skis', () => {
    const a = guestLook(rng(1234), { jacket: 0x1f6fd1 }), b = guestLook(rng(1234), { jacket: 0x1f6fd1 });
    expect(a).toEqual(b);
    expect(a.jacket).toBe(0x1f6fd1);
  });

  it('reports a deterministic day of snow and grooming', () => {
    const runs = ['Ute', 'Midway', 'Grizzly Road', 'Sun King', 'Rebel', 'Cornice'].map((name, id) => ({ id, name, difficulty: 'blue', grooming: 'groomed', kind: 'line', points: [] }));
    const g1 = groomedRuns(runs, 20500), g2 = groomedRuns(runs, 20500);
    expect(g1).toEqual(g2);
    expect(g1).toContain('Ute');
    for (let d = 20400; d < 20500; d++) expect(overnightSnow(d)).toBeGreaterThanOrEqual(0);
    expect(formatClock(9.5)).toBe('9:30 AM');
    expect(formatClock(13.25)).toBe('1:15 PM');
    const c = conditionsFor({ now: 1_800_000_000, hour: 11, snowing: true, runs, liftNames: ['Primo'], lesson: 'x' });
    expect(c.weather).toBe('Snow showers');
    expect(c.lifts[0].open).toBe(true);
    expect(c.tempF).toBeGreaterThan(5); expect(c.tempF).toBeLessThan(35);
  });
});
