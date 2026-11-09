// Sunlight-specific architecture. Roof outlines are measured from OSM/NAIP;
// elevations, facade modules and deck dimensions are photo-based estimates (DECISIONS.md).
import * as THREE from 'three/webgpu';
import { mx_noise_float, positionWorld, vec3 } from 'three/tsl';
import type { ColliderGrid } from '../../../shared/collision';

export interface BuildingDef { id: number; name: string; levels: number; base: number; points: number[][]; style?: string; roofElevation?: number }
const wall = new THREE.MeshStandardNodeMaterial({color:0xd1c8a6,roughness:0.95});
const timber = new THREE.MeshStandardNodeMaterial({color:0x493327,roughness:0.93});
const redwood = new THREE.MeshStandardNodeMaterial({color:0x754538,roughness:0.91});
const deckMat = new THREE.MeshStandardNodeMaterial({color:0x8b7056,roughness:0.96});
const concrete = new THREE.MeshStandardNodeMaterial({color:0x7d7871,roughness:0.98});
const glass = new THREE.MeshPhysicalNodeMaterial({color:0x283e47,metalness:0.35,roughness:0.18,clearcoat:0.8});
const snow = new THREE.MeshStandardNodeMaterial({color:0xe9eff5,roughness:0.9});
const roofMetal = new THREE.MeshStandardNodeMaterial({color:0x727b7b,roughness:0.65,metalness:0.3});
const black = new THREE.MeshStandardNodeMaterial({color:0x202329,roughness:0.7});

// World-scale grain and weathering keep close facades from reading as flat plastic.
for(const mat of [timber,redwood,deckMat]) {
  const grain=mx_noise_float(positionWorld.mul(vec3(18,.65,18))).mul(.07).add(.93);
  mat.colorNode=vec3(mat.color.r,mat.color.g,mat.color.b).mul(grain);
}
for(const mat of [wall,concrete]) {
  const grain=mx_noise_float(positionWorld.mul(24)).mul(.025).add(.975);
  mat.colorNode=vec3(mat.color.r,mat.color.g,mat.color.b).mul(grain);
}

function box(g: THREE.Object3D, w:number,h:number,d:number,x:number,y:number,z:number,mat:THREE.Material) {
  const m=new THREE.Mesh(new THREE.BoxGeometry(w,h,d),mat);m.position.set(x,y,z);m.castShadow=true;m.receiveShadow=true;g.add(m);return m;
}
function beam(g:THREE.Object3D,a:THREE.Vector3,b:THREE.Vector3,r:number,mat=timber) {
  const delta=b.clone().sub(a),m=new THREE.Mesh(new THREE.CylinderGeometry(r,r,delta.length(),8),mat);
  m.position.copy(a).add(b).multiplyScalar(.5);m.quaternion.setFromUnitVectors(new THREE.Vector3(0,1,0),delta.normalize());m.castShadow=true;g.add(m);
}
function railing(g:THREE.Object3D,x0:number,z0:number,x1:number,z1:number,y:number,log=false) {
  const L=Math.hypot(x1-x0,z1-z0), n=Math.ceil(L/(log?2.2:1.8));
  for(let i=0;i<=n;i++){const k=i/n;box(g,.11,1.05,.11,x0+(x1-x0)*k,y+.525,z0+(z1-z0)*k,timber);}
  for(const h of log?[.45,.98]:[.12,1.02])beam(g,new THREE.Vector3(x0,y+h,z0),new THREE.Vector3(x1,y+h,z1),log?.055:.035);
  if(!log)for(let d=.2;d<L;d+=.18){const k=d/L;box(g,.035,.8,.035,x0+(x1-x0)*k,y+.57,z0+(z1-z0)*k,deckMat);}
}
function windowBay(g:THREE.Object3D,x:number,y:number,z:number,w:number,h:number,yaw=0) {
  const frame=new THREE.Group();frame.position.set(x,y,z);frame.rotation.y=yaw;g.add(frame);
  box(frame,w+.15,h+.15,.12,0,0,0,timber);
  box(frame,w,h,.025,0,0,.071,glass);
  box(frame,.055,h,.045,0,0,.10,timber);
  box(frame,w,.05,.045,0,h*.12,.10,timber);
}
function label(g:THREE.Object3D,text:string,w:number,h:number,x:number,y:number,z:number,yaw=0) {
  const c=document.createElement('canvas');c.width=1024;c.height=256;const ctx=c.getContext('2d')!;
  ctx.fillStyle='#ddd3aa';ctx.fillRect(0,0,1024,256);ctx.fillStyle='#272a28';ctx.font='bold 130px Helvetica,Arial,sans-serif';ctx.textAlign='center';ctx.textBaseline='middle';ctx.fillText(text,512,135,960);
  const tex=new THREE.CanvasTexture(c);tex.colorSpace=THREE.SRGBColorSpace;
  const m=new THREE.Mesh(new THREE.PlaneGeometry(w,h),new THREE.MeshStandardNodeMaterial({map:tex,roughness:.9}));m.position.set(x,y,z);m.rotation.y=yaw;g.add(m);
}
function table(g:THREE.Object3D,x:number,z:number,y:number) {
  box(g,1.6,.09,.78,x,y+.72,z,deckMat);
  for(const side of [-1,1]){
    box(g,1.7,.07,.27,x,y+.43,z+side*.62,deckMat);
    for(const off of [-.55,.55])beam(g,new THREE.Vector3(x+off,y,z+side*.62),new THREE.Vector3(x+off,y+.72,z+side*.22),.045);
  }
}

