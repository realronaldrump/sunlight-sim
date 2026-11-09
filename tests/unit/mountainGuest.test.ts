import { beforeAll, describe, expect, it, vi } from 'vitest';
import { loadGuestWorld } from '../../client/src/world/mountainGuestWorld';
import { SantaDiscovery, SANTA_ACHIEVEMENT_KEY, sightLine } from '../../client/src/world/santaDiscovery';
import { ColliderGrid } from '../../shared/collision';
import { MountainGuest, readGuestCheckpoint } from '../../shared/mountainGuest';
import { createSkier } from '../../shared/skiPhysics';
import type { ServerMsg } from '../../shared/protocol';
import { Lobby } from '../../server/src/rooms';
import { fsLoader } from '../harness/world';

let world: Awaited<ReturnType<typeof loadGuestWorld>>;
let resort: Parameters<typeof loadGuestWorld>[1];
const wall = 1_800_000_000;
const dt = 1 / 30;
const distance = (a: { x: number; y: number; z: number }, b: { x: number; y: number; z: number }) =>
  Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);

beforeAll(async () => {
  resort = JSON.parse(new TextDecoder().decode(await fsLoader('/world/resort.json')));
  world = await loadGuestWorld('/world', resort, fsLoader);
});

describe('the resident skier', () => {
  it('can reach and traverse every mapped skiable run, with different routes from different seeds', () => {
    const { navigation: nav, colliders } = world;
    const guest = new MountainGuest(nav, colliders, 187);
    const expected = resort.runs.filter(r => r.kind === 'line' && r.difficulty !== 'hike').map(r => r.id);
    expect(nav.courses.map(c => c.run.id)).toEqual(expected);
    expect(nav.liftLinks.map(l => l.index)).toEqual([0, 1, 2]);
    for (const course of nav.courses) {
      const path = nav.plan(guest.pose(), course, 187, true);
      expect(path, course.run.name).not.toBeNull();
      const end = course.marks.at(-1)!;
      expect(Math.hypot(path!.at(-1)!.x - end.x, path!.at(-1)!.z - end.z), course.run.name).toBeLessThan(23);
    }
    const ute = nav.courses.find(c => c.run.name === 'Ute')!;
    expect(nav.plan(guest.pose(), ute, 187, true)).not.toEqual(nav.plan(guest.pose(), ute, 9351, true));
  });

  it('skis, boards and progresses through multiple courses without relocating', () => {
    const { navigation: nav, colliders } = world;
    const guest = new MountainGuest(nav, colliders, 187);
    let previous = guest.pose(), speed = 0, step = 0, edge = 0, seenLift = false;
    for (let i = 1; i <= 30 * 4200; i++) {
      guest.advance(dt, nav.lifts.map(() => wall + i * dt));
      const p = guest.pose();
      step = Math.max(step, distance(p, previous));
      speed = Math.max(speed, p.speed);
      edge = Math.max(edge, Math.abs(p.edge));
      seenLift ||= !!p.ride;
      previous = p;
    }
    expect(speed).toBeGreaterThan(9);
    expect(edge).toBeGreaterThan(.4);
    expect(step).toBeLessThan(.95);
    expect(seenLift).toBe(true);
    expect(nav.contains(previous.x, previous.z)).toBe(true);
    expect(guest.checkpoint().visits.filter(Boolean).length).toBeGreaterThanOrEqual(3);
  });

  it.each([0, 1, 2])('boards lift %i only at chair contact, rides to its ramp and skis away', (index) => {
    const { navigation: nav, colliders } = world;
    const lift = nav.lifts[index], link = nav.liftLinks[index];
    const seed = new MountainGuest(nav, colliders, 9).checkpoint();
    const spawn = link.approach;
    const state = { ...seed, st: createSkier({ ...spawn, y: nav.probe.height(spawn.x, spawn.z) }, lift.loadPoint().heading),
      route: [{ ...link.load, lift: index }, link.exit], cursor: 0, liftTimes: nav.lifts.map(() => wall) };
    const guest = new MountainGuest(nav, colliders, 9, state);
    let i = 0, passed = 0, boarded = false, dismounted = false;
    for (; i <= 30 * (lift.rideTime() + 150); i++) {
      const old = guest.pose();
      guest.advance(dt, nav.lifts.map(() => wall + i * dt), () => ++passed >= 2 && i >= 30 * 30);
      const p = guest.pose();
      expect(distance(p, old)).toBeLessThan(.75);
      if (p.ride && !boarded) {
        expect(i).toBeGreaterThanOrEqual(30 * 30);
        expect(p.ride.lift).toBe(index);
        expect(lift.chairU(p.ride.chair, p.ride.boardedAt)).toBeCloseTo(lift.loadU, 0);
        boarded = true;
      }
      if (boarded && !p.ride && !dismounted) {
        expect(distance(p, { ...lift.unloadPoint(link.seat), y: p.y })).toBeLessThan(.42);
        dismounted = true;
      }
      if (dismounted && guest.checkpoint().cursor >= state.route.length) break;
    }
    expect(boarded).toBe(true);
    expect(dismounted).toBe(true);
    expect(i).toBeLessThan(30 * (lift.rideTime() + 150));
  });

  it('publishes one pose to friends and resumes an empty room on the same chair', () => {
    const { navigation: nav, colliders } = world;
    const state = new MountainGuest(nav, colliders, 80).checkpoint();
    const lift = nav.lifts[0], next = lift.nextChairAt(lift.loadU, wall);
    const seat = 1, at = next.arrive + 70;
    const rider = lift.riderPoint(next.index, seat, at);
    state.st.pos = rider.p; state.st.heading = rider.heading; state.st.mode = 'riding';
    state.ride = { lift: 0, chair: next.index, seat, boardedAt: next.arrive, unloadAt: next.arrive + lift.rideTime() };
    state.liftTimes[0] = at;

    const history = new Map<string, unknown>([['TEST', state]]);
    const lobby = new Lobby(nav.lifts, world, history);
    const messages: ServerMsg[][] = [[], []];
    const connect = (i: number) => lobby.join({ send: m => messages[i].push(m), close() {} }, 'TEST', `Friend ${i}`, '#aabbcc')!;
    const a = connect(0), b = connect(1);
    lobby.tick();
    const snapshot = (i: number) => messages[i].filter(m => m.type === 'snapshot').at(-1);
    expect(snapshot(0)?.mountainGuest).toEqual(snapshot(1)?.mountainGuest);
    expect(snapshot(0)?.mountainGuest?.ride).toEqual(state.ride);
    expect(distance(snapshot(0)!.mountainGuest!, state.st.pos)).toBeLessThan(.25);
    lobby.leave(a.room.code, a.id); lobby.leave(b.room.code, b.id);
    expect(lobby.rooms.size).toBe(0);
    const checkpoint = readGuestCheckpoint(JSON.parse(JSON.stringify(history.get('TEST'))), nav)!;
    expect(checkpoint.ride).toEqual(state.ride);
    expect(connect(1).room.guest?.pose().ride).toEqual(state.ride);
    expect(distance(connect(0).room.guest!.pose(), checkpoint.st.pos)).toBeLessThan(.25);
  });
});

