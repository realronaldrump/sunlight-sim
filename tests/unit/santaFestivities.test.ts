import { beforeAll, describe, expect, it, vi } from 'vitest';
import { loadGuestWorld } from '../../client/src/world/mountainGuestWorld';
import { santaBellMix, santaChime, santaJingle, SANTA_BELL_RANGE } from '../../client/src/audio/santaBells';
import { Lobby } from '../../server/src/rooms';
import { MountainGuest, readGuestCheckpoint } from '../../shared/mountainGuest';
import type { NetSkier, ServerMsg } from '../../shared/protocol';
import { SANTA_STAR_LIFE } from '../../shared/santaFestivities';
import { createSkier, headingFromDir } from '../../shared/skiPhysics';
import { ornamentBranches } from '../../shared/treeData';
import { fsLoader } from '../harness/world';

let world: Awaited<ReturnType<typeof loadGuestWorld>>;
const wall = 1_800_000_000;
const dt = 1 / 30;
beforeAll(async () => {
  const resort = JSON.parse(new TextDecoder().decode(await fsLoader('/world/resort.json')));
  world = await loadGuestWorld('/world', resort, fsLoader);
});

function fixture() {
  const { navigation: nav, colliders } = world;
  const run = nav.courses.find(c => c.run.name === 'Grizzly Road')!;
  for (const p of run.marks) {
    const y = nav.probe.height(p.x, p.z);
    if (y < 2630 || nav.probe.normal(p.x, p.z, { x: 0, y: 1, z: 0 }).y <= .962 || nav.blocked(p.x, p.z, y, .68)) continue;
    const stop = nav.santaFirStop(p);
    if (!stop) continue;
    const d = Math.hypot(p.x - stop.at.x, p.z - stop.at.z);
    if (d <= 1.7 || d >= 6) continue;
    const cp = new MountainGuest(nav, colliders, 187).checkpoint();
    cp.st = createSkier({ ...p, y }, headingFromDir(stop.anchor.x - p.x, stop.anchor.z - p.z));
    cp.route = []; cp.cursor = 0; cp.rest = 120;
    return { cp, stop };
  }
  throw new Error('No reachable bough on Grizzly Road');
}

