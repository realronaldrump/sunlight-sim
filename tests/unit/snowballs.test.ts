import { describe, it, expect, vi, afterEach } from 'vitest';
import { SNOWBALL, SnowballWorld, aimSnowball, makeSnowball, snowballPosition, snowballKnockdown, type SnowballActor, type SnowballHit } from '../../shared/snowballs';
import { createSkier, stepSkier, getUp, type TerrainProbe } from '../../shared/skiPhysics';
import { ColliderGrid } from '../../shared/collision';
import { Room } from '../../server/src/rooms';
import type { ServerMsg } from '../../shared/protocol';
import { SlopeSkiers } from '../../shared/slopeSkiers';

const ground: TerrainProbe = { height: () => 0, normal: (_x, _z, out) => Object.assign(out, { x: 0, y: 1, z: 0 }), surface: () => ({ groomed: 1, piste: 1, moguls: 0 }) };
const actor = (id = 'a', z = 0): SnowballActor => ({ id, name: id, kind: 'player', pos: { x: 0, y: 0, z }, vel: { x: 0, y: 0, z: 0 }, heading: 0, active: true });
const hit: SnowballHit = { type: 'hit', id: 'a/1', owner: 'a', name: 'a', target: 'b', at: 1, pos: { x: .3, y: 1, z: 0 }, seed: 32 };
function run(world: SnowballWorld, actors: SnowballActor[], start = 0, seconds = 3) {
  for (let t = start; t < start + seconds; t += 1 / 60) world.advance(t, actors);
}
afterEach(() => vi.restoreAllMocks());

