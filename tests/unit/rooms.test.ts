import { describe, it, expect } from 'vitest';
import { Lobby, Room, loadLifts } from '../../server/src/rooms';
import type { ServerMsg } from '../../shared/protocol';

function fakeConn() {
  const msgs: ServerMsg[] = [];
  return { msgs, conn: { send: (m: ServerMsg) => msgs.push(m), close: () => {} } };
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
    const lifts = loadLifts();
    const room = new Room('Y', lifts);
    const a = fakeConn(), b = fakeConn();
    const pa = room.join(a.conn, 'A', '#123456')!, pb = room.join(b.conn, 'B', '#654321')!;
    const lift = lifts[0];
    const t = Date.now() / 1000;
    const next = lift.nextChairAt(lift.loadU, t);
    // the chair arriving now-ish is accepted (within tolerance)
    room.handle(pa.id, { type: 'board', lift: 0, chair: next.index, seat: 1 });
    room.handle(pb.id, { type: 'board', lift: 0, chair: next.index, seat: 1 });
    const ra = room.players.get(pa.id)!.ride, rb = room.players.get(pb.id)!.ride;
    if (next.arrive - t < 2.0) {
      expect(ra?.chair).toBe(next.index);
      expect(rb?.chair).toBe(next.index);
      expect(ra?.seat).not.toBe(rb?.seat);
    }
    // a chair halfway up the lift is rejected
    const far = (next.index + Math.floor(lift.chairCount / 2)) % lift.chairCount;
    const c = fakeConn(); const pc = room.join(c.conn, 'C', '#000000')!;
    room.handle(pc.id, { type: 'board', lift: 0, chair: far, seat: 0 });
    expect(c.msgs.some((m) => m.type === 'boardRejected')).toBe(true);
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
