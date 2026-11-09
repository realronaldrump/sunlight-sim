// @ts-nocheck -- GPU billboard nodes use the project's TSL typing exception.
import * as THREE from 'three/webgpu';
import { attribute, cameraWorldMatrix, float, length, positionLocal, smoothstep, uv, vec3 } from 'three/tsl';

const CAPACITY = 640;

/** Short-lived, ballistic snow kicked off the ski edges. Sizes and velocity are in meters. */
export class SnowSpray {
  readonly mesh: THREE.InstancedMesh;
  private positions = new Float32Array(CAPACITY * 3);
  private velocities = new Float32Array(CAPACITY * 3);
  private appearance = new Float32Array(CAPACITY * 2);
  private ages = new Float32Array(CAPACITY);
  private lives = new Float32Array(CAPACITY);
  private radii = new Float32Array(CAPACITY);
  private cursor = 0;
  private seed = 187;

  constructor() {
    const geo = new THREE.PlaneGeometry(1, 1);
    geo.setAttribute('snowPosition', new THREE.InstancedBufferAttribute(this.positions, 3).setUsage(THREE.DynamicDrawUsage));
    geo.setAttribute('snowAppearance', new THREE.InstancedBufferAttribute(this.appearance, 2).setUsage(THREE.DynamicDrawUsage));
    const mat = new THREE.MeshStandardNodeMaterial({ color: 0xf4f8ff, roughness: 1, transparent: true, depthWrite: false, side: THREE.DoubleSide });
    const appearance = attribute('snowAppearance', 'vec2');
    const right = cameraWorldMatrix[0].xyz, up = cameraWorldMatrix[1].xyz;
    mat.positionNode = attribute('snowPosition', 'vec3')
      .add(right.mul(positionLocal.x).add(up.mul(positionLocal.y)).mul(appearance.x));
    mat.normalNode = vec3(0, 0, 1);
    const radius = length(uv().sub(0.5)).mul(2);
    const soft = float(1).sub(smoothstep(0.15, 1, radius));
    mat.opacityNode = soft.mul(soft).mul(appearance.y);
    this.mesh = new THREE.InstancedMesh(geo, mat, CAPACITY);
    this.mesh.name = 'ski-edge snow spray';
    this.mesh.frustumCulled = false;
    this.mesh.receiveShadow = true;
    this.mesh.renderOrder = 2;
    this.mesh.visible = false;
  }

  private random() {
    this.seed = (Math.imul(this.seed, 1664525) + 1013904223) >>> 0;
    return this.seed / 4294967296;
  }

  emit(left: THREE.Vector3, right: THREE.Vector3, direction: THREE.Vector3, width: number, strength: number, speed: number) {
    if (speed < 2) return;
    const force = THREE.MathUtils.clamp((width - 0.1) * 5 + (strength - 0.7), 0.05, 1.7);
    const count = Math.ceil(force * Math.min(speed, 15) * 1.15);
    for (let side = -1; side <= 1; side += 2) {
      const origin = side < 0 ? left : right;
      for (let n = 0; n < count; n++) {
        const i = this.cursor, k = i * 3;
        this.cursor = (i + 1) % CAPACITY;
        const spread = (0.35 + this.random() * 1.8) * force;
        this.positions[k] = origin.x - direction.x * this.random() * 0.55;
        this.positions[k + 1] = origin.y + 0.04 + this.random() * 0.06;
        this.positions[k + 2] = origin.z - direction.z * this.random() * 0.55;
        this.velocities[k] = -direction.z * spread * side + direction.x * speed * 0.16;
        this.velocities[k + 1] = (0.45 + this.random() * 1.7) * Math.sqrt(force);
        this.velocities[k + 2] = direction.x * spread * side + direction.z * speed * 0.16;
        this.ages[i] = 0;
        this.lives[i] = 0.3 + this.random() * 0.6;
        this.radii[i] = 0.012 + this.random() ** 2 * 0.055 * force;
        this.appearance[i * 2] = this.radii[i];
        this.appearance[i * 2 + 1] = 0;
      }
    }
  }

  update(dt: number) {
    const drag = Math.exp(-dt * 2.8);
    let live = 0;
    for (let i = 0; i < CAPACITY; i++) {
      this.ages[i] += dt;
      if (this.ages[i] >= this.lives[i]) { this.appearance[i * 2 + 1] = 0; continue; }
      live++;
      const k = i * 3, t = this.ages[i] / this.lives[i];
      this.velocities[k] *= drag; this.velocities[k + 2] *= drag;
      this.velocities[k + 1] -= 6.5 * dt; // fine powder has appreciable aerodynamic drag
      for (let a = 0; a < 3; a++) this.positions[k + a] += this.velocities[k + a] * dt;
      this.appearance[i * 2] = this.radii[i] * (1 + t * 1.8);
      this.appearance[i * 2 + 1] = Math.min(1, t * 12) * (1 - t) ** 2 * 0.42;
    }
    this.mesh.visible = live > 0;
    if (live) {
      this.mesh.geometry.getAttribute('snowPosition').needsUpdate = true;
      this.mesh.geometry.getAttribute('snowAppearance').needsUpdate = true;
    }
  }
}
