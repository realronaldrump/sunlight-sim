// The lift line, lodge and ski racks share equipment draws. Beyond 33 m the small buckles and
// seams disappear first; boots, skis, poles and headwear still have complete silhouettes.
import * as THREE from 'three/webgpu';
import { headwear } from '../skier/headwear';
import { jacketCollar, skiBoot, skiWithBindings, skiPole } from '../skier/skiEquipment';
import { mergeStatic } from './mergeStatic';

type GearKind = 'helmet' | 'beanie' | 'collar' | 'leftBoot' | 'rightBoot' | 'ski' | 'pole';
const white = new THREE.Color(0xffffff);

function distantGear(kind: GearKind) {
  const g = new THREE.Group();
  const mat = (color: number) => new THREE.MeshStandardNodeMaterial({color, roughness: .74});
  const add = (geo: THREE.BufferGeometry, material: THREE.Material, x: number, y: number, z: number) => {
    const m = new THREE.Mesh(geo,material); m.position.set(x,y,z);g.add(m);return m;
  };
  if (kind === 'helmet' || kind === 'beanie') {
    const dye = mat(0xffffff); dye.userData.headwearTint = true;
    add(new THREE.SphereGeometry(1,12,7,0,Math.PI*2,0,Math.PI*.60),dye,0,.055,0).scale.set(.112,.128,.134);
    if (kind === 'helmet') {
      add(new THREE.SphereGeometry(1,12,6),mat(0x867a71),0,.035,-.060).scale.set(.115,.039,.087);
    } else {
      add(new THREE.CylinderGeometry(.102,.105,.045,12),dye,0,.062,.005).scale.z=1.2;
      add(new THREE.IcosahedronGeometry(.026,0),mat(0xd6c8b6),.007,.168,.019);
    }
  } else if (kind === 'leftBoot' || kind === 'rightBoot') {
    const boot=mat(0x394952);
    add(new THREE.SphereGeometry(1,10,6),boot,0,-.039,-.054).scale.set(.070,.065,.145);
    add(new THREE.CylinderGeometry(.074,.067,.215,10),boot,0,.057,.011);
  } else if (kind === 'ski') {
    const shape = new THREE.Shape();
    shape.moveTo(.76,0);shape.lineTo(.77,.038);shape.lineTo(.66,.020);shape.lineTo(-.68,.020);
    shape.quadraticCurveTo(-.93,.072,-.96,.121);shape.lineTo(-.96,.103);shape.quadraticCurveTo(-.90,.044,-.68,.005);
    shape.lineTo(.67,.005);shape.closePath();
    const geo=new THREE.ExtrudeGeometry(shape,{depth:.092,bevelEnabled:false,curveSegments:4});
    geo.rotateY(-Math.PI/2);geo.translate(.046,0,0);
    add(geo,mat(0x3c6471),0,0,0);
  } else if (kind === 'pole') {
    add(new THREE.CylinderGeometry(.008,.005,1.16,5),mat(0x959da2),0,0,0);
  }
  mergeStatic(g);
  return g;
}

export class CrowdGear {
  readonly group = new THREE.Group();
  private batches = new Map<string, { parts: THREE.InstancedMesh[]; count: number }>();

  constructor(capacity: number) {
    this.group.name = 'crowd-gear';
    const pieces = { helmet: headwear('helmet', white), beanie: headwear('beanie', white),
      leftBoot: skiBoot(-1), rightBoot: skiBoot(1), collar: jacketCollar(white).group, ski: skiWithBindings(), pole: skiPole() };
    for (const kind of Object.keys(pieces) as GearKind[]) for (const detail of [true,false]) {
      if (!detail && kind === 'collar') continue;
      const source = detail ? pieces[kind] : distantGear(kind);
      const count = capacity * (kind === 'ski' || kind === 'pole' ? 2 : 1);
      const parts = source.children.map(child => {
        const m = child as THREE.Mesh<THREE.BufferGeometry,THREE.MeshStandardNodeMaterial>;
        const mesh = new THREE.InstancedMesh(m.geometry,m.material,count);
        mesh.count=0;mesh.frustumCulled=false;mesh.castShadow=detail;mesh.receiveShadow=true;
        mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
        if (m.material.userData.headwearTint || m.material.userData.jacketTint) {
          mesh.setColorAt(0,white);mesh.instanceColor!.setUsage(THREE.DynamicDrawUsage);
        }
        this.group.add(mesh);return mesh;
      });
      this.batches.set(kind + detail, {parts,count:0});
    }
  }

  begin() { for (const batch of this.batches.values()) batch.count=0; }
  push(kind: GearKind, world: THREE.Matrix4, detail: boolean, color?: THREE.Color) {
    const batch=this.batches.get(kind + detail)!;
    if (batch.count >= batch.parts[0].instanceMatrix.count) return;
    for (const mesh of batch.parts) {
      mesh.setMatrixAt(batch.count,world);
      if(mesh.instanceColor) mesh.setColorAt(batch.count,color ?? white);
    }
    batch.count++;
  }
  end() {
    for (const {parts,count} of this.batches.values()) for (const mesh of parts) {
      mesh.count=count;mesh.visible=count>0;
      if (count) {mesh.instanceMatrix.needsUpdate=true;if(mesh.instanceColor) mesh.instanceColor.needsUpdate=true;}
    }
  }
}
