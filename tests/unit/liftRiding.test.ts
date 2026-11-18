import { beforeAll, describe, expect, it, vi } from 'vitest';
import * as THREE from 'three/webgpu';
import { Player } from '../../client/src/skier/player';
import { InputManager } from '../../client/src/skier/input';
import type { LiftSystem } from '../../client/src/lifts/liftSystem';
import { LiftPath, LOAD_SEAT_HEIGHT, UNLOAD_WINDOW } from '../../shared/lifts';
import { LiftStations } from '../../shared/liftStations';
import { ColliderGrid } from '../../shared/collision';
import { loadWorld, makeProbe } from '../harness/world';

const idle = { steer: 0, tuck: false, plow: 0, stop: false, push: false };
vi.mock('../../client/src/skier/skierModel', async () => {
  const { Group } = await import('three/webgpu');
  return { SkierModel: class { root = new Group(); update() {} resetSnowballs() {} } };
});
let paths: LiftPath[], stations: LiftStations;
beforeAll(async () => {
  const w = await loadWorld();
  paths = w.resort.lifts.map(d => new LiftPath(d));
  await Promise.all(paths.flatMap(p => [w.hf.ensureArea(0, p.def.bottom[0], -p.def.bottom[2], 80), w.hf.ensureArea(0, p.def.top[0], -p.def.top[2], 80)]));
  stations = new LiftStations(paths, makeProbe(w.hf, w.surface));
});

function fixture(index: number) {
  let clock = 1000;
  const path = paths[index], lp = path.loadPoint();
  lp.x += path.rx * path.seatOffset(Math.floor(path.def.seats / 2));
  lp.z += path.rz * path.seatOffset(Math.floor(path.def.seats / 2));
  const player = new Player(new THREE.Vector3(lp.x, stations.height(lp.x, lp.z), lp.z), lp.heading, stations, new ColliderGrid(), { paths, now: () => clock } as LiftSystem);
  // This suite exercises Player's actual state machine and terrain probe; visual poses have
  // their own model/browser tests and need not be recalculated for every simulated minute.
  player.model.update = () => {};
  return { player, path, now: () => clock, at: (t: number, dt = 1 / 30, input = idle) => { clock = t; player.update(dt, input); } };
}