describe('snowball flight and knockdowns', () => {
  it('assists a moving skier and accounts for the thrower skiing across the shot', () => {
    const a = actor(), b = actor('b', -17); a.vel.x = 4; b.vel.x = 3;
    const aim = aimSnowball(a, b), shot = makeSnowball(a, aim.yaw, aim.pitch, 0, 'a/1');
    const t = (-17 - shot.pos.z) / shot.vel.z, p = snowballPosition(shot, t);
    expect(p.x).toBeCloseTo(3 * t, 1); expect(p.y).toBeCloseTo(1, 1);
    expect(snowballPosition(shot, t + .2).y).toBeLessThan(p.y);
  });
  it('hits an actual body once, never its owner, and expires misses', () => {
    const a = actor(), b = actor('b', -13), world = new SnowballWorld(() => 0);
    world.throw(a, ...Object.values(aimSnowball(a, b)) as [number, number], 0);
    run(world, [a, b]);
    const hits = world.drain().filter(e => e.type === 'hit');
    expect(hits).toHaveLength(1); expect(hits[0]).toMatchObject({ target: 'b', owner: 'a' }); expect(world.shots.size).toBe(0);
    const miss = new SnowballWorld(() => -1e5); miss.throw(a, 0, .5, 0); run(miss, [a], 0, 4);
    expect(miss.shots.size).toBe(0); expect(miss.drain().some(e => e.type === 'hit')).toBe(false);
  });
  it('uses the measured ground, narrow trunks and rotated walls before a target', () => {
    for (const kind of ['ground', 'trunk', 'wall'] as const) {
      const grid = new ColliderGrid();
      if (kind === 'trunk') grid.add({ type: 'cyl', x: 0, z: -6, r: .09, top: 4 });
      if (kind === 'wall') grid.add({ type: 'box', x: 0, z: -6, hx: 4, hz: .05, yaw: .25, top: 4 });
      const world = new SnowballWorld((_x, z) => kind === 'ground' && z < -5 && z > -7 ? 3 : 0, grid), a = actor(), b = actor('b', -14);
      const aim = aimSnowball(a, b); world.throw(a, aim.yaw, aim.pitch, 0);
      for (let t = 0; t < 2; t += .1) world.advance(t, [a, b]);
      const impact = world.drain().find(e => e.type === 'hit') as SnowballHit;
      expect(impact).toBeDefined(); expect(impact.target).toBeUndefined(); expect(b.active).toBe(true);
    }
  });
  it('keeps upper storey colliders above their real bottom', () => {
    const grid = new ColliderGrid(); grid.add({ type: 'box', x: 0, z: -6, hx: 4, hz: .2, top: 10, bottom: 4 });
    const world = new SnowballWorld(() => 0, grid), a = actor(), b = actor('b', -14), aim = aimSnowball(a, b);
    world.throw(a, aim.yaw, aim.pitch, 0); run(world, [a, b]);
    expect(world.drain().some(e => e.type === 'hit' && e.target === 'b')).toBe(true);
  });
  it('bounds spam, invalid aim, inactive actors and concurrent projectiles', () => {
    const w = new SnowballWorld(() => 0), a = actor();
    expect(w.throw(a, NaN, 0, 0)).toBeNull(); expect(w.throw(a, 0, 1, 0)).toBeNull();
    a.active = false; expect(w.throw(a, 0, 0, 0)).toBeNull(); a.active = true;
    expect(w.throw(a, 0, .1, 0)).not.toBeNull(); expect(w.throw(a, 0, .1, .5)).toBeNull();
    expect(w.throw(a, 0, .1, .86)).not.toBeNull();
    for (let i = 0; i < 70; i++) w.throw(actor(`other${i}`), 0, .1, 1);
    expect(w.shots.size).toBe(SNOWBALL.max);
  });
  it('never replays expired impacts or retaliation after a suspended tab resumes', () => {
    const a=actor(), b=actor('b',-12), w=new SnowballWorld(()=>0);
    w.throw(a,0,.15,0);w.drain();w.advance(50,[a,b]);
    expect(w.shots.size).toBe(0);expect(w.drain()).toEqual([]);expect(b.active).toBe(true);
    const npc={...actor('npc/1',-10),kind:'npc' as const}, fight=new SnowballWorld(()=>0), aim=aimSnowball(a,npc);
    fight.throw(a,aim.yaw,aim.pitch,0);run(fight,[a,npc],0,2);fight.drain();npc.active=true;
    fight.advance(50,[a,npc]);expect(fight.drain()).toEqual([]);
  });
  it('tips a skier while preserving momentum, then uses normal slope friction and recovery', () => {
    const st = createSkier({ x: 0, y: 0, z: 0 }); st.vel = { x: 0, y: 0, z: -10 }; st.speed = 10;
    snowballKnockdown(st, hit);
    expect(st.mode).toBe('fallen'); expect(st.vel.z).toBe(-10); expect(st.grounded).toBe(true);
    for (let i = 0; i < 180; i++) stepSkier(st, { steer: 0, tuck: false, plow: 0, push: false, stop: false }, ground, 1 / 60);
    expect(st.pos.z).toBeLessThan(-3); expect(st.speed).toBeLessThan(1); expect(getUp(st)).toBe(true);
  });
  it('lets a recovered NPC throw back once, without starting an endless NPC loop', () => {
    const a = actor(), npc = { ...actor('npc/1', -10), kind: 'npc' as const }, w = new SnowballWorld(() => 0);
    const aim = aimSnowball(a, npc); w.throw(a, aim.yaw, aim.pitch, 0);
    run(w, [a, npc], 0, 2); expect(npc.active).toBe(false);
    npc.active = true; run(w, [a, npc], 2, 6);
    const throws = w.drain().filter(e => e.type === 'throw');
    expect(throws).toHaveLength(2); expect(throws[1]).toMatchObject({ shot: { owner: 'npc/1' } });
  });
});

