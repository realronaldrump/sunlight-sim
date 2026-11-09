import { describe, expect, it } from 'vitest';
import { isIPhone } from '../../client/src/platform';
import { DroneNavigation } from '../../shared/droneNavigation';
import { createDrone, FlightArea, stepDrone, type FlightWorld } from '../../shared/dronePhysics';
import { Room, loadLifts } from '../../server/src/rooms';
import type { ServerMsg } from '../../shared/protocol';

const area=new FlightArea([[-1000,0,-1000],[1000,0,-1000],[1000,0,1000],[-1000,0,1000]],0);
const world:FlightWorld={height:()=>2500};
function navigate(hz:number, terrain=world) {
  const drone=createDrone({x:0,y:2520,z:0},0,terrain,area), nav=new DroneNavigation();
  nav.pace='cruise'; nav.setTarget({x:25,y:2520,z:-45},terrain,area);
  for(let i=0;i<30*hz;i++)stepDrone(drone,nav.input(drone,terrain,1/hz),terrain,area,1/hz);
  return {drone,nav};
}

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

describe('tap to fly navigation',()=>{
  it('arrives without oscillation across frame rates and holds position after arrival',()=>{
    const a=navigate(60), b=navigate(20);
    for(const {nav,drone} of [a,b]){
      expect(nav.target).toBeNull();expect(nav.message).toBe('Arrived · hovering');
      expect(Math.hypot(drone.pos.x-25,drone.pos.z+45)).toBeLessThan(1);
      expect(drone.speed).toBeLessThan(.01);
    }
    expect(Math.hypot(a.drone.pos.x-b.drone.pos.x,a.drone.pos.z-b.drone.pos.z)).toBeLessThan(.2);
  });
  it('climbs over a roof using existing obstacles and never enters it',()=>{
    const terrain:FlightWorld={...world,obstacles:()=>[{type:'box',x:0,z:-15,hx:5,hz:3,top:2528}]};
    const drone=createDrone({x:0,y:2514,z:0},0,terrain,area),nav=new DroneNavigation();
    nav.pace='cruise';nav.setTarget({x:0,y:2514,z:-30},terrain,area);
    for(let i=0;i<60*40;i++){
      stepDrone(drone,nav.input(drone,terrain,1/60),terrain,area,1/60);
      if(Math.abs(drone.pos.z+15)<3.4)expect(drone.pos.y).toBeGreaterThan(2528);
    }
    expect(nav.target).toBeNull();expect(drone.pos.z).toBeLessThan(-29);
  });
  it('stops and explains an unreachable route and keeps taps within flight bounds',()=>{
    const terrain:FlightWorld={...world,ready:()=>false},drone=createDrone({x:0,y:2514,z:0},0,terrain,area),nav=new DroneNavigation();
    nav.setTarget({x:5000,y:4000,z:0},terrain,area);expect(area.contains(nav.target!.x,nav.target!.z)).toBe(true);
    expect(nav.target!.y).toBeLessThanOrEqual(2618);
    nav.setTarget({x:20,y:2514,z:0},terrain,area);
    for(let i=0;i<600;i++)stepDrone(drone,nav.input(drone,terrain,1/60),terrain,area,1/60);
    expect(nav.target).toBeNull();expect(nav.message).toContain('Path blocked');expect(drone.pos.x).toBe(0);
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