describe('Sunlight boarding and riding', () => {
  it('keeps every offered stand-up position at ski contact height, then drops the exit away in front', () => {
    for (const p of paths) for (let seat = 0; seat < p.def.seats; seat++) {
      const line = p.hAtS(p.unloadU), lane = p.unloadPoint(seat);
      const snow = (d: number) => stations.height(lane.x + p.ax * d, lane.z + p.az * d);
      for (let d = -UNLOAD_WINDOW.before; d <= UNLOAD_WINDOW.after; d += .25) {
        const t = p.sAtH(line + d) / p.def.speed, cushion = p.seatPoint(0, seat, t).p;
        expect(Math.abs(cushion.y - snow(d) - LOAD_SEAT_HEIGHT), `${p.def.name} seat ${seat} at ${d} m`).toBeLessThan(.115);
      }
      const lip = UNLOAD_WINDOW.after;
      expect(snow(-UNLOAD_WINDOW.before) - snow(-UNLOAD_WINDOW.before - 8)).toBeGreaterThan(.6);
      for (let d = lip + 2; d < lip + 10; d += .5) {
        expect(snow(d) - snow(d + .5)).toBeGreaterThan(.05);
      }
    }
  });

  it('has knee-height snow-to-seat clearance across every load and unload lane', () => {
    for (const p of paths) for (const top of [false, true]) for (let seat = 0; seat < p.def.seats; seat++) {
      const t = (top ? p.unloadU : p.loadU) / p.def.speed;
      const s = p.seatPoint(0, seat, t).p;
      expect(s.y - stations.height(s.x, s.z)).toBeCloseTo(LOAD_SEAT_HEIGHT, 1);
    }
  });

  it('supports the upper operator hut on the groomed shoulder beside the stand line', () => {
    for (const p of paths) {
      const corners = [];
      for (const dh of [-1.9, 1.9]) for (const dr of [-1.9, 1.9]) {
        const rope = p.ropePoint(p.horiz - 3 + dh, 1), across = p.uphillSide * (4.5 + dr);
        corners.push(stations.height(rope.x + p.rx * across, rope.z + p.rz * across));
      }
      expect(Math.max(...corners) - Math.min(...corners)).toBeLessThan(.3);
    }
  });

  it('uses exactly the displayed snow triangles as the physics surface', () => {
    for (const ramp of stations.ramps) {
      for (let i = 1; i < ramp.rows - 1; i += 5) for (let j = 1; j < ramp.cols - 1; j += 3) {
        const a = (i * ramp.cols + j) * 3, b = a + 3, c = a + ramp.cols * 3;
        const p = ramp.positions;
        const x = (p[a] + p[b] + p[c]) / 3, z = (p[a + 2] + p[b + 2] + p[c + 2]) / 3;
        expect(ramp.height(x, z)).toBeCloseTo((p[a + 1] + p[b + 1] + p[c + 1]) / 3, 7);
      }
    }
  });

  for (let index = 0; index < 3; index++) it(`boards and completes a full real-time ride on lift ${index} without skipping`, () => {
    const f = fixture(index), { player, path } = f;
    for (let i = 0; i < 600 && !player.ride; i++) f.at(f.now() + 1 / 30);
    expect(player.ride).not.toBeNull();
    const ride = { ...player.ride! };
    expect(ride.unloadAt - ride.boardedAt).toBeCloseTo(path.remainingRideTime(ride.chair, ride.boardedAt), 6);
    const seat = ride.seat;
    while (f.now() < ride.unloadAt - 0.1) {
      f.at(Math.min(ride.unloadAt - 0.05, f.now() + 0.1), 0.1);
      expect(player.st.mode).toBe('riding');
      const p = path.riderPoint(ride.chair, seat, f.now()).p;
      if (f.now() - ride.boardedAt >= .85) expect(player.st.pos).toEqual(p);
    }
    f.at(ride.unloadAt + 0.01);
    expect(player.ride).toBeNull();
    expect(player.st.mode).toBe('skiing');
    const up = path.unloadPoint(seat);
    expect(player.st.pos.x).toBeCloseTo(up.x, 8);
    expect(player.st.pos.z).toBeCloseTo(up.z, 8);
    expect(player.st.pos.y).toBeCloseTo(stations.height(up.x, up.z), 8);
    expect(player.st.speed).toBeCloseTo(path.def.speed, 8);
    expect(player.model.root.position.x).toBeCloseTo(up.x, 8); // no stale pre-unload state
    for (let i = 0; i < 90; i++) f.at(f.now() + 1 / 30);
    expect(player.st.mode).not.toBe('fallen');
    expect(Math.hypot(player.st.pos.x - up.x, player.st.pos.z - up.z)).toBeGreaterThan(2);
  });

  it('boards after a slow frame and unloads after a whole-loop browser suspension', () => {
    const f = fixture(0);
    const n = f.path.nextChairAt(f.path.loadU, f.now());
    f.at(n.arrive - 0.2);
    f.at(n.arrive + 0.2, 1 / 60); // capped physics dt, actual wall clock is 400 ms later
    expect(f.player.ride?.chair).toBe(n.index);
    f.at(f.now() + f.path.loopLen / f.path.def.speed + 1);
    expect(f.player.ride).toBeNull();
    expect(f.player.st.mode).toBe('skiing');
  });

  it('requires an upright skier facing uphill and does not collect airborne skiers', () => {
    for (const mode of ['fallen', 'air', 'backward']) {
      const f = fixture(0), st = f.player.st;
      const n = f.path.nextChairAt(f.path.loadU, f.now());
      f.at(n.arrive - 1);
      if (mode === 'fallen' || mode === 'air') { st.mode = mode; st.grounded = mode !== 'air'; }
      if (mode === 'air') st.pos.y += 4;
      if (mode === 'backward') st.heading += Math.PI;
      f.at(n.arrive + 0.01);
      expect(f.player.ride).toBeNull();
    }
  });

  it('boards on chair contact away from the stripe without snapping the skier into position', () => {
    for (const offset of [-2, 3]) {
      const f = fixture(0), p = f.player, lp = f.path.loadPoint();
      p.teleport(lp.x + f.path.ax * offset, lp.z + f.path.az * offset, lp.heading);
      const next = f.path.nextChairAt(f.path.sAtH(7 + offset), f.now());
      f.at(next.arrive - .6);
      let before = { ...p.st.pos };
      for (let i = 0; i < 80 && !p.ride; i++) { before = { ...p.st.pos }; f.at(f.now() + 1 / 120, 1 / 120, { ...idle, push: true, steer: .15 }); }
      expect(p.ride, `offset ${offset}`).not.toBeNull();
      expect(Math.hypot(p.st.pos.x - before.x, p.st.pos.y - before.y, p.st.pos.z - before.z)).toBeLessThan(.04);
      const start = { ...p.st.pos }, at = f.now();
      f.at(at + .35);
      expect(p.sitBlend).toBeGreaterThan(.2); expect(p.sitBlend).toBeLessThan(.6);
      expect(Math.hypot(p.st.pos.x - start.x, p.st.pos.z - start.z)).toBeGreaterThan(.5);
      f.at(at + .9);
      expect(p.sitBlend).toBe(1);
      expect(p.st.pos).toEqual(f.path.riderPoint(p.ride!.chair, p.ride!.seat, f.now()).p);
    }
  });

  it('chair contact is authoritative even when the skier has not slowed to a speed threshold', () => {
    const f = fixture(0), n = f.path.nextChairAt(f.path.loadU, f.now());
    f.at(n.arrive - .5);
    f.player.st.speed = 6;
    f.player.st.vel = { x: -f.path.ax * 6, y: 0, z: -f.path.az * 6 };
    f.at(n.arrive - .05);
    expect(f.player.ride).not.toBeNull();
  });

  it('a server seat change preserves continuous loading and rejection restores snow contact', () => {
    const f = fixture(0), n = f.path.nextChairAt(f.path.loadU, f.now());
    const saved = structuredClone(f.player.st);
    f.at(n.arrive - .5); f.at(n.arrive);
    const p = f.player, before = { ...p.st.pos };
    p.confirmSeat((p.ride!.seat + 1) % f.path.def.seats);
    f.at(f.now(), 0);
    expect(p.st.pos).toEqual(before);
    p.rejectBoard(saved);
    expect(p.ride).toBeNull(); expect(p.sitBlend).toBe(0);
    expect(p.st.pos.y).toBeCloseTo(stations.height(p.st.pos.x, p.st.pos.z), 8);
  });

  it('skip exits at the correct seat lane and marks the move as a teleport', () => {
    const f = fixture(1), n = f.path.nextChairAt(f.path.loadU, f.now());
    f.at(n.arrive - 0.01); f.at(n.arrive + 0.01);
    let teleport = false;
    f.player.onUnload = (_l, moved) => { teleport = moved; };
    f.player.skipRide();
    expect(teleport).toBe(true);
    expect(f.player.ride).toBeNull();
    expect(f.player.st.pos.y).toBeCloseTo(stations.height(f.player.st.pos.x, f.player.st.pos.z), 8);
  });

  it('every seat has enough downhill runout to clear the following chair', () => {
    for (let index = 0; index < paths.length; index++) for (let seat = 0; seat < paths[index].def.seats; seat++) {
      const f = fixture(index), n = f.path.nextChairAt(f.path.loadU, f.now());
      f.at(n.arrive);
      f.player.board(index, n.index, seat);
      f.player.skipRide();
      const start = { ...f.player.st.pos };
      for (let frame = 0; frame < 120; frame++) f.at(f.now() + 1 / 30);
      const along = (f.player.st.pos.x - start.x) * f.path.ax + (f.player.st.pos.z - start.z) * f.path.az;
      expect(along, `${f.path.def.name} seat ${seat}`).toBeGreaterThan(4);
      expect(f.player.st.mode).not.toBe('fallen');
    }
  });
});

