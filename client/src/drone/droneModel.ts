// Original small quadcopter, built at real scale. No downloaded or branded model assets.
import * as THREE from 'three/webgpu';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { mergeStatic } from '../world/mergeStatic';
import type { DroneState } from '../../../shared/dronePhysics';

export class DroneModel {
  readonly root = new THREE.Group();
  readonly body = new THREE.Group();
  readonly gimbal = new THREE.Group();
  readonly rotors: THREE.Group[] = [];
  private elapsed = 0;
  constructor() {
    this.root.name = 'camera-drone';
    this.root.add(this.body);
    const shell = new THREE.MeshStandardNodeMaterial({ color: 0xd8ddd8, roughness: .39, metalness: .12 });
    const dark = new THREE.MeshStandardNodeMaterial({ color: 0x222b31, roughness: .48, metalness: .3 });
    const rubber = new THREE.MeshStandardNodeMaterial({ color: 0x101418, roughness: .82 });
    const metal = new THREE.MeshStandardNodeMaterial({ color: 0x7d8a91, roughness: .3, metalness: .85 });
    const lens = new THREE.MeshStandardNodeMaterial({ color: 0x15263c, roughness: .08, metalness: .65 });
    const accent = new THREE.MeshStandardNodeMaterial({ color: 0xe9883d, roughness: .4 });
    const fixed = new THREE.Group(); this.body.add(fixed);
    const mesh = (g: THREE.BufferGeometry, m: THREE.Material, p: number[], parent = fixed) => {
      const o = new THREE.Mesh(g,m); o.position.set(p[0],p[1],p[2]); o.castShadow = true; o.receiveShadow = true; parent.add(o); return o;
    };
    const box = (w: number,h: number,d: number,r = .008) => new RoundedBoxGeometry(w,h,d,2,r);
    mesh(box(.115,.061,.19),shell,[0,.014,0]);
    mesh(box(.11,.023,.16,.004),dark,[0,-.022,.007]);
    mesh(box(.094,.009,.112,.003),shell,[0,.047,.032]); // battery lid and seam
    mesh(box(.024,.002,.014,.002),rubber,[0,.053,.06]);
    mesh(box(.014,.002,.06,.002),accent,[.044,.047,-.028]);
    // Cooling slots, downward optical sensors and screw heads.
    for (const side of [-1,1]) {
      for (let i = 0; i < 7; i++) mesh(box(.002,.006,.002,.0006),dark,[side*.058,.016,-.035+i*.009]);
      for (const z of [-.055,.06]) {
        mesh(new THREE.CylinderGeometry(.003,.003,.001,8),metal,[side*.044,.046,z]);
        const eye = mesh(new THREE.CylinderGeometry(.008,.008,.003,14),lens,[side*.032,-.036,z*.5]);
        eye.rotation.x = Math.PI;
      }
    }
    const positions = [[-.143,-.132],[.143,-.132],[-.143,.13],[.143,.13]];
    for (let i = 0; i < 4; i++) {
      const [x,z] = positions[i], sx = Math.sign(x)*.047, sz = Math.sign(z)*.052;
      const a = new THREE.Vector3(sx,.005,sz), b = new THREE.Vector3(x,.002,z);
      const arm = mesh(box(.018,.017,a.distanceTo(b),.004),shell,a.clone().lerp(b,.5).toArray());
      arm.quaternion.setFromUnitVectors(new THREE.Vector3(0,0,1),b.clone().sub(a).normalize());
      mesh(new THREE.CylinderGeometry(.014,.015,.026,18),dark,[x,.014,z]);
      mesh(new THREE.CylinderGeometry(.012,.012,.004,18),metal,[x,.029,z]);
      const leg = mesh(box(.009,.043,.01,.002),dark,[x,-.026,z]); leg.rotation.x = z < 0 ? -.2 : .2;
      mesh(box(.013,.006,.02,.002),rubber,[x,-.05,z]);
      const led = new THREE.MeshStandardNodeMaterial({ color: z < 0 ? 0xff4834 : 0x54ffc2,
        emissive: z < 0 ? 0xff2111 : 0x22dd88, emissiveIntensity: 1.8, roughness: .3 });
      mesh(box(.011,.004,.006,.001),led,[x,-.002,z+Math.sign(z)*.015]);
      const rotor = new THREE.Group(); rotor.position.set(x,.034,z); this.body.add(rotor); this.rotors.push(rotor);
      mesh(new THREE.CylinderGeometry(.007,.007,.008,12),dark,[0,.003,0],rotor);
      const shape = new THREE.Shape();
      shape.moveTo(.006,-.004); shape.quadraticCurveTo(.04,-.012,.083,-.008);
      shape.quadraticCurveTo(.096,-.005,.084,.003); shape.quadraticCurveTo(.038,.011,.006,.004); shape.closePath();
      const blade = new THREE.ExtrudeGeometry(shape,{ depth: .0012, bevelEnabled: false, curveSegments: 8 });
      blade.rotateX(-Math.PI/2);
      for (const sign of [1,-1]) { const prop = mesh(blade,dark,[0,.004,0],rotor); prop.rotation.y = sign < 0 ? Math.PI : 0; }
      // An exposure blur disk keeps fast counter-rotation readable without strobing solid blades.
      const blur = new THREE.Mesh(new THREE.RingGeometry(.018,.09,40),new THREE.MeshBasicNodeMaterial({
        color: 0x87918e, transparent: true, opacity: .11, side: THREE.DoubleSide, depthWrite: false }));
      blur.rotation.x = -Math.PI/2; blur.position.y = .006; rotor.add(blur);
    }
    // Three-axis front camera with a stabilised inner cradle.
    mesh(box(.048,.014,.023,.004),dark,[0,-.022,-.09]);
    this.gimbal.position.set(0,-.037,-.102); this.body.add(this.gimbal);
    mesh(box(.034,.027,.026,.007),dark,[0,0,0],this.gimbal);
    const bezel = mesh(new THREE.CylinderGeometry(.013,.013,.008,24),metal,[0,0,-.016],this.gimbal); bezel.rotation.x = Math.PI/2;
    const glass = mesh(new THREE.CylinderGeometry(.0105,.0105,.0015,24),lens,[0,0,-.021],this.gimbal); glass.rotation.x = Math.PI/2;
    mesh(new THREE.SphereGeometry(.002,8,6),new THREE.MeshBasicNodeMaterial({color:0x8badcb}),[-.003,.004,-.023],this.gimbal);
    mergeStatic(fixed);
  }
  update(dt: number, s: Pick<DroneState,'pos'|'yaw'|'pitch'|'bank'|'tilt'|'rpm'>) {
    this.elapsed += dt;
    this.root.position.set(s.pos.x,s.pos.y,s.pos.z);
    this.root.rotation.set(0,s.yaw,0);
    this.body.rotation.set(s.tilt,0,s.bank,'YXZ');
    this.gimbal.rotation.set(s.pitch-s.tilt,0,-s.bank,'YXZ');
    this.rotors.forEach((r,i) => { r.rotation.y = (r.rotation.y+(i === 0 || i === 3 ? 1 : -1)*s.rpm[i]*Math.PI/30*dt)%(Math.PI*2); });
  }
  dispose() {
    const geometries = new Set<THREE.BufferGeometry>(), materials = new Set<THREE.Material>();
    this.root.traverse(o => { if (o instanceof THREE.Mesh) { geometries.add(o.geometry); for (const m of Array.isArray(o.material) ? o.material : [o.material]) materials.add(m); } });
    geometries.forEach(g => g.dispose()); materials.forEach(m => m.dispose());
    this.root.removeFromParent();
  }
}
