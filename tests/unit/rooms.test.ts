import { afterEach, describe, it, expect, vi } from 'vitest';
import { Lobby, Room, loadLifts } from '../../server/src/rooms';
import type { ServerMsg } from '../../shared/protocol';

function fakeConn() {
  const msgs: ServerMsg[] = [];
  return { msgs, conn: { send: (m: ServerMsg) => msgs.push(m), close: () => {} } };
}
afterEach(() => vi.restoreAllMocks());

function boardFixture() {
  const lifts = loadLifts(), lift = lifts[0];
  const chair = lift.nextChairAt(lift.loadU, 1000);
  let clock = chair.arrive;
  vi.spyOn(Date, 'now').mockImplementation(() => clock * 1000);
  const room = new Room('RIDE', lifts), lp = lift.loadPoint();
  const join = () => {
    const c = fakeConn(), p = room.join(c.conn, 'Skier', '#123456')!;
    room.handle(p.id, { type: 'state', s: { ...p.s, x: lp.x, z: lp.z, y: lift.stationHeight(false), heading: lp.heading } });
    return { p, c };
  };
  return { room, lift, chair, join, at: (t: number) => { clock = t; } };
}

describe('multiplayer rooms', () => {
  it('joins, welcomes and announces players', () => {
    const lobby = new Lobby(loadLifts());
    const a = fakeConn(), b = fakeConn();
    const ra = lobby.join(a.conn, 'abc12', 'Alice', '#112233')!;
    const rb = lobby.join(b.conn, 'ABC12', 'Bob<script>', '#nothex')!;
    expect(ra.room).toBe(rb.room);
    expect(a.msgs[0].type).toBe('welcome');
    expect(a.msgs.some((m) => m.type === 'joined')).toBe(true);
    const w = b.msgs[0] as Extract<ServerMsg, { type: 'welcome' }>;
    expect(w.players.map((p) => p.name)).toEqual(['Alice']);
    lobby.tick();
    const snap = a.msgs.filter((m) => m.type === 'snapshot').at(-1) as Extract<ServerMsg, { type: 'snapshot' }>;
    expect(snap.players.find((p) => p.id === rb.id)!.name).toBe('Bobscript');
    expect(snap.players.find((p) => p.id === rb.id)!.color).toBe('#d33a2c');
  });

  it('limits rooms to 8 players', () => {
    const lobby = new Lobby(loadLifts());
    for (let i = 0; i < 8; i++) expect(lobby.join(fakeConn().conn, 'FULL1', 'P' + i, '#ffffff')).not.toBeNull();
    const c = fakeConn();
    expect(lobby.join(c.conn, 'FULL1', 'late', '#ffffff')).toBeNull();
    expect(c.msgs[0].type).toBe('error');
  });

  it('rejects implausible jumps but accepts flagged teleports', () => {
    const room = new Room('X', loadLifts());
    const a = fakeConn();
    const p = room.join(a.conn, 'A', '#123456')!;
    const s = { x: 10, y: 2500, z: 10, heading: 0, vx: 0, vy: 0, vz: 0, mode: 'skiing', edge: 0, plow: 0, tuck: 0, fallen: 0 };
    room.handle(p.id, { type: 'state', s });
    room.handle(p.id, { type: 'state', s: { ...s, x: 900 } });
    expect(a.msgs.some((m) => m.type === 'correct')).toBe(true);
    expect(room.players.get(p.id)!.s.x).toBe(10);
    room.handle(p.id, { type: 'state', s: { ...s, x: 900 }, teleport: true });
    expect(room.players.get(p.id)!.s.x).toBe(900);
  });

  it('assigns seats on one chair to friends and rejects boarding a chair away from the load line', () => {
    const { room, lift, chair, join } = boardFixture();
    const a = join(), b = join();
    for (const q of [a, b]) room.handle(q.p.id, { type: 'board', lift: 0, chair: chair.index, seat: 1 });
    expect(a.p.ride?.chair).toBe(chair.index);
    expect(b.p.ride?.chair).toBe(chair.index);
    expect(a.p.ride?.seat).not.toBe(b.p.ride?.seat);
    room.snapshot();
    expect(Math.hypot(a.p.s.x - b.p.s.x, a.p.s.z - b.p.s.z)).toBeCloseTo(0.6, 7);
    const far = (chair.index + Math.floor(lift.chairCount / 2)) % lift.chairCount;
    const c = join();
    room.handle(c.p.id, { type: 'board', lift: 0, chair: far, seat: 0 });
    expect(c.c.msgs.some(m => m.type === 'boardRejected')).toBe(true);
  });

  it('rejects distant, fallen, airborne, fast, backward and invalid boarding requests', () => {
    const { room, lift, chair, join } = boardFixture();
    for (const bad of ['distance', 'height', 'fallen', 'air', 'speed', 'heading', 'chair', 'seat']) {
      const { p, c } = join();
      if (bad === 'distance') p.s.x += 100;
      if (bad === 'height') p.s.y += 10;
      if (bad === 'fallen' || bad === 'air') p.s.mode = bad;
      if (bad === 'speed') p.s.vx = 10;
      if (bad === 'heading') p.s.heading += Math.PI;
      room.handle(p.id, { type: 'board', lift: 0, chair: bad === 'chair' ? lift.chairCount : chair.index, seat: bad === 'seat' ? -1 : 0 });
      expect(p.ride, bad).toBeNull();
      expect(c.msgs.at(-1)?.type, bad).toBe('boardRejected');
      room.leave(p.id);
    }
  });

  it('rejects a full chair, preserves existing seats, and reuses a released seat', () => {
    const { room, lift, chair, join } = boardFixture();
    const riders = Array.from({ length: lift.def.seats + 1 }, join);
    for (const r of riders) room.handle(r.p.id, { type: 'board', lift: 0, chair: chair.index, seat: 0 });
    expect(riders.at(-1)!.p.ride).toBeNull();
    expect(new Set(riders.slice(0, -1).map(r => r.p.ride?.seat)).size).toBe(lift.def.seats);
    const original = { ...riders[0].p.ride! };
    room.handle(riders[0].p.id, { type: 'board', lift: 0, chair: (chair.index + 1) % lift.chairCount, seat: 0 });
    expect(riders[0].p.ride).toEqual(original);
    room.leave(riders[0].p.id);
    room.handle(riders.at(-1)!.p.id, { type: 'board', lift: 0, chair: chair.index, seat: 0 });
    expect(riders.at(-1)!.p.ride?.seat).toBe(original.seat);
  });

  it('unloads at the actual unload line, restores skiing, and releases all seat occupancy', () => {
    const f = boardFixture(), { p } = f.join();
    f.room.handle(p.id, { type: 'board', lift: 0, chair: f.chair.index, seat: 0 });
    f.at(f.chair.arrive + f.lift.rideTime() - 0.1); f.room.snapshot();
    expect(p.ride).not.toBeNull();
    f.at(f.chair.arrive + f.lift.rideTime() + 0.1); f.room.snapshot();
    expect(p.ride).toBeNull();
    expect(p.s.mode).toBe('skiing');
    expect(p.s.x).toBeCloseTo(f.lift.unloadPoint(0).x, 8);
    expect(p.s.y).toBeCloseTo(f.lift.stationHeight(true), 8);
    expect(f.room.seats.size).toBe(0);
  });

  it('relays sanitized chat', () => {
    const room = new Room('Z', loadLifts());
    const a = fakeConn(), b = fakeConn();
    const pa = room.join(a.conn, 'A', '#123456')!; room.join(b.conn, 'B', '#123456');
    room.handle(pa.id, { type: 'chat', text: 'hi\u0007 there' });
    const m = b.msgs.find((x) => x.type === 'chat') as Extract<ServerMsg, { type: 'chat' }>;
    expect(m.text).toBe('hi there');
  });
});
