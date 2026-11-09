import { describe, expect, it } from 'vitest';
import { isIPhone } from '../../client/src/platform';
import { directFlightInput } from '../../shared/droneTouch';
import { fitPlayerLabel } from '../../client/src/net/playerLabels';
import { PerspectiveCamera, Sprite } from 'three/webgpu';
import { createDrone, FlightArea, stepDrone, type FlightWorld } from '../../shared/dronePhysics';
import { Room, loadLifts } from '../../server/src/rooms';
import type { ServerMsg } from '../../shared/protocol';

const area=new FlightArea([[-1000,0,-1000],[1000,0,-1000],[1000,0,1000],[-1000,0,1000]],0);
const world:FlightWorld={height:()=>2500};
function fly(state:ReturnType<typeof createDrone>, seconds:number, direction:number, pitch=0,hz=60) {
  for(let i=0;i<seconds*hz;i++)stepDrone(state,directFlightInput(direction,pitch),world,area,1/hz);
}
const spawn=()=>createDrone({x:0,y:2518,z:0},0,world,area);

describe('iPhone launch policy',()=>{
  const desktop={userAgent:'Macintosh',platform:'MacIntel',maxTouchPoints:0,screenWidth:390,screenHeight:844};
  it('locks iPhones including desktop-site requests without locking resized desktop windows or iPads',()=>{
    expect(isIPhone({...desktop,userAgent:'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X)'})).toBe(true);
    expect(isIPhone({...desktop,maxTouchPoints:5})).toBe(true);
    expect(isIPhone({...desktop,maxTouchPoints:5,screenWidth:844,screenHeight:390})).toBe(true);
    expect(isIPhone(desktop)).toBe(false);
    expect(isIPhone({...desktop,maxTouchPoints:5,screenWidth:1024,screenHeight:768})).toBe(false);
  });
});

describe('direct phone flight',()=>{
  it('flies forward smoothly, reverses more slowly, and follows the look direction vertically',()=>{
    const s=spawn();fly(s,4,1);expect(s.speed).toBeCloseTo(6,5);expect(s.pos.z).toBeLessThan(-20);
    const reverse=spawn();fly(reverse,4,-1);expect(reverse.speed).toBeCloseTo(3,5);expect(reverse.pos.z).toBeGreaterThan(10);
    const up=spawn();fly(up,4,1,Math.PI/6);expect(up.vel.y).toBeCloseTo(3,5);expect(up.vel.z).toBeCloseTo(-6*Math.cos(Math.PI/6),5);
    const down=spawn();fly(down,2,1,-Math.PI/6);expect(down.pos.y).toBeLessThan(2514);
  });
  it('releasing the button brakes to hover and a short press gives a small nudge',()=>{
    const s=spawn();fly(s,3,1);fly(s,1,0);expect(s.speed).toBeLessThan(.001);
    const parked={...s.pos};fly(s,5,0);expect(s.pos).toEqual(parked);
    const tap=spawn();fly(tap,.1,1);fly(tap,1,0);expect(Math.hypot(tap.pos.x,tap.pos.z)).toBeLessThan(.15);
  });
  it('keeps flight frame-rate independent and obeys existing terrain and ceiling limits',()=>{
    const a=spawn(),b=spawn();fly(a,5,1,.3,60);fly(b,5,1,.3,30);
    expect(a.pos.x).toBeCloseTo(b.pos.x,5);expect(a.pos.y).toBeCloseTo(b.pos.y,5);expect(a.pos.z).toBeCloseTo(b.pos.z,5);
    fly(a,40,1,Math.PI/2);expect(a.agl).toBeLessThanOrEqual(120.0001);
    fly(a,40,1,-Math.PI/2);expect(a.agl).toBeGreaterThanOrEqual(1.3999);
    expect(Object.values(directFlightInput(NaN,Infinity)).filter(v=>typeof v==='number').every(Number.isFinite)).toBe(true);
  });
});

describe('multiplayer name labels',()=>{
  it('limits labels to the same screen height and hides labels inside the camera',()=>{
    const camera=new PerspectiveCamera(68,390/844,.1,1000),label=new Sprite();
    for(const depth of [3,30,300]){
      label.position.set(0,0,-depth);fitPlayerLabel(label,camera,844);
      expect(label.visible).toBe(true);
      expect(label.scale.y/(2*depth*Math.tan(68*Math.PI/360))*844).toBeCloseTo(32,5);
    }
    for(const depth of [.5,800,-10]){label.position.z=-depth;fitPlayerLabel(label,camera,844);expect(label.visible).toBe(false);}
  });
});

describe('drone-only room authority',()=>{
  it('accepts first-frame flight, rejects skiing and boarding, retains flight on malformed updates, and permits map travel',()=>{
    const lifts=loadLifts(),room=new Room('PHONE',lifts),messages:ServerMsg[]=[];
    const p=room.join({send:m=>messages.push(m),close:()=>{}},'Pilot','#123456','drone')!;
    const lp=lifts[0].loadPoint(),s={...p.s,x:lp.x,y:lifts[0].stationHeight(false),z:lp.z,heading:lp.heading};
    const d={x:s.x,y:s.y+20,z:s.z,yaw:0,pitch:0,bank:0,tilt:0,rpm:[5700,5700,5700,5700]};
    room.handle(p.id,{type:'state',s,drone:d});expect(p.drone).toEqual(d);expect(p.s.mode).toBe('drone');
    room.handle(p.id,{type:'state',s:{...s,x:s.x+10,vx:12,mode:'skiing'},drone:null});
    expect(p.s.x).toBe(s.x);expect(p.s.vx).toBe(0);expect(p.s.mode).toBe('drone');expect(p.drone).toEqual(d);
    room.handle(p.id,{type:'board',lift:0,chair:0,seat:0});expect(p.ride).toBeNull();
    expect(messages.some(m=>m.type==='boardRejected' && m.reason==='drone-only session')).toBe(true);
    room.handle(p.id,{type:'state',s,drone:{...d,x:99999}});expect(p.drone).toEqual(d);
    const top=lifts[0].unloadPoint(),next={...s,x:top.x,y:lifts[0].stationHeight(true),z:top.z};
    const flight={...d,x:next.x,y:next.y+20,z:next.z};
    room.handle(p.id,{type:'state',s:next,drone:flight,teleport:true});expect(p.drone).toEqual(flight);expect(p.s.mode).toBe('drone');
    const snap=room.snapshot();expect(snap.type==='snapshot' && snap.players[0].controlMode).toBe('drone');
  });
});