describe('Santa on the mountain', () => {
  it('walks to a modeled bough, hangs a star and leaves it for a minute', () => {
    const { navigation: nav, colliders } = world;
    const { cp, stop } = fixture();
    const candidates = colliders.query(cp.st.pos.x, cp.st.pos.z).flatMap(c =>
      c.fir ? [...ornamentBranches(c.fir, stop.anchor.y + 5)] : []);
    expect(candidates).toContainEqual(stop.anchor);
    cp.festivities = { searchAt: 0, greetAt: 1000 };
    const guest = new MountainGuest(nav, colliders, 187, cp);
    let last = guest.pose(), maxStep = 0, hanging = false, firstLight = 0, lastLight = 0, departed = false;
    for (let i = 1; i <= 30 * 82; i++) {
      guest.advance(dt, nav.lifts.map(() => wall + i * dt));
      const p = guest.pose();
      maxStep = Math.max(maxStep, Math.hypot(p.x - last.x, p.y - last.y, p.z - last.z));
      if (p.action?.kind === 'hang-star') { hanging = true; expect(p.action.anchor).toEqual(stop.anchor); }
      if (p.star) {
        if (!firstLight) {
          firstLight = i * dt;
          expect(hanging).toBe(true);
          const saved = readGuestCheckpoint(JSON.parse(JSON.stringify(guest.checkpoint())), nav)!;
          expect(new MountainGuest(nav, colliders, 187, saved).pose().star).toEqual(p.star);
        }
        lastLight = i * dt;
        departed ||= Math.hypot(p.x - stop.anchor.x, p.z - stop.anchor.z) > 2;
      }
      last = p;
    }
    expect(maxStep).toBeLessThan(.22);
    expect(firstLight).toBeGreaterThan(2);
    expect(lastLight - firstLight).toBeGreaterThanOrEqual(SANTA_STAR_LIFE);
    expect(lastLight - firstLight).toBeLessThan(SANTA_STAR_LIFE + 1.1);
    expect(departed).toBe(true);
    expect(last.star).toBeUndefined();
  });

  it('gives one shared hat tip to players near the same stop', () => {
    const { navigation: nav } = world;
    const { cp } = fixture();
    cp.festivities = { searchAt: 1000, greetAt: 0 };
    vi.useFakeTimers({ toFake: ['Date'] });
    try {
      vi.setSystemTime(wall * 1000);
      const lobby = new Lobby(nav.lifts, world, new Map([['GREET', cp]]));
      const received: ServerMsg[][] = [[], []];
      const [a, b] = received.map((queue, i) => lobby.join({ send: m => queue.push(m), close() {} }, 'GREET', `Skier ${i}`, '#bb3311')!);
      const state = (dist: number): NetSkier => ({
        ...cp.st.pos, z: cp.st.pos.z - dist, heading: 0, vx: 0, vy: 0, vz: 0, mode: 'standing', edge: 0, plow: 0, tuck: 0, fallen: 0,
      });
      const latest = (i: number) => received[i].filter(m => m.type === 'snapshot').at(-1)?.mountainGuest;
      a.room.handle(a.id, { type: 'state', s: state(21), teleport: true });
      b.room.handle(b.id, { type: 'state', s: state(21), teleport: true });
      vi.setSystemTime((wall + .15) * 1000); lobby.tick();
      expect(latest(0)?.action).toBeUndefined();
      a.room.handle(a.id, { type: 'state', s: state(5), teleport: true });
      vi.setSystemTime((wall + .25) * 1000); lobby.tick();
      expect(latest(0)?.action?.kind).toBe('hat-tip');
      expect(latest(0)?.action).toEqual(latest(1)?.action);
      for (let i = 3; i < 25; i++) {
        vi.setSystemTime((wall + i / 10) * 1000); lobby.tick();
      }
      expect(latest(0)?.action).toBeUndefined();
    } finally { vi.useRealTimers(); }
  });
});

describe('Santa audio', () => {
  it('pans nearby moving bells, with silence outside the audible radius', () => {
    const { navigation, colliders } = world;
    const p = new MountainGuest(navigation, colliders, 9).pose();
    p.speed = 9;
    const north = { x: 0, y: 0, z: -1 };
    const at = (dx: number) => ({ x: p.x + dx, y: p.y + 1.1, z: p.z });
    const close = santaBellMix(p, at(-3), north)!;
    const faint = santaBellMix(p, at(21), north)!;
    expect(close.pan).toBeGreaterThan(.6);
    expect(faint.pan).toBeLessThan(-.6);
    expect(faint.gain).toBeLessThan(close.gain * .32);
    expect(santaBellMix(p, at(SANTA_BELL_RANGE + 1), north)).toBeNull();
    expect(santaBellMix({ ...p, speed: .3 }, at(-3), north)).toBeNull();
  });

  it('synthesizes bounded ringing and a distinct, longer discovery note', () => {
    const context = {
      sampleRate: 12000,
      createBuffer(_channels: number, length: number) {
        const data = new Float32Array(length);
        return { getChannelData: () => data };
      },
    } as unknown as BaseAudioContext;
    const jingle = santaJingle(context).getChannelData(0), note = santaChime(context).getChannelData(0);
    expect(jingle.length).toBe(5160);
    expect(note.length).toBe(13200);
    for (const samples of [jingle, note]) {
      expect(Math.max(...samples)).toBeGreaterThan(.2);
      expect(Math.max(...samples.map(Math.abs))).toBeLessThan(1);
      expect(Math.abs(samples.at(-1)!)).toBeLessThan(.005);
    }
  });
});
