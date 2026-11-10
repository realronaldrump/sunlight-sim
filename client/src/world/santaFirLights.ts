import * as THREE from 'three/webgpu';
import { attribute, cameraWorldMatrix, color, length, positionLocal, sin, smoothstep, uniform, uv, vec4 } from 'three/tsl';
import { SANTA_STAR_LIFE, type SantaLitFir } from '../../../shared/santaFestivities';
import type { TerrainProbe } from '../../../shared/skiPhysics';
import { ornamentBranches, type FirInstance } from '../../../shared/treeData';
import { makeSantaOrnament } from './santaOrnament';

export const SANTA_FIR_VIEW_RANGE = 115;
const clamp = THREE.MathUtils.clamp;
const PALETTE = [0xffdc9b, 0xffe8ba, 0xffbf69, 0xff746d, 0xffe0a1, 0x92e7c0, 0xffe8ba].map(hex => new THREE.Color(hex));

/** Bulbs sit on the same seeded boughs that the skier reaches with his glove. */
function firBulbs(tree: FirInstance) {
  const at: number[] = [], style: number[] = [], colors: number[] = [];
  const branches = [...ornamentBranches(tree, Infinity, .98)];
  for (let i = 0; i < branches.length; i += 3) {
    const b = branches[i], height = (b.y - tree.y) / tree.height;
    if (height > .93) continue;
    const phase = ((i * 13 + tree.seed) % 23) / 23;
    at.push(b.x - tree.x, b.y - tree.y - .045, b.z - tree.z);
    style.push(height * 1.55 + phase * .13, .34 + phase * .16, phase * 6.28);
    colors.push(...PALETTE[(i + tree.seed) % PALETTE.length].toArray());
  }
  const geo = new THREE.PlaneGeometry(1, 1);
  geo.setAttribute('bulbAt', new THREE.InstancedBufferAttribute(new Float32Array(at), 3));
  geo.setAttribute('bulbStyle', new THREE.InstancedBufferAttribute(new Float32Array(style), 3));
  geo.setAttribute('bulbColor', new THREE.InstancedBufferAttribute(new Float32Array(colors), 3));
  const material = new THREE.MeshBasicNodeMaterial({ transparent: true, depthWrite: false, toneMapped: false });
  const bloom = uniform(0), age = uniform(0), night = uniform(0), clock = uniform(0), scale = uniform(1);
  const data = attribute('bulbStyle', 'vec3');
  const right = cameraWorldMatrix.mul(vec4(1, 0, 0, 0)).xyz, up = cameraWorldMatrix.mul(vec4(0, 1, 0, 0)).xyz;
  material.positionNode = attribute('bulbAt', 'vec3')
    .add(right.mul(positionLocal.x).add(up.mul(positionLocal.y)).mul(data.y).mul(scale));
  const radius = length(uv().sub(.5)).mul(2);
  const core = smoothstep(.13, .34, radius).oneMinus();
  const halo = smoothstep(.18, 1, radius).oneMinus().pow(2);
  const lit = smoothstep(data.x, data.x.add(.28), age);
  const flicker = sin(clock.mul(2.3).add(data.z)).mul(.08).add(.92);
  material.colorNode = attribute('bulbColor', 'vec3').mul(core.mul(.38).add(1.07));
  material.opacityNode = core.mul(.99).add(halo.mul(night.mul(.25).add(.26))).min(1).mul(lit).mul(flicker).mul(bloom);
  const mesh = new THREE.InstancedMesh(geo, material, at.length / 3);
  mesh.name = 'santa-fir-bulbs';
  mesh.frustumCulled = false;
  mesh.renderOrder = 3;
  return { mesh, bloom, age, night, clock, scale };
}