describe('Santa Sighting', () => {
  it('requires a continuous sighting and unlocks once across reloads', () => {
    const storage = { getItem: vi.fn(() => null as string | null), setItem: vi.fn() };
    const trophy = new SantaDiscovery(storage);
    for (let i = 0; i < 6; i++) expect(trophy.update(.1, true)).toBe(false);
    trophy.update(.1, false);
    for (let i = 0; i < 7; i++) expect(trophy.update(.1, true)).toBe(false);
    expect(trophy.update(.1, true)).toBe(true);
    expect(trophy.update(.1, true)).toBe(false);
    expect(storage.setItem).toHaveBeenCalledOnce();
    expect(storage.setItem).toHaveBeenCalledWith(SANTA_ACHIEVEMENT_KEY, String(trophy.foundAt));
    storage.getItem.mockReturnValue(String(trophy.foundAt));
    expect(new SantaDiscovery(storage).foundAt).toBe(trophy.foundAt);
  });

  it('blocks the sighting through a ridge, building or trunk and allows the clear view', () => {
    const from = { x: 0, y: 2, z: 0 }, to = { x: 0, y: 1.3, z: 12 }, grid = new ColliderGrid();
    expect(sightLine(from, to, () => 0, grid)).toBe(true);
    expect(sightLine(from, to, (_x, z) => z > 5 && z < 7 ? 2.6 : 0, grid)).toBe(false);
    grid.add({ type: 'box', x: 0, z: 6, hx: 2, hz: 1, bottom: 3, top: 5 });
    expect(sightLine(from, to, () => 0, grid)).toBe(true);
    grid.add({ type: 'cyl', x: 0, z: 7, r: .3, top: 10 });
    expect(sightLine(from, to, () => 0, grid)).toBe(false);
  });
});
