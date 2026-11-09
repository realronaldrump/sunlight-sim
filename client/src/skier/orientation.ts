import * as THREE from 'three/webgpu';
import type { Vec3 } from '../../../shared/skiPhysics';

const up = new THREE.Vector3(), forward = new THREE.Vector3(), right = new THREE.Vector3();
const basis = new THREE.Matrix4();
/** Keep both skis tangent to the measured snow surface. Riders stay upright on their chair. */
export function orientSkier(root: THREE.Object3D, heading: number, normal?: Vec3) {
  if (!normal) { root.rotation.set(0, heading, 0); return; }
  up.set(normal.x, normal.y, normal.z).normalize();
  forward.set(-Math.sin(heading), 0, -Math.cos(heading));
  forward.addScaledVector(up, -forward.dot(up)).normalize();
  right.crossVectors(forward, up).normalize();
  basis.makeBasis(right, up, forward.negate());
  root.quaternion.setFromRotationMatrix(basis);
}