describe('manual disembark at the top', () => {
  it('consumes held stand controls separately and accepts a fresh brake press after release', () => {
    const surface = new EventTarget(), button = { pressed: true };
    vi.stubGlobal('window', surface); vi.stubGlobal('document', new EventTarget());
    vi.stubGlobal('navigator', { getGamepads: () => [{ connected: true, axes: [], buttons: [button] }] });
    try {
      const input = new InputManager();
      input.keys.add('Space'); input.consumeStandPress();
      expect(input.ski(1 / 60).stop).toBe(false);
      button.pressed = false; input.ski(1 / 60);
      button.pressed = true;
      expect(input.ski(1 / 60).stop).toBe(true);
      button.pressed = false;
      surface.dispatchEvent(Object.assign(new Event('keyup'), { code: 'Space' }));
      input.keys.add('Space');
      expect(input.ski(1 / 60).stop).toBe(true);
    } finally { vi.unstubAllGlobals(); }
  });

  it('stands from any seat at either edge of the window and coasts clear of the turnaround', () => {
    for (const [i, path] of paths.entries()) for (let seat = 0; seat < path.def.seats; seat++) {
      for (const d of [-UNLOAD_WINDOW.before + .01, UNLOAD_WINDOW.after - .01]) {
        const f = fixture(i), player = f.player;
        const n = path.nextChairAt(path.loadU, f.now());
        f.at(n.arrive); player.board(i, n.index, seat); player.autoUnload = false;
        const at = n.arrive + (path.sAtH(path.unloadH + d) - path.loadU) / path.def.speed;
        f.at(at);
        expect(player.standUp()).toBe('ok');
        const root = path.riderPoint(n.index, seat, at).p;
        expect(Math.hypot(root.x - player.st.pos.x, root.z - player.st.pos.z)).toBeLessThan(.001);
        const up = path.unloadPoint(seat);
        for (let frame = 0; frame < 180; frame++) {
          f.at(f.now() + 1 / 30);
          if ((player.st.pos.x - up.x) * path.ax + (player.st.pos.z - up.z) * path.az > 8) break;
        }
        const dx = player.st.pos.x - up.x, dz = player.st.pos.z - up.z;
        expect(dx * path.ax + dz * path.az, `${path.def.name} seat ${seat}, release ${d}`).toBeGreaterThan(8);
        expect(Math.abs(dx * path.rx + dz * path.rz)).toBeLessThan(.8);
        expect(player.st.grounded).toBe(true);
        expect(player.st.mode).toBe('skiing');
        expect(player.sitBlend).toBe(0);
      }
    }
  });

  function nearTop(index: number) {
    const f = fixture(index);
    f.player.autoUnload = false;
    for (let i = 0; i < 600 && !f.player.ride; i++) f.at(f.now() + 1 / 30);
    expect(f.player.ride).not.toBeNull();
    f.at(f.player.ride!.unloadAt - 6, 1 / 30);
    return f;
  }

  for (let index = 0; index < 3; index++) it(`stands up by hand on the ramp of lift ${index} and skis off`, () => {
    const f = nearTop(index), { player, path } = f;
    expect(player.standUp()).toBe('early');
    expect(player.ride).not.toBeNull();
    for (let i = 0; i < 400 && player.unloadPhase() !== 'ready'; i++) f.at(f.now() + 1 / 30);
    expect(player.unloadPhase()).toBe('ready');
    // without a press the chair keeps going: no automatic unload at the old line
    f.at(player.ride!.unloadAt + 0.05);
    expect(player.ride).not.toBeNull();
    expect(player.standUp()).toBe('ok');
    expect(player.ride).toBeNull();
    expect(player.st.mode).toBe('skiing');
    expect(player.st.pos.y).toBeCloseTo(stations.height(player.st.pos.x, player.st.pos.z), 5);
    const start = { ...player.st.pos };
    for (let i = 0; i < 90; i++) f.at(f.now() + 1 / 30);
    expect(player.st.mode).not.toBe('fallen');
    expect(Math.hypot(player.st.pos.x - start.x, player.st.pos.z - start.z)).toBeGreaterThan(2);
    void path;
  });

  for (let index = 0; index < 3; index++) it(`misses the ramp of lift ${index}: loops round the bull wheel, gets flung, yard sale`, () => {
    const f = nearTop(index), { player, path } = f;
    const events: string[] = [];
    player.onMissed = (e) => {
      if (e === 'gate') {
        const u = path.chairU(player.ride!.chair, f.now());
        expect(u).toBeGreaterThanOrEqual(path.detectorU - .0001);
        expect(u - path.detectorU).toBeLessThan(path.def.speed / 30 + .0001);
      }
      events.push(e);
    };
    let maxPitch = 0, landedAt: { x: number; y: number; z: number } | null = null;
    for (let i = 0; i < 30 * 30 && !landedAt; i++) {
      f.at(f.now() + 1 / 30);
      if (player.ride) maxPitch = Math.max(maxPitch, player.chairSwing.pitch);
      if (events.includes('landed')) landedAt = { ...player.st.pos };
    }
    expect(events).toEqual(['gate', 'loops', 'flung', 'landed']);
    expect(maxPitch).toBeGreaterThan(4 * Math.PI);            // two whole loops about the grip
    expect(landedAt).not.toBeNull();
    const top = path.def.top, d = Math.hypot(landedAt!.x - top[0], landedAt!.z - top[2]);
    expect(d).toBeGreaterThan(5); expect(d).toBeLessThan(40);    // beside the station, not across the mountain
    expect(Number.isFinite(landedAt!.y)).toBe(true);
    expect(player.yardSale).toBe(true);
    expect(player.st.mode).toBe('fallen');
    for (let i = 0; i < 300 && player.st.speed > 0.5; i++) f.at(f.now() + 1 / 30);
    expect(player.getUp()).toBe(true);
    for (let i = 0; i < 120; i++) f.at(f.now() + 1 / 30);
    expect(player.yardSale).toBe(false);
  });

  it('warns once about standing up too soon, then the rider jumps off and falls', () => {
    const f = nearTop(0), { player } = f;
    f.at(player.ride!.unloadAt - 60, 1 / 30);                   // mid-ride, high above the snow
    const events: string[] = []; player.onMissed = (e) => events.push(e);
    let jumped = 0; player.onJump = () => { jumped++; };
    expect(player.standUp(false)).toBe('early');
    expect(player.standUp(false)).toBe('early');                 // an older server cannot take a jump
    expect(player.ride).not.toBeNull();
    expect(player.standUp()).toBe('jumped');
    expect(player.ride).toBeNull(); expect(jumped).toBe(1); expect(player.gag).toBe('jump');
    for (let i = 0; i < 30 * 15 && !events.includes('landed'); i++) f.at(f.now() + 1 / 30);
    expect(events).toEqual(['flung', 'landed']);
    expect(player.st.mode).toBe('fallen');
    expect(player.st.pos.y).toBeCloseTo(stations.height(player.st.pos.x, player.st.pos.z), 0);
    // the warning resets for the next ride
    const g = nearTop(0);
    expect(g.player.earlyWarned).toBe(false);
  });

  it('sets a rider down automatically when the option is on or the player is away', () => {
    for (const parked of [false, true]) {
      const f = nearTop(1);
      f.player.autoUnload = !parked;
      const ride = f.player.ride!;
      for (let i = 0; i < 400 && f.player.ride; i++) { const t = f.now() + 1 / 30; f.at(t); if (parked) f.player.update(0, idle, true); }
      expect(f.player.ride).toBeNull();
      expect(f.player.missed).toBeNull();
      expect(f.now()).toBeGreaterThanOrEqual(ride.unloadAt);
    }
  });
});
