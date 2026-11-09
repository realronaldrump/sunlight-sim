import { beforeAll, describe, expect, it, vi } from 'vitest';
import * as THREE from 'three/webgpu';
import { Player } from '../../client/src/skier/player';
import type { LiftSystem } from '../../client/src/lifts/liftSystem';
import { LiftPath, LOAD_SEAT_HEIGHT } from '../../shared/lifts';
import { LiftStations } from '../../shared/liftStations';
import { ColliderGrid } from '../../shared/collision';
import { loadWorld, makeProbe } from '../harness/world';

const idle = { steer: 0, tuck: false, plow: 0, stop: false, push: false };
vi.mock('../../client/src/skier/skierModel', async () => {
  const { Group } = await import('three/webgpu');
  return { SkierModel: class { root = new Group(); update() {} } };
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
  return { player, path, now: () => clock, at: (t: number, dt = 1 / 30) => { clock = t; player.update(dt, idle); } };
}

describe('Sunlight boarding and riding', () => {
  it('has knee-height snow-to-seat clearance across every load and unload lane', () => {
    for (const p of paths) for (const top of [false, true]) for (let seat = 0; seat < p.def.seats; seat++) {
      const t = (top ? p.unloadU : p.loadU) / p.def.speed;
      const s = p.seatPoint(0, seat, t).p;
      expect(s.y - stations.height(s.x, s.z)).toBeCloseTo(LOAD_SEAT_HEIGHT, 1);
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
    expect(ride.unloadAt - ride.boardedAt).toBeCloseTo(path.rideTime(), 0);
    const seat = ride.seat;
    while (f.now() < ride.unloadAt - 0.1) {
      f.at(Math.min(ride.unloadAt - 0.05, f.now() + 0.1), 0.1);
      expect(player.st.mode).toBe('riding');
      const p = path.riderPoint(ride.chair, seat, f.now()).p;
      expect(player.st.pos).toEqual(p);
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

  it('does not board fallen, airborne, fast, or backward-facing skiers', () => {
    for (const mode of ['fallen', 'air', 'fast', 'backward']) {
      const f = fixture(0), st = f.player.st;
      const n = f.path.nextChairAt(f.path.loadU, f.now());
      f.at(n.arrive - 0.01);
      if (mode === 'fallen' || mode === 'air') { st.mode = mode; st.grounded = mode !== 'air'; }
      if (mode === 'fast') { st.speed = 8; st.vel = { x: f.path.ax * 8, y: 0, z: f.path.az * 8 }; }
      if (mode === 'backward') st.heading += Math.PI;
      f.at(n.arrive + 0.01);
      expect(f.player.ride).toBeNull();
    }
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
});
