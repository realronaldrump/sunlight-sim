// @ts-nocheck -- TSL node graphs use the project's material typing exception.
// World-anchored snowflakes with varied settling, wind drift and soft silhouettes.
import * as THREE from 'three/webgpu';
import {
  attribute, uniform, vec2, vec3, mod, time, positionLocal, sin, cos, float, smoothstep,
  length, cameraPosition, cameraWorldMatrix, positionWorld, uv, max, abs, mix,
} from 'three/tsl';

export class Snowfall {
  readonly mesh: THREE.InstancedMesh;
  private center = uniform(new THREE.Vector3());
  /** 0..1 how hard it snows: a squall's edge is a few flakes, its heart a proper shower. */
  readonly amount = uniform(1);
  readonly box = 64;

  constructor(count = 14000) {
    const geo = new THREE.PlaneGeometry(1, 1);
    const seeds = new Float32Array(count * 4);
    let rng = 72431;
    for (let i = 0; i < seeds.length; i++) {
      rng = (Math.imul(rng, 1664525) + 1013904223) >>> 0;
      seeds[i] = rng / 4294967296;
    }
    geo.setAttribute('flake', new THREE.InstancedBufferAttribute(seeds, 4));
    const mat = new THREE.MeshStandardNodeMaterial({ color: 0xf6f9ff, roughness: 1, transparent: true, depthWrite: false, side: THREE.DoubleSide });
    const seed = attribute('flake', 'vec4');
    const B = float(this.box);
    const fallSpeed = mix(0.55, 1.65, seed.w);
    const gust = sin(time.mul(0.17)).mul(0.9);
    const drift = vec3(
      time.mul(0.4).add(gust).add(sin(time.mul(0.7).add(seed.y.mul(50))).mul(0.4)),
      time.mul(fallSpeed).negate(),
      time.mul(0.12).add(sin(time.mul(0.53).add(seed.x.mul(60))).mul(0.35)),
    );
    const local = mod(seed.xyz.mul(B).add(drift).sub(this.center), B).sub(B.mul(0.5));
    const p = local.add(this.center);
    const angle = time.mul(seed.w.sub(0.5)).add(seed.x.mul(30));
    const size = float(0.009).add(seed.w.mul(seed.w).mul(0.035));
    const rotated = vec2(positionLocal.x.mul(cos(angle)).sub(positionLocal.y.mul(sin(angle))),
      positionLocal.x.mul(sin(angle)).add(positionLocal.y.mul(cos(angle))));
    mat.positionNode = p.add(cameraWorldMatrix[0].xyz.mul(rotated.x)
      .add(cameraWorldMatrix[1].xyz.mul(rotated.y).mul(mix(0.75, 1.35, seed.z))).mul(size));
    mat.normalNode = vec3(0, 0, 1);
    const radius = length(uv().sub(0.5)).mul(2);
    const shape = float(1).sub(smoothstep(0.1, 1, radius));
    const distance = length(positionWorld.sub(cameraPosition));
    const lensFade = smoothstep(0.65, 2.2, distance);
    const boundary = max(max(abs(local.x), abs(local.y)), abs(local.z));
    const boxFade = float(1).sub(smoothstep(this.box * 0.39, this.box * 0.5, boundary));
    // lighter snow shows fewer flakes: each flake has its own threshold
    const present = smoothstep(seed.z.sub(0.08), seed.z, this.amount);
    mat.opacityNode = shape.mul(shape).mul(lensFade).mul(boxFade).mul(mix(0.45, 0.85, seed.w)).mul(present);
    this.mesh = new THREE.InstancedMesh(geo, mat, count);
    this.mesh.name = 'wind-drifting snowfall';
    this.mesh.frustumCulled = false;
    this.mesh.visible = false;
    this.mesh.receiveShadow = true;
  }

  update(cam: THREE.Vector3) { this.center.value.copy(cam); }
}
