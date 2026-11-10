import * as THREE from 'three/webgpu';
import { attribute, cameraPosition, color, length, mix, positionWorld, sin, smoothstep, uniform } from 'three/tsl';
import { SANTA_TRACK_LIFE, SANTA_TRACK_STEP, type SantaTrack } from '../../../shared/santaFestivities';
import type { TerrainProbe } from '../../../shared/skiPhysics';

const RANGE = 96;
const SEGMENTS = 330;
const SUBDIVISIONS = 4;
const QUADS = SEGMENTS * SUBDIVISIONS * 2;

function tangent(a: SantaTrack, b: SantaTrack) {
  const x = b[1] - a[1], z = b[2] - a[2], d = Math.hypot(x, z) || 1;
  return [-z / d, x / d] as const;
}

/** Two soft grooves on the snow. A fresh turn glows briefly and leaves flecks in its tracks. */
export class SantaSkiTrail {
  readonly mesh;
  private geo = new THREE.BufferGeometry();
  private position = new THREE.BufferAttribute(new Float32Array(QUADS * 12), 3).setUsage(THREE.DynamicDrawUsage);
  private profile = new THREE.BufferAttribute(new Float32Array(QUADS * 12), 3).setUsage(THREE.DynamicDrawUsage);
  private time = uniform(0);
  private nextUpdate = -Infinity;
  private visible: number[] = [];

  constructor(private probe: TerrainProbe) {
    const indices = new Uint16Array(QUADS * 6);
    for (let i = 0; i < QUADS; i++) {
      const v = i * 4;
      indices.set([v, v + 1, v + 2, v + 2, v + 1, v + 3], i * 6);
    }
    this.geo.setIndex(new THREE.BufferAttribute(indices, 1));
    this.geo.setAttribute('position', this.position);
    this.geo.setAttribute('groove', this.profile);
    this.geo.setDrawRange(0, 0);
    const material = new THREE.MeshBasicNodeMaterial({
      transparent: true, depthWrite: false, side: THREE.DoubleSide, forceSinglePass: true,
      toneMapped: false, polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -1,
    });
    const data = attribute('groove', 'vec3');
    const age = this.time.sub(data.y).max(0);
    const fresh = smoothstep(.16, .54, data.z).mul(smoothstep(.35, 2.6, age).oneMinus());
    const dust = sin(positionWorld.x.mul(6.7).add(positionWorld.z.mul(4.9)))
      .mul(sin(positionWorld.z.mul(9.1).sub(positionWorld.x.mul(5.3))));
    const flecks = smoothstep(.75, .99, dust).mul(.36);
    const center = smoothstep(0, 1, data.x.abs()).oneMinus();
    const lifetime = smoothstep(SANTA_TRACK_LIFE - 130, SANTA_TRACK_LIFE, age).oneMinus();
    const distance = smoothstep(RANGE - 20, RANGE - 5, length(positionWorld.sub(cameraPosition))).oneMinus();
    material.colorNode = mix(color(0x7189a5), color(0xffca71), fresh.mul(1.6).add(flecks.mul(3)).clamp());
    material.opacityNode = center.mul(fresh.mul(.58).add(flecks).add(.36)).clamp().mul(lifetime).mul(distance);
    this.mesh = new THREE.Mesh(this.geo, material);
    this.mesh.name = 'santa-ski-trail';
    this.mesh.frustumCulled = false;
    this.mesh.visible = false;
    this.mesh.renderOrder = 2;
  }

  refresh() { this.nextUpdate = -Infinity; }

  update(marks: readonly SantaTrack[], age: number, now: number, camera: THREE.Vector3) {
    this.time.value = age;
    if (now < this.nextUpdate) return;
    this.nextUpdate = now + .26;
    this.visible.length = 0;
    for (let i = marks.length - 1; i > 0 && this.visible.length < SEGMENTS; i--) {
      const [at, x, z, edge] = marks[i];
      if (age - at >= SANTA_TRACK_LIFE) break;
      if (edge < 0 || at > age + .01 || (x - camera.x) ** 2 + (z - camera.z) ** 2 > RANGE ** 2) continue;
      if (Math.hypot(x - marks[i - 1][1], z - marks[i - 1][2]) > SANTA_TRACK_STEP * 1.5 + .03) continue;
      this.visible.push(i);
    }
    let quad = 0;
    for (let j = this.visible.length - 1; j >= 0; j--) {
      const i = this.visible[j], a = marks[i - 1], b = marks[i];
      const before = i > 1 && a[3] >= 0 ? marks[i - 2] : a;
      const after = i + 1 < marks.length && marks[i + 1][3] >= 0 ? marks[i + 1] : b;
      const [ax, az] = tangent(before, b), [bx, bz] = tangent(a, after);
      const halfWidth = .13 + b[3] * .065;
      for (let ski = -1; ski <= 1; ski += 2) {
        for (let s = 0; s < SUBDIVISIONS; s++) {
          let vertex = quad++ * 4;
          for (let end = 0; end <= 1; end++) {
            const t = (s + end) / SUBDIVISIONS;
            const nx = THREE.MathUtils.lerp(ax, bx, t), nz = THREE.MathUtils.lerp(az, bz, t);
            const x = THREE.MathUtils.lerp(a[1], b[1], t), z = THREE.MathUtils.lerp(a[2], b[2], t);
            for (let across = -1; across <= 1; across += 2) {
              const offset = ski * .18 + across * halfWidth;
              const vx = x + nx * offset, vz = z + nz * offset;
              this.position.setXYZ(vertex, vx, this.probe.height(vx, vz) + .027, vz);
              this.profile.setXYZ(vertex++, across, b[0], b[3]);
            }
          }
        }
      }
    }
    this.mesh.visible = quad > 0;
    this.geo.setDrawRange(0, quad * 6);
    if (quad) {
      this.position.clearUpdateRanges(); this.position.addUpdateRange(0, quad * 12); this.position.needsUpdate = true;
      this.profile.clearUpdateRanges(); this.profile.addUpdateRange(0, quad * 12); this.profile.needsUpdate = true;
    }
  }
}
