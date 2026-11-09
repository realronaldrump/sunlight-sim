import { describe, expect, it } from 'vitest';
import { SkiLog, LOG_KEY, buildTrails } from '../../client/src/log/skiLog';

class MemoryStorage { m = new Map<string, string>(); getItem(k: string) { return this.m.get(k) ?? null; } setItem(k: string, v: string) { this.m.set(k, v); } removeItem(k: string) { this.m.delete(k); } clear() { this.m.clear(); } key() { return null; } get length() { return this.m.size; } }

// two parallel trails 400 m apart, each 600 m long, dropping 150 m
const runs = [
  { id: 11, name: 'Lesson Hill', difficulty: 'green', grooming: 'groomed', kind: 'line', points: [[0, 2600, 0], [0, 2525, -300], [0, 2450, -600]] },
  { id: 12, name: 'Steep Pitch', difficulty: 'black', grooming: 'moguls', kind: 'line', points: [[400, 2600, 0], [400, 2450, -600]] },
  { id: 13, name: 'Hike-Out', difficulty: 'hike', grooming: 'groomed', kind: 'line', points: [[800, 2600, 0], [800, 2450, -600]] },
];

/** Ski straight down a trail centreline from `from` to `to` (fractions) at `v` m/s. */
function ski(log: SkiLog, x: number, from: number, to: number, v = 8, run: string | null = null) {
  const dt = 1 / 30;
  for (let s = from * 600; s <= to * 600; s += v * dt) log.update(dt, { x, y: 2600 - s / 4, z: -s, speed: v, skiing: true, riding: false, fallen: false, run });
}

describe('ski log', () => {
  it('catalogs skiable named trails with stable keys', () => {
    const t = buildTrails(runs as any);
    expect(t.map((x) => x.name)).toEqual(['Lesson Hill', 'Steep Pitch']);
    expect(t[0].key).toBe('osm:11');
    expect(t[0].bins).toBe(60);
  });

  it('records a full descent, credits a lap, and keeps repeat laps in the history', () => {
    const store = new MemoryStorage() as unknown as Storage;
    const log = new SkiLog(runs as any, store);
    ski(log, 0, 0, 1);
    log.endDescent();
    expect(log.descents).toHaveLength(1);
    const d = log.descents[0];
    expect(d.dist).toBeGreaterThan(600); expect(d.vert).toBeGreaterThan(140);
    expect(d.top).toBeCloseTo(8, 1);
    expect(d.runs[0]).toMatchObject({ key: 'osm:11', done: true });
    let c = log.coverage().find((x) => x.trail.name === 'Lesson Hill')!;
    expect(c.status).toBe('completed'); expect(c.laps).toBe(1);
    // repeat lap: one more history entry, same unique trail count
    ski(log, 0, 0, 1); log.endDescent();
    c = log.coverage().find((x) => x.trail.name === 'Lesson Hill')!;
    expect(c.laps).toBe(2);
    expect(log.descents).toHaveLength(2);
    expect(log.coverage().filter((x) => x.status === 'completed')).toHaveLength(1);
    expect(log.totals.descents).toBe(2);
  });

  it('marks a partial descent and persists everything across a reload', () => {
    const store = new MemoryStorage() as unknown as Storage;
    const a = new SkiLog(runs as any, store);
    ski(a, 400, 0.1, 0.5, 10);
    a.endDescent();
    const steep = a.coverage().find((x) => x.trail.name === 'Steep Pitch')!;
    expect(steep.status).toBe('partial');
    expect(steep.frac).toBeGreaterThan(0.35); expect(steep.frac).toBeLessThan(0.5);
    a.update(5 / 6, { x: 0, y: 0, z: 0, speed: 0, skiing: false, riding: true, fallen: false, run: null });
    a.save();
    expect(store.getItem(LOG_KEY)).toBeTruthy();
    const b = new SkiLog(runs as any, store);
    expect(b.descents).toHaveLength(1);
    expect(b.coverage().find((x) => x.trail.name === 'Steep Pitch')!.status).toBe('partial');
    expect(b.totals.lift).toBeCloseTo(5 / 6, 3);
    expect(b.days.length).toBe(1);
  });

  it('breaks the trace at a teleport and ignores teleport distance', () => {
    const log = new SkiLog(runs as any, new MemoryStorage() as unknown as Storage);
    ski(log, 0, 0, 0.4);
    const before = log.totals.dist;
    // jump 400 m sideways in one frame
    log.update(1 / 30, { x: 400, y: 2600, z: 0, speed: 0, skiing: true, riding: false, fallen: false, run: null });
    expect(log.totals.dist - before).toBeLessThan(1);
    expect(log.descents).toHaveLength(1); // the first part was closed as its own descent
  });

  it('a trail skied only partway does not count as a lap', () => {
    const log = new SkiLog(runs as any, new MemoryStorage() as unknown as Storage);
    ski(log, 0, 0.35, 1); log.endDescent();
    expect(log.coverage().find((x) => x.trail.name === 'Lesson Hill')!.status).toBe('partial');
  });
});