describe('room authority for snowball fights', () => {
  function fixture() {
    let time = 100; vi.spyOn(Date, 'now').mockImplementation(() => time * 1000);
    const room = new Room('FIGHT', []), messages: ServerMsg[][] = [[], []];
    const players = messages.map((m, i) => {
      const p = room.join({ send: msg => m.push(structuredClone(msg)), close: () => {} }, `P${i}`, '#ff0000')!;
      room.handle(p.id, { type: 'state', s: { ...p.s, x: 0, y: 0, z: -i * 12 } }); return p;
    });
    return { room, messages, players, at: (t: number) => time = t };
  }
  it('broadcasts identical flight and a canonical knockdown to both friends', () => {
    const f = fixture(), [a, b] = f.players;
    f.room.handle(a.id, { type: 'snowball', token: '1', yaw: 0, pitch: .15 });
    for (let t = 100; t < 101; t += 1 / 30) { f.at(t); f.room.snapshot(); }
    const events = f.messages.map(ms => ms.filter(m => m.type === 'snowballs'));
    expect(events[0]).toEqual(events[1]); expect(b.s.mode).toBe('fallen'); expect(b.s.snowballFall).toBeDefined();
    expect(events[0].flatMap(e => e.events).some(e => e.type === 'hit' && e.target === b.id)).toBe(true);
    f.room.handle(b.id, { type: 'state', s: { ...b.s, mode: 'skiing', fallen: 0, snowballFall: undefined } });
    expect(b.s.mode).toBe('fallen');
  });
  it('rejects forged origins, invalid aim, uninitialized players, drones and fallen skiers', () => {
    const f = fixture(), a = f.players[0];
    f.room.handle(a.id, { type: 'snowball', token: '1', yaw: 0, pitch: NaN });
    a.s.mode = 'fallen'; f.room.handle(a.id, { type: 'snowball', token: '2', yaw: 0, pitch: .1 });
    a.s.mode = 'standing'; a.drone = { x: 0, y: 10, z: 0, yaw: 0, pitch: 0, bank: 0, tilt: 0, rpm: [1,1,1,1] };
    f.room.handle(a.id, { type: 'snowball', token: '3', yaw: 0, pitch: .1 });
    expect(f.room.snowballs.shots.size).toBe(0);
    a.drone = null; a.ride = { lift: 0, chair: 0, seat: 0 };
    f.room.handle(a.id, { type: 'snowball', token: '4', yaw: 0, pitch: .1 }); expect(f.room.snowballs.shots.size).toBe(0);
  });
  it('sends in-flight balls to a late joiner and keeps other rooms isolated', () => {
    const f = fixture(), a = f.players[0]; f.room.handle(a.id, { type: 'snowball', token: '1', yaw: 0, pitch: .3 });
    const messages: ServerMsg[] = []; f.room.join({ send: m => messages.push(m), close: () => {} }, 'Late', '#00ff00');
    expect(messages[0]).toMatchObject({ type: 'welcome', snowballs: [{ owner: a.id }] });
    const other = new Room('OTHER', []); expect(other.snowballs.shots.size).toBe(0);
  });
  it('refines a nearby assisted target while retaining collision-tested flight', () => {
    const f = fixture(), [a,b] = f.players;
    b.s.x = .8;
    f.room.handle(a.id, { type: 'snowball', token: '1', yaw: 0, pitch: .15, target: b.id });
    const shot = [...f.room.snowballs.shots.values()][0];
    expect(shot.vel.x).toBeGreaterThan(0);
    expect(b.s.mode).toBe('standing');
    for(let t=100;t<101;t+=1/30){f.at(t);f.room.snapshot();}
    expect(b.s.mode).toBe('fallen');
  });
});

describe('shared slope guests', () => {
  it('runs identical skiing physics and knockdown recovery from the same room seed', () => {
    const runs = [{ id: 1, name: 'test', difficulty: 'green', kind: 'line', points: [[0,0,0],[0,0,-20],[0,0,-40],[0,0,-60],[0,0,-80]] }];
    const a = new SlopeSkiers(runs, ground, new ColliderGrid(), 7), b = new SlopeSkiers(runs, ground, new ColliderGrid(), 7);
    for (const sim of [a,b]) sim.advance(.1, [{ x: 0, y: 0, z: -20 }]);
    expect(a.snapshot()).toEqual(b.snapshot()); expect(a.actors().length).toBeGreaterThan(0);
    const target = a.actors()[0]; a.hit({ ...hit, target: target.id }); expect(a.agents[0].st.mode).toBe('fallen');
    for (let i = 0; i < 360; i++) a.advance(1 / 60, [{ x: 0, y: 0, z: -20 }]);
    expect(a.agents.find(s => `npc/${s.id}` === target.id)?.st.mode).not.toBe('fallen');
  });
});
