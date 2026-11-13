import { beforeAll, describe, expect, it } from 'vitest';
import { GuestNavigation } from '../../shared/mountainGuestNavigation';
import { SkiNavigation, nearestRoutePosition, readSharedRoute, routeDistance, type SkiRoute } from '../../shared/skiNavigation';
import { ColliderGrid } from '../../shared/collision';
import { loadGuestWorld } from '../../client/src/world/mountainGuestWorld';
import { fsLoader } from '../harness/world';
import { LODGE_SKI_START } from '../../client/src/world/mainLodge';
import { Room } from '../../server/src/rooms';
import type { ServerMsg } from '../../shared/protocol';

function slope(blocked = false) {
  const colliders = new ColliderGrid();
  if (blocked) colliders.add({ type: 'box', x: 0, z: 0, hx: 7, hz: 12, top: 200 });
  const probe = { height: (x: number, z: number) => 100 + z * .2,
    normal: (_x: number, _z: number, out: any) => Object.assign(out, { x: 0, y: .98, z: -.2 }),
    surface: () => ({ piste: 1, groomed: 1, moguls: 0 }) };
  const boundary = [[-70, 100, -70], [70, 100, -70], [70, 100, 70], [-70, 100, 70]];
  const nav = new GuestNavigation(boundary, [], [], probe, colliders, () => 0);
  return new SkiNavigation(nav, []);
}

describe('directed skiing routes', () => {
  it('skis downhill to the exact pin and labels an unavoidable uphill as walking', () => {
    const planner = slope(), high = { x: 0, z: 45.3 }, low = { x: 0, z: -45.7 };
    const down = planner.plan(high, low)!;
    expect(down.walking).toBe(0); expect(down.legs.at(-1)!.points.at(-1)).toEqual(low);
    const up = planner.plan(low, high)!;
    expect(up.walking).toBeGreaterThan(75);
    expect(up.legs.some(l => l.mode === 'walk')).toBe(true);
  });
  it('routes around walls, keeps simplified segments clear, and rejects blocked and outside pins', () => {
    const planner = slope(true), from = { x: 0, z: 50 };
    const route = planner.plan(from, { x: 0, z: -50 })!;
    expect(route.walking).toBe(0);
    expect(route.legs.flatMap(l => l.points).some(p => Math.abs(p.x) > 7)).toBe(true);
    for (const leg of route.legs) for (let i = 1; i < leg.points.length; i++) expect(planner.travel(leg.points[i - 1], leg.points[i])).not.toBeNull();
    expect(planner.plan(from, { x: 0, z: 0 })).toBeNull();
    expect(planner.plan(from, { x: 90, z: 0 })).toBeNull();
  });
  it('does not skip ahead across a lift when measuring route progress', () => {
    const route: SkiRoute = { destination: { x: 0, z: 100 }, distance: 110, walking: 0, seconds: 60, legs: [
      { mode: 'ski', name: 'Approach', distance: 10, points: [{ x: 0, z: 0 }, { x: 0, z: -10 }] },
      { mode: 'lift', name: 'Chair', lift: 0, distance: 90, points: [{ x: 0, z: -10 }, { x: 0, z: 80 }] },
      { mode: 'ski', name: 'Exit', distance: 20, points: [{ x: 0, z: 80 }, { x: 0, z: 100 }] },
    ] };
    expect(nearestRoutePosition(route, { x: 0, z: 90 }).leg).toBe(0);
  });
});