/** Main lodge: low cream walls, west-facing glass wall, timber deck, lower service level and roof plant. */
function lodge(b:BuildingDef,height:(x:number,z:number)=>number,colliders:ColliderGrid) {
  const g=new THREE.Group();g.name=b.name;
  // Local X follows the long west facade, local +Z faces the ski slope to the west.
  const yaw=-1.83,cx=112.5,cz=-960.5;
  const deckY=b.roofElevation ? b.roofElevation-3.69 : height(100,-957)+.25;
  g.position.set(cx,deckY,cz);g.rotation.y=yaw;
  box(g,31,3.35,14.5,0,1.675,0,wall);
  box(g,31,2.8,14.5,0,-1.4,0,concrete);
  // Shallow roof pitch and overhanging snow cap, as shown in the main-lodge reference.
  box(g,33,.28,16,0,3.55,0,roofMetal);
  box(g,32.8,.17,15.7,0,3.75,0,snow);
  box(g,11.2,.38,.18,8,3.28,7.93,redwood);
  // A short solid signed bay, then full-height windows and doors toward the deck.
  label(g,'sunlight',5.4,1.4,-10.6,2.1,7.27);
  for(let i=0;i<7;i++){
    const x=-5.5+i*2.65;
    windowBay(g,x,1.83,7.31,2.24,2.7);
    box(g,.20,3.8,.22,x-1.3,1.9,7.95,redwood);
  }
  // Sun deck and visible board spacing. It ends at the lodge, not at an invented mountain-facing building.
  box(g,32,.24,5.0,0,-.13,9.6,deckMat);
  for(let x=-15.7;x<16;x+=.16)box(g,.012,.012,4.9,x,.001,9.6,timber);
  railing(g,-16,12.0,16,12.0,0,true);railing(g,-16,7.4,-16,12,0,true);
  for(const x of [-6,-2,2,6,10])table(g,x,10,0);
  // Downhill access stairs toward the parking side.
  for(let i=0;i<15;i++)box(g,2.8,.20,.32,17.3,-i*.19,8.3-i*.29,deckMat);
  beam(g,new THREE.Vector3(15.9,1,8.3),new THREE.Vector3(15.9,-1.66,4.24),.05);
  beam(g,new THREE.Vector3(18.7,1,8.3),new THREE.Vector3(18.7,-1.66,4.24),.05);
  for(const x of [-13,-5,3,11])box(g,.25,2.4,.25,x,-1.2,11.7,timber);
  // Service core visible above the rear roof, plus small roof exhausts.
  box(g,7,2.3,4.8,7.8,4.75,-3.8,wall);box(g,7.4,.18,5.2,7.8,5.95,-3.8,snow);
  for(const x of [-10,-4,1]){box(g,.6,.9,.6,x,4.2,-1,roofMetal);box(g,.9,.12,.9,x,4.7,-1,roofMetal);}
  for(const x of [-11,-4,3,10])windowBay(g,x,-1,-7.3,1.5,1.2,Math.PI);
  // Small cafe/service wing beside the deck, visible in NAIP and the reference photo.
  box(g,7,2.7,7,7,1.35,8.8,wall);box(g,7.5,.22,7.6,7,2.85,8.8,snow);
  windowBay(g,7,1.55,12.32,4.8,1.7);
  colliders.add({type:'box',x:cx,z:cz,hx:15.5,hz:7.25,yaw,top:deckY+3.4});
  return g;
}

