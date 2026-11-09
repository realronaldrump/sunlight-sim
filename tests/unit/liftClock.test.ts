import { afterEach, describe, expect, it, vi } from 'vitest';
import { LiftClock } from '../../shared/liftClock';
import { Room, loadLifts } from '../../server/src/rooms';
import type { ServerMsg } from '../../shared/protocol';

afterEach(() => vi.restoreAllMocks());
describe('lift speed control', () => {
  it('changes only the selected lift, continuously, then returns to real time at unloading', () => {
    let wall = 1000;
    const clocks = [new LiftClock(() => wall), new LiftClock(() => wall)];
    wall += 10;
    clocks[1].setRate(8, 1090);
    expect(clocks[1].now()).toBe(1010);
    wall += 5;
    expect(clocks.map(c => c.now())).toEqual([1015, 1050]);
    clocks[1].setRate(1);
    expect(clocks[1].now()).toBe(1050);
    wall += 2;
    expect(clocks[1].now()).toBe(1052);
    clocks[1].setRate(8, 1068);
    wall += 50; // a suspended tab cannot keep the lift accelerated past unloading
    expect(clocks[1].now()).toBe(1116);
    expect(clocks[1].rate).toBe(1);
    expect(clocks[0].now()).toBe(wall);
  });

  it('synchronizes accelerated motion across different wall clocks', () => {
    let serverWall = 1000, clientWall = 1200;
    const server = new LiftClock(() => serverWall), client = new LiftClock(() => clientWall);
    server.setRate(8, 1100);
    const packet = server.snapshot();
    serverWall += .2; clientWall += .2;
    client.sync(packet, serverWall);
    expect(client.now()).toBeCloseTo(server.now(), 8);
    serverWall += 20; clientWall += 20;
    expect(client.now()).toBeCloseTo(server.now(), 8);
    expect(client.rate).toBe(1);
  });

  it.each([0, 1, 2])('keeps authoritative seats aligned on lift %i while other lifts and server time remain normal', li => {
    const paths = loadLifts(), path = paths[li], next = path.nextChairAt(path.loadU, 1000);
    let wall = next.arrive;
    vi.spyOn(Date, 'now').mockImplementation(() => wall * 1000);
    const room = new Room('FAST', paths), msgs: ServerMsg[] = [];
    const conn = {send: (m: ServerMsg) => msgs.push(m), close() {}};
    const a = room.join(conn, 'Rider', '#ffffff')!, b = room.join(conn, 'Friend', '#123456')!;
    room.handle(a.id, {type:'liftSpeed',fast:true});
    expect(room.liftClocks[li].rate).toBe(1); // only an actual rider may request speed
    const lp = path.loadPoint();
    for (const p of [a, b]) {
      room.handle(p.id, {type:'state',s:{...p.s,x:lp.x,y:path.stationHeight(false),z:lp.z,heading:lp.heading}});
      room.handle(p.id, {type:'board',lift:li,chair:next.index,seat:0});
    }
    expect(a.ride?.seat).not.toBe(b.ride?.seat);
    room.handle(a.id, {type:'liftSpeed',fast:true});
    wall += 3;
    const snap = room.snapshot();
    expect(snap.type).toBe('snapshot');
    expect(room.liftClocks[li].now()).toBeCloseTo(next.arrive + 24, 7);
    paths.forEach((_, i) => { if (i !== li) expect(room.liftClocks[i].now()).toBe(wall); });
    for (const p of [a, b]) {
      const expected = path.riderPoint(p.ride!.chair,p.ride!.seat,room.liftClocks[li].now()).p;
      expect([p.s.x,p.s.y,p.s.z]).toEqual([expected.x,expected.y,expected.z]);
      expect(p.t).toBe(wall);
    }
    wall = next.arrive + path.rideTime() / 8 + .01;
    room.snapshot();
    expect(a.ride).toBeNull(); expect(b.ride).toBeNull();
    expect(room.seats.size).toBe(0); expect(room.liftClocks[li].rate).toBe(1);
  });

  it('restores normal speed when the requesting rider disconnects', () => {
    const paths = loadLifts(), path = paths[0], next = path.nextChairAt(path.loadU,1000);
    vi.spyOn(Date,'now').mockReturnValue(next.arrive*1000);
    const room = new Room('LEAVE',paths), p = room.join({send() {},close() {}},'Rider','#ffffff')!, lp=path.loadPoint();
    room.handle(p.id,{type:'state',s:{...p.s,x:lp.x,y:path.stationHeight(false),z:lp.z,heading:lp.heading}});
    room.handle(p.id,{type:'board',lift:0,chair:next.index,seat:0});
    room.handle(p.id,{type:'liftSpeed',fast:true}); expect(room.liftClocks[0].rate).toBe(8);
    room.leave(p.id); expect(room.liftClocks[0].rate).toBe(1);
  });
});
