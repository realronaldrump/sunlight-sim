import * as THREE from 'three/webgpu';
import { createDrone, droneObstacle, FlightArea, stepDrone, type DroneInput, type DroneState, type FlightWorld } from '../../../shared/dronePhysics';
import type { Vec3 } from '../../../shared/skiPhysics';
import { DroneModel } from './droneModel';
import { DroneAudio } from './droneAudio';
import { DroneHud } from './droneHud';

export class DroneSystem {
  state: DroneState | null = null;
  fpv = false;
  controlsEnabled = true;
  readonly model = new DroneModel();
  readonly audio = new DroneAudio();
  readonly hud = new DroneHud();
  private oldFov = 62;
  private oldNear = .25;
  private dragging = false;
  private lastX = 0; private lastY = 0;
  private wall: THREE.LineSegments;
  private cameraPosition = new THREE.Vector3();
  private cameraReady = false;
  constructor(readonly area: FlightArea,readonly world: FlightWorld,private camera: THREE.PerspectiveCamera,private dom: HTMLElement,scene: THREE.Scene) {
    this.model.root.visible = false; scene.add(this.model.root);
    const lines: number[] = [];
    for (let x = -18; x <= 18; x += 3) lines.push(x,-4,0,x,8,0);
    for (let y = -4; y <= 8; y += 3) lines.push(-18,y,0,18,y,0);
    this.wall = new THREE.LineSegments(new THREE.BufferGeometry().setAttribute('position',new THREE.Float32BufferAttribute(lines,3)),
      new THREE.LineBasicNodeMaterial({color:0xffb465,transparent:true,opacity:0,depthWrite:false}));
    this.wall.name = 'drone-flight-boundary'; this.wall.visible = false; scene.add(this.wall);
    dom.addEventListener('pointerdown',e => { if (!this.state || !this.controlsEnabled || e.button !== 0) return; this.dragging = true; this.lastX=e.clientX;this.lastY=e.clientY; });
    window.addEventListener('pointerup',() => { this.dragging=false; });
    window.addEventListener('blur',() => { this.dragging=false; if(this.state) this.state.vel={x:0,y:0,z:0}; });
    window.addEventListener('pointermove',e => {
      if (!this.state || !this.controlsEnabled || (!this.dragging && document.pointerLockElement !== dom)) return;
      const locked = document.pointerLockElement === dom;
      const dx = locked ? e.movementX : e.clientX-this.lastX, dy = locked ? e.movementY : e.clientY-this.lastY;
      this.lastX=e.clientX; this.lastY=e.clientY;
      this.state.yaw -= dx*.003;
      this.state.pitch=THREE.MathUtils.clamp(this.state.pitch-dy*.003,-Math.PI*.49,Math.PI*.38);
    });
    dom.addEventListener('dblclick',() => {
      if (!this.state || !this.controlsEnabled || !dom.requestPointerLock) return;
      try { const pending = dom.requestPointerLock(); if (pending) void pending.catch(() => {}); } catch { /* Drag look works without pointer lock. */ }
    });
  }
  get active() { return !!this.state; }
  enter(pos: Vec3,yaw: number) {
    this.oldFov=this.camera.fov; this.oldNear=this.camera.near;
    this.recall(pos,yaw); this.camera.fov=68;this.camera.near=.08;this.camera.updateProjectionMatrix();
  }
  recall(pos: Vec3,yaw: number) {
    this.state=createDrone({x:pos.x,y:pos.y+7,z:pos.z},yaw,this.world,this.area);
    // Take off above nearby station roofs rather than inside their collision volumes.
    const tops = this.world.obstacles?.(this.state.pos.x,this.state.pos.z) ?? [];
    for(const c of tops) if(Math.hypot(c.x-this.state.pos.x,c.z-this.state.pos.z)<(c.r ?? Math.hypot(c.hx ?? 0,c.hz ?? 0))+1) this.state.pos.y=Math.max(this.state.pos.y,c.top+2);
    this.state.agl=this.state.pos.y-this.world.height(this.state.pos.x,this.state.pos.z);
    this.cameraReady=false;
  }
  exit() {
    this.state=null;this.model.root.visible=false;this.wall.visible=false;this.dragging=false;
    if(document.pointerLockElement===this.dom) document.exitPointerLock();
    this.camera.fov=this.oldFov;this.camera.near=this.oldNear;this.camera.updateProjectionMatrix();
  }
  cycleCamera() { this.fpv=!this.fpv;this.cameraReady=false; }
  update(dt: number,input: DroneInput) {
    const s=this.state;if(!s)return;
    if(!this.controlsEnabled) { this.dragging=false;if(document.pointerLockElement===this.dom)document.exitPointerLock(); }
    stepDrone(s,input,this.world,this.area,dt);
    this.model.update(dt,s);this.model.root.visible=!this.fpv;
    const cp=Math.cos(s.pitch),dir=new THREE.Vector3(-Math.sin(s.yaw)*cp,Math.sin(s.pitch),-Math.cos(s.yaw)*cp);
    const p=new THREE.Vector3(s.pos.x,s.pos.y,s.pos.z);
    if(this.fpv) { this.camera.position.copy(p);this.camera.rotation.set(s.pitch,s.yaw,0,'YXZ'); }
    else {
      const desired=p.clone().addScaledVector(dir,-1.65).add(new THREE.Vector3(0,.55,0));
      desired.y=Math.max(desired.y,this.world.height(desired.x,desired.z)+.7);
      this.area.constrain(desired);
      const safe=p.clone();
      for(let i=1;i<=12;i++) {
        const point=p.clone().lerp(desired,i/12);
        if(point.y<this.world.height(point.x,point.z)+.35 || this.world.obstacles?.(point.x,point.z).some(c=>droneObstacle(point,c,.12)))break;
        safe.copy(point);
      }
      desired.copy(safe);
      if(!this.cameraReady)this.cameraPosition.copy(desired);
      this.cameraPosition.lerp(desired,1-Math.exp(-10*dt));
      this.cameraPosition.y=Math.max(this.cameraPosition.y,this.world.height(this.cameraPosition.x,this.cameraPosition.z)+.7);
      this.camera.position.copy(this.cameraPosition);this.camera.lookAt(p.clone().addScaledVector(dir,2));
      this.model.root.visible=this.camera.position.distanceTo(p)>.55;
    }
    this.cameraReady=true;
    const near=this.area.nearest(s.pos.x,s.pos.z);
    this.wall.visible=near.remaining<35;
    if(this.wall.visible) {
      const dx=near.inside ? near.x-s.pos.x : s.pos.x-near.x, dz=near.inside ? near.z-s.pos.z : s.pos.z-near.z;
      const d=Math.max(.001,Math.hypot(dx,dz)),nx=dx/d,nz=dz/d;
      this.wall.position.set(near.x+nx*this.area.margin,s.pos.y,near.z+nz*this.area.margin);
      this.wall.rotation.y=Math.atan2(nx,nz);
      (this.wall.material as THREE.LineBasicNodeMaterial).opacity=.45*Math.max(0,1-near.remaining/35);
    }
  }
}