/** A soft pool follows the real snow surface below the tree, including on a bank. */
function snowGlow() {
  const geo = new THREE.PlaneGeometry(9.5, 8, 18, 16).rotateX(-Math.PI / 2);
  const material = new THREE.MeshBasicNodeMaterial({ transparent: true, depthWrite: false, toneMapped: false, polygonOffset: true, polygonOffsetFactor: -1 });
  const intensity = uniform(0);
  material.colorNode = color(0xffcb7f);
  material.opacityNode = smoothstep(.04, 1, length(uv().sub(.5)).mul(2)).oneMinus().pow(1.6).mul(intensity);
  const mesh = new THREE.Mesh(geo, material);
  mesh.name = 'santa-fir-snow-glow';
  mesh.frustumCulled = false;
  return { mesh, intensity };
}

export class SantaFirLights {
  readonly group = new THREE.Group();
  private star = makeSantaOrnament();
  private bulbs;
  private pool;
  private resampleAt = -Infinity;

  constructor(private fir: SantaLitFir, private probe: TerrainProbe) {
    const origin = fir.tree ?? fir.anchor;
    this.group.position.set(origin.x, origin.y, origin.z);
    this.group.name = 'santa-decorated-fir';
    this.star.group.position.set(fir.anchor.x - origin.x, fir.anchor.y - origin.y, fir.anchor.z - origin.z);
    this.group.add(this.star.group);
    this.bulbs = fir.tree ? firBulbs(fir.tree) : null;
    this.pool = this.bulbs ? snowGlow() : null;
    if (this.bulbs && this.pool) {
      // Center the spill under the ornament, a little toward the open snow.
      this.pool.mesh.position.set((fir.anchor.x - origin.x) * .76, 0, (fir.anchor.z - origin.z) * .76);
      this.group.add(this.bulbs.mesh, this.pool.mesh);
    }
  }

  update(age: number, now: number, night: number, distance: number) {
    const elapsed = age - this.fir.litAt;
    const fade = clamp((SANTA_STAR_LIFE - elapsed) / 26, 0, 1) * clamp((SANTA_FIR_VIEW_RANGE - distance) / 22, 0, 1);
    this.group.visible = elapsed >= 0 && fade > 0;
    if (!this.group.visible) return;
    const clock = now % 1000 + this.fir.anchor.x * .14;
    const near = clamp((14 - distance) / 9, 0, 1);
    this.star.group.rotation.set(.06 * Math.sin(clock * 1.8), this.fir.anchor.x * .91 + .28 * Math.cos(clock * .85), .10 * Math.sin(clock * 1.43));
    this.star.glow(fade, night, Math.sin(clock * 2.2));
    if (!this.bulbs || !this.pool) return;
    this.bulbs.age.value = elapsed;
    this.bulbs.bloom.value = fade * (.91 + near * .09);
    this.bulbs.night.value = night;
    this.bulbs.clock.value = clock;
    this.bulbs.scale.value = 1 + clamp((distance - 22) / 100, 0, .55);
    this.pool.mesh.visible = distance < 72;
    if (!this.pool.mesh.visible) return;
    const lighting = THREE.MathUtils.smoothstep(elapsed, .12, 1.6);
    this.pool.intensity.value = fade * lighting * (.26 + night * .26 + near * .055) * clamp((72 - distance) / 14, 0, 1);
    if (now < this.resampleAt) return;
    this.resampleAt = now + 1.2;
    const p = this.group.position, m = this.pool.mesh;
    const vertices = m.geometry.getAttribute('position');
    for (let i = 0; i < vertices.count; i++) {
      const x = p.x + m.position.x + vertices.getX(i), z = p.z + m.position.z + vertices.getZ(i);
      vertices.setY(i, this.probe.height(x, z) - p.y + .035);
    }
    vertices.needsUpdate = true;
  }

  dispose() {
    this.group.removeFromParent();
    this.group.traverse(object => {
      if (object instanceof THREE.Mesh) object.geometry.dispose();
      if (object instanceof THREE.Mesh || object instanceof THREE.Sprite) (object.material as THREE.Material).dispose();
    });
  }
}
