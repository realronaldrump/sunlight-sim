// @ts-nocheck -- TSL node graphs: @types/three node typings are too strict to be useful here.
// Light snowfall: flakes animated entirely on the GPU in a box that follows the camera.
import * as THREE from 'three/webgpu';
import { attribute, uniform, vec3, mod, time, positionLocal, sin, float, smoothstep, length, cameraPosition, positionWorld } from 'three/tsl';

export class Snowfall {
  readonly mesh: THREE.InstancedMesh;
  private center = uniform(new THREE.Vector3());
  readonly box = 50;

  constructor(count = 14000) {
    const geo = new THREE.IcosahedronGeometry(0.03, 0);
    const seeds = new Float32Array(count * 3);
    for (let i = 0; i < count * 3; i++) seeds[i] = Math.random() * this.box;
    geo.setAttribute('seed', new THREE.InstancedBufferAttribute(seeds, 3));
    const mat = new THREE.MeshBasicNodeMaterial({ color: 0xffffff, transparent: true, opacity: 0.85, depthWrite: false });
    const seed = attribute('seed', 'vec3');
    const B = float(this.box);
    const fall = time.mul(1.1);
    const drift = vec3(sin(time.mul(0.6).add(seed.y)).mul(0.6).add(time.mul(0.35)), fall.negate(), sin(time.mul(0.5).add(seed.x)).mul(0.5));
    // wrap each flake into a box centred on the camera
    const p = mod(seed.add(drift).sub(this.center), B).sub(B.mul(0.5)).add(this.center);
    mat.positionNode = positionLocal.add(p);
    // flakes right in front of the lens fade out instead of showing as big blobs
    mat.opacityNode = smoothstep(0.8, 2.5, length(positionWorld.sub(cameraPosition))).mul(0.85);
    this.mesh = new THREE.InstancedMesh(geo, mat, count);
    this.mesh.frustumCulled = false;
    this.mesh.visible = false;
    for (let i = 0; i < count; i++) this.mesh.setMatrixAt(i, new THREE.Matrix4());
  }

  update(cam: THREE.Vector3) { this.center.value.copy(cam); }
}