describe('routes on Sunlight terrain', () => {
  let planner: SkiNavigation, summit: SkiRoute;
  beforeAll(async () => {
    const resort = JSON.parse(new TextDecoder().decode(await fsLoader('/world/resort.json')));
    const world = await loadGuestWorld('/world', resort, fsLoader);
    planner = new SkiNavigation(world.navigation, resort.runs);
    summit = planner.plan(LODGE_SKI_START, { x: 18.3, z: 956.3 })!;
  }, 60000);
  it('connects the lodge to Primo via a base lift without walking or teleporting', () => {
    expect(summit).not.toBeNull(); expect(summit.walking).toBe(0);
    const lifts = summit.legs.filter(l => l.mode === 'lift');
    expect(lifts.map(l => l.name)).toEqual(['Tercero', 'Primo']);
    for (const leg of lifts) {
      const link = planner.nav.liftLinks.find(l => l.index === leg.lift)!;
      expect(routeDistance(leg.points[0], link.load)).toBeLessThan(.01);
      expect(routeDistance(leg.points.at(-1)!, link.exit)).toBeLessThan(.01);
    }
    for (let i = 1; i < summit.legs.length; i++) expect(routeDistance(summit.legs[i - 1].points.at(-1)!, summit.legs[i].points[0])).toBeLessThan(.01);
    for (const leg of summit.legs.filter(l => l.mode !== 'lift')) for (let i = 1; i < leg.points.length; i++) {
      expect(planner.travel(leg.points[i - 1], leg.points[i])?.walk).toBe(0);
    }
  });
  it('returns downhill without a lift and uses Tercero for a nearby uphill destination', () => {
    const down = planner.plan({ x: 18.3, z: 956.3 }, { x: 43, z: -990.9 })!;
    expect(down.walking).toBe(0); expect(down.legs.every(l => l.mode === 'ski')).toBe(true);
    const up = planner.plan(LODGE_SKI_START, { x: 60, z: -600 })!;
    expect(up.walking).toBe(0); expect(up.legs.filter(l => l.mode === 'lift').map(l => l.name)).toEqual(['Tercero']);
    expect(up.distance).toBeLessThan(1800);
  });
  it('respects closed lifts and begins at the top of a chair already being ridden', () => {
    const down = planner.plan({ x: 18.3, z: 956.3 }, { x: 43, z: -990.9 }, { liftsOpen: false })!;
    expect(down.legs.every(l => l.mode !== 'lift')).toBe(true);
    const lift = planner.nav.lifts[1], p = lift.loadPoint();
    const riding = planner.plan(p, { x: 18.3, z: 956.3 }, { riding: 1, liftsOpen: false })!;
    expect(riding.legs[0]).toMatchObject({ mode: 'lift', name: 'Primo' });
    expect(riding.legs.filter(l => l.mode === 'lift')).toHaveLength(1);
  });
  it('shares bounded annotations with current and late friends, keeps them out of snapshots and removes them on leave', () => {
    const room = new Room('PIN', planner.nav.lifts);
    const messages: ServerMsg[] = [], conn = { send: (m: ServerMsg) => messages.push(m), close() {} };
    const a = room.join(conn, 'Ann', '#2266bb')!;
    const shared = { destination: summit.destination, route: summit };
    room.handle(a.id, { type: 'route', route: shared });
    expect(messages.at(-1)).toMatchObject({ type: 'route', id: a.id, route: shared });
    room.join(conn, 'Ben', '#bb2266');
    expect(messages.filter(m => m.type === 'welcome').at(-1)).toMatchObject({ routes: [{ id: a.id, route: shared }] });
    expect(JSON.stringify(room.snapshot())).not.toContain('destination');
    room.leave(a.id); expect(room.routes.size).toBe(0);
  });
  it('rejects malformed and unbounded annotations, and copies accepted geometry', () => {
    const valid = { destination: summit.destination, route: summit }, contains = (x: number, z: number) => planner.nav.contains(x, z);
    const read = readSharedRoute(valid, contains, 3)!;
    expect(read).toEqual(valid); expect(read.route).not.toBe(summit);
    expect(readSharedRoute({ ...valid, destination: { x: NaN, z: 5 } }, contains, 3)).toBeUndefined();
    expect(readSharedRoute({ ...valid, route: { ...summit, legs: Array(257).fill(summit.legs[0]) } }, contains, 3)).toBeUndefined();
    expect(readSharedRoute({ ...valid, route: { ...summit, seconds: Infinity } }, contains, 3)).toBeUndefined();
    expect(readSharedRoute(null, contains, 3)).toBeNull();
  });
});
