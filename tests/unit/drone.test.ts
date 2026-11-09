import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { createDrone, DRONE, FlightArea, NO_DRONE_INPUT, stepDrone, type DroneInput, type FlightWorld } from '../../shared/dronePhysics';
import { DroneModel } from '../../client/src/drone/droneModel';
import { Box3 } from 'three/webgpu';
import { Room, loadLifts } from '../../server/src/rooms';
import type { NetDrone, ServerMsg } from '../../shared/protocol';
const area=new FlightArea([[-1000,0,-1000],[1000,0,-1000],[1000,0,1000],[-1000,0,1000]],0);
const flat: FlightWorld={height:()=>2500};
const spawn=()=>createDrone({x:0,y:2510,z:0},0,flat,area);
function fly(s:ReturnType<typeof spawn>,seconds:number,input:Partial<DroneInput>,world=flat,bounds=area,hz=60) {
  for(let i=0;i<seconds*hz;i++)stepDrone(s,{...NO_DRONE_INPUT,...input},world,bounds,1/hz);
}
describe('stabilized drone flight',()=>{
  it('accelerates, caps diagonal speed, brakes to a stable hover and is frame-rate independent',()=>{
    const a=spawn(),b=spawn();fly(a,5,{forward:1,right:1,fast:true});fly(b,5,{forward:1,right:1,fast:true},flat,area,30);
    expect(a.speed).toBeCloseTo(DRONE.fastSpeed,5);expect(a.pos.x).toBeCloseTo(b.pos.x,5);
    expect(a.pos.z).toBeCloseTo(b.pos.z,5);expect(a.tilt).toBeLessThan(0);expect(a.bank).toBeLessThan(0);
    fly(a,3,{brake:true});expect(a.speed).toBeLessThan(.001);
    const p={...a.pos};fly(a,10,{});expect(a.pos).toEqual(p);
  });
  it('uses heading-relative motion and does not fly vertically when looking down',()=>{
    const s=spawn();s.yaw=Math.PI/2;s.pitch=-1.5;fly(s,3,{forward:1});
    expect(s.pos.x).toBeLessThan(-20);expect(Math.abs(s.pos.z)).toBeLessThan(.001);expect(s.pos.y).toBe(2510);
  });
  it('limits altitude, clears sloped terrain and never tunnels through a thin tree',()=>{
    const s=spawn();fly(s,35,{up:1});expect(s.agl).toBe(DRONE.ceiling);expect(s.warning).toBe('ceiling');
    fly(s,40,{up:-1});expect(s.agl).toBeCloseTo(DRONE.clearance,8);
    const tree: FlightWorld={...flat,obstacles:()=>[{type:'cyl',x:0,z:-9,r:.09,top:2530}]};
    const t=spawn();fly(t,5,{forward:1,fast:true},tree,area,10);
    expect(t.pos.z).toBeGreaterThan(-9);expect(t.warning).toBe('obstacle');
    fly(t,6,{up:1},tree);fly(t,3,{forward:1},tree);expect(t.pos.z).toBeLessThan(-20);
    const hill:FlightWorld={height:(_x,z)=>2500-z*.6};const h=spawn();fly(h,8,{forward:1},hill);
    expect(h.pos.y).toBeGreaterThanOrEqual(hill.height(h.pos.x,h.pos.z)+DRONE.clearance-1e-7);
  });
  it('blocks a roof descent and rotated building and holds when fine terrain is missing',()=>{
    const box:FlightWorld={...flat,obstacles:()=>[{type:'box',x:0,z:-5,hx:4,hz:2,yaw:.6,top:2520}]};
    const s=spawn();fly(s,4,{forward:1},box);expect(s.warning).toBe('obstacle');expect(s.pos.z).toBeGreaterThan(-5);
    const roof=createDrone({x:0,y:2525,z:-5},0,flat,area);fly(roof,3,{up:-1},box);expect(roof.pos.y).toBeGreaterThan(2520);
    const missing:FlightWorld={...flat,ready:(_x,z)=>z>-6};const t=spawn();fly(t,4,{forward:1},missing);
    expect(t.warning).toBe('loading');expect(t.pos.z).toBeGreaterThan(-6);
  });
  it('constrains a concave ski-area polygon and handles outside launch points',()=>{
    const concave=new FlightArea([[0,0,0],[100,0,0],[100,0,40],[40,0,40],[40,0,100],[0,0,100]],4);
    expect(concave.contains(20,80)).toBe(true);expect(concave.contains(80,80)).toBe(false);
    const s=createDrone({x:80,y:2510,z:80},0,flat,concave);expect(concave.contains(s.pos.x,s.pos.z)).toBe(true);
    fly(s,20,{right:1,forward:-1,fast:true},flat,concave,10);expect(concave.contains(s.pos.x,s.pos.z)).toBe(true);expect(s.warning).toBe('boundary');
  });
  it('covers the real base and every lift while excluding surrounding valleys',()=>{
    const r=JSON.parse(readFileSync('client/public/world/resort.json','utf8')),bounds=new FlightArea(r.boundary);
    for(const l of r.lifts)for(const p of [l.bottom,l.top])expect(bounds.contains(p[0],p[2]),l.name).toBe(true);
    expect(bounds.contains(5000,5000)).toBe(false);
  });
  it('models four separate propellers at handheld scale with finite flight poses',()=>{
    const model=new DroneModel();expect(model.rotors).toHaveLength(4);
    const box=new Box3().setFromObject(model.root);expect(box.max.x-box.min.x).toBeGreaterThan(.4);expect(box.max.x-box.min.x).toBeLessThan(.6);
    const s=spawn();fly(s,4,{forward:1,right:1,up:1});model.update(.1,s);
    expect(model.rotors[0].rotation.y*model.rotors[1].rotation.y).toBeLessThan(0);
    model.root.traverse(o=>{o.updateMatrixWorld();expect(o.matrixWorld.elements.every(Number.isFinite)).toBe(true);});model.dispose();
  });
});

describe('multiplayer drone state',()=>{
  it('keeps skier authority separate, rejects malformed/out-of-area flight and clears a recalled drone',()=>{
    const lifts=loadLifts(),room=new Room('DRONE',lifts),messages:ServerMsg[]=[];
    const p=room.join({send:m=>messages.push(m),close:()=>{}},'Pilot','#123456')!;
    const lp=lifts[0].loadPoint();const s={...p.s,x:lp.x,y:lifts[0].stationHeight(false),z:lp.z};
    room.handle(p.id,{type:'state',s,teleport:true});
    const d:NetDrone={x:s.x,y:s.y+8,z:s.z,yaw:0,pitch:0,bank:0,tilt:0,rpm:[5700,5700,5700,5700]};
    room.handle(p.id,{type:'state',s,drone:d});expect(p.drone).toEqual(d);expect(p.s.y).toBe(s.y);
    room.handle(p.id,{type:'state',s,drone:{...d,x:5000}});expect(p.drone).toEqual(d);
    room.handle(p.id,{type:'state',s,drone:{...d,rpm:[NaN,0,0,0]}});expect(p.drone).toEqual(d);
    const snap=room.snapshot();expect(snap.type).toBe('snapshot');
    if(snap.type==='snapshot')expect(snap.players[0].drone).toEqual(d);
    room.handle(p.id,{type:'state',s,drone:null});expect(p.drone).toBeNull();
  });
});