/** Brettelberg's long, timber-framed gable and exterior galleries, on its OSM footprint. */
function condos(b:BuildingDef,height:(x:number,z:number)=>number,colliders:ColliderGrid) {
  const g=new THREE.Group();g.name=b.name;
  const [a,c]=[b.points[1],b.points[0]],L=Math.hypot(c[0]-a[0],c[1]-a[1]);
  const yaw=-Math.atan2(c[1]-a[1],c[0]-a[0]);
  const cx=b.points.reduce((v,p)=>v+p[0],0)/4,cz=b.points.reduce((v,p)=>v+p[1],0)/4;
  const base=Math.min(...b.points.map(p=>height(p[0],p[1])))-.25;
  g.position.set(cx,base,cz);g.rotation.y=yaw;
  const width=Math.hypot(b.points[2][0]-a[0],b.points[2][1]-a[1]);
  const H=8.4,hw=width/2,hl=L/2;
  box(g,L,H,width,0,H/2,0,wall);
  // Gable roof is restrained, not the earlier steep generic chalet roof.
  const ridge=3.0;
  for(const side of [-1,1]){
    const roof=box(g,L+1.2,.18,Math.hypot(hw+.7,ridge),0,H+ridge/2,side*(hw+.7)/2,roofMetal);
    roof.rotation.x=side*Math.atan2(ridge,hw+.7);
    const cap=roof.clone();cap.material=snow;cap.position.y+=.18;g.add(cap);
    for(const y of [2.85,5.65]){
      box(g,L+1.4,.20,1.8,0,y,side*(hw+.8),deckMat);
      railing(g,-hl-.6,side*(hw+1.65),hl+.6,side*(hw+1.65),y+.1);
    }
    for(let i=0;i<12;i++){
      const x=-hl+(i+.5)*L/12;
      for(const y of [1.35,4.15,6.95])windowBay(g,x,y,side*(hw+.04),2.7,1.8,side===1?0:Math.PI);
      box(g,.13,H,.13,x-L/24,H/2,side*(hw+.12),timber);
    }
  }
  for(const side of [-1,1]){
    const geo=new THREE.BufferGeometry();geo.setAttribute('position',new THREE.Float32BufferAttribute([0,0,-hw,0,0,hw,0,ridge,0],3));geo.computeVertexNormals();
    const m=new THREE.Mesh(geo,wall);m.material.side=THREE.DoubleSide;m.position.set(side*hl,H,0);g.add(m);
    beam(g,new THREE.Vector3(side*hl,H,-hw),new THREE.Vector3(side*hl,H+ridge,0),.075);
    beam(g,new THREE.Vector3(side*hl,H+ridge,0),new THREE.Vector3(side*hl,H,hw),.075);
    for(const z of [-hw*.65,0,hw*.65])box(g,.15,H+ridge*(1-Math.abs(z)/hw),.15,side*(hl+.06),(H+ridge*(1-Math.abs(z)/hw))/2,z,timber);
    for(const y of [1.35,4.15,6.95])for(const z of [-hw*.55,0,hw*.55])windowBay(g,side*(hl+.09),y,z,3.3,2.05,side*Math.PI/2);
    for(const y of [2.85,5.65]){
      box(g,1.9,.2,width+3.2,side*(hl+.85),y,0,deckMat);
      railing(g,side*(hl+1.7),-hw-1.6,side*(hl+1.7),hw+1.6,y+.1);
    }
  }
  label(g,'BRETTELBERG',7,.8,0,7.85,-hw-.14,Math.PI);
  for(const side of [-1,1])for(let i=0;i<17;i++)box(g,2.1,.18,.3,side*(hl+1.3),i*.165,-hw-1.5+i*.3,deckMat);
  colliders.add({type:'box',x:cx,z:cz,hx:hl,hz:hw,yaw,top:base+H});
  return g;
}

export function buildSunlightStructure(b:BuildingDef,height:(x:number,z:number)=>number,colliders:ColliderGrid) {
  if(b.style==='sunlight_lodge')return lodge(b,height,colliders);
  if(b.style==='brettelberg')return condos(b,height,colliders);
  if(b.style==='base_modular') {
    const g=new THREE.Group();g.name=b.name;
    const cx=b.points.reduce((s,p)=>s+p[0],0)/4,cz=b.points.reduce((s,p)=>s+p[1],0)/4;
    const a=b.points[0],p=b.points[1],q=b.points[3];
    const w=Math.hypot(p[0]-a[0],p[1]-a[1]),d=Math.hypot(q[0]-a[0],q[1]-a[1]);
    const yaw=-Math.atan2(p[1]-a[1],p[0]-a[0]);
    const base=Math.max(...b.points.map(p=>height(p[0],p[1])))-.1;
    g.position.set(cx,base,cz);g.rotation.y=yaw;
    box(g,w,2.7,d,0,1.35,0,redwood);box(g,w+.55,.16,d+.55,0,2.8,0,roofMetal);box(g,w+.45,.12,d+.45,0,2.94,0,snow);
    for(let x=-w/2+.14;x<w/2;x+=.22)box(g,.028,2.65,.035,x,1.35,d/2+.02,timber);
    for(const x of [-w*.28,w*.28])windowBay(g,x,1.65,d/2+.05,Math.min(1.8,w*.22),1.05);
    box(g,.95,2.1,.12,0,1.05,d/2+.1,timber);box(g,.68,1.0,.025,0,1.5,d/2+.17,glass);
    box(g,.045,.22,.065,.33,1,d/2+.2,black);
    for(let i=0;i<3;i++)box(g,1.8,.16,.3,0,-i*.15,d/2+.3+i*.3,deckMat);
    colliders.add({type:'box',x:cx,z:cz,hx:w/2,hz:d/2,yaw,top:base+2.7});
    return g;
  }
  return null;
}
