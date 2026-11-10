import * as THREE from 'three/webgpu';
import { mergeStatic } from './mergeStatic';

const V = (x: number, y: number, z: number) => new THREE.Vector3(x, y, z);

/** Brush-direction texture. The albedo variation and the relief are separate maps. */
function hairMaterial() {
  const width = 192, height = 256;
  const colors = new Uint8Array(width * height * 4), heights = new Uint8Array(colors.length);
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    const wave = y + 3.2 * Math.sin(x * .044 + y * .025);
    const coarse = Math.sin(wave * .63) * 7 + Math.sin(wave * .132) * 9;
    const fibers = Math.sin(wave * 1.82 + .9 * Math.sin(x * .04)) * 7;
    const grain = (Math.imul((y * width + x) ^ 5427, 0x45d9f3b) >>> 28) - 7.5;
    const i = (y * width + x) * 4;
    colors.set([178 + coarse + fibers + grain, 158 + coarse + fibers + grain, 128 + coarse + fibers + grain, 255], i);
    const raised = 127 + 49 * Math.sin(wave * 1.56) + 16 * Math.sin(wave * .57);
    heights.set([raised, raised, raised, 255], i);
  }
  const make = (data: Uint8Array) => {
    const tex = new THREE.DataTexture(data, width, height);
    tex.generateMipmaps = true;
    tex.minFilter = THREE.LinearMipmapLinearFilter;
    tex.magFilter = THREE.LinearFilter;
    tex.needsUpdate = true;
    return tex;
  };
  const map = make(colors);
  map.colorSpace = THREE.SRGBColorSpace;
  return new THREE.MeshPhysicalNodeMaterial({
    map, roughness: .68, bumpMap: make(heights), bumpScale: .00036,
    sheen: .20, sheenColor: new THREE.Color(0x9d8b6f), sheenRoughness: .72,
  });
}

export function santaHair(headGeometry: THREE.BufferGeometry, skullIndexCount: number) {
  const hair = new THREE.Group();
  hair.name = 'santa-side-swept-hair';
  const combed = hairMaterial();

  // A recessed temple cutout leaves the ears visible, with the nape longer
  // behind them. Mesh UVs run down and back along the direction of the hair.
  const columns = 48, rows = 18;
  const scalp = new THREE.SphereGeometry(1, columns, rows, 0, Math.PI * 2, 0, 1.7);
  const points = scalp.getAttribute('position'), uv = scalp.getAttribute('uv');
  const headPositions = headGeometry.getAttribute('position'), headIndex = headGeometry.index!;
  const skull = Array.from({ length: headPositions.count }, (_, i) => new THREE.Vector3().fromBufferAttribute(headPositions, i));
  const skullTriangles: [THREE.Vector3, THREE.Vector3, THREE.Vector3][] = [];
  for (let i = 0; i < skullIndexCount; i += 3) {
    const a = skull[headIndex.getX(i)], b = skull[headIndex.getX(i + 1)], c = skull[headIndex.getX(i + 2)];
    if (Math.max(a.y, b.y, c.y) > -.03) skullTriangles.push([a, b, c]);
  }
  const ray = new THREE.Ray(V(0, .045, -.002), new THREE.Vector3());
  const hit = new THREE.Vector3();
  for (let row = 0; row <= rows; row++) for (let col = 0; col <= columns; col++) {
    const i = row * (columns + 1) + col;
    const t = col / columns, theta = t * 2 * Math.PI;
    const x = -Math.cos(theta), z = Math.sin(theta);
    const rear = THREE.MathUtils.smoothstep(z, .25, .98);
    const temple = THREE.MathUtils.smoothstep(z, -.85, -.22) * (1 - rear);
    const extent = 1.07 + .19 * temple + .95 * rear;
    const fraction = row / rows;
    const phi = fraction * extent;
    ray.direction.set(.101 * x * Math.sin(phi), .109 * Math.cos(phi), .124 * z * Math.sin(phi)).normalize();
    let radius = 0;
    for (const [a, b, c] of skullTriangles) {
      if (ray.intersectTriangle(a, b, c, false, hit)) radius = Math.max(radius, hit.distanceTo(ray.origin));
    }
    const edge = THREE.MathUtils.smoothstep(fraction, .77, 1);
    const thickness = THREE.MathUtils.lerp(.006 + .001 * Math.sin(theta * 16 + phi * 6), .0016, edge);
    ray.at(radius + thickness, hit);
    points.setXYZ(i, hit.x, hit.y, hit.z);
    uv.setXY(i, fraction, t);
  }
  scalp.computeVertexNormals();
  hair.add(new THREE.Mesh(scalp, combed));

  // One curved forelock for the lift above the brow and a long sweep over the
  // other temple. The lower edge is embedded in the scalp, including in profile.
  const lower = new THREE.CatmullRomCurve3([
    V(.093,.094,-.051), V(.069,.107,-.101), V(.038,.113,-.126),
    V(.004,.123,-.132), V(-.044,.126,-.121), V(-.080,.120,-.093), V(-.098,.109,-.058),
  ]);
  const upper = new THREE.CatmullRomCurve3([
    V(.096,.132,-.046), V(.069,.163,-.082), V(.038,.175,-.112),
    V(.002,.179,-.114), V(-.050,.166,-.103), V(-.084,.152,-.079), V(-.101,.123,-.050),
  ]);
  const forelockPoint = (u: number, v: number) => {
    const point = lower.getPoint(u).lerp(upper.getPoint(u), v);
    const lift = Math.sin(v * Math.PI) * Math.sin(u * Math.PI) ** .65;
    point.z -= lift * (.020 + .0015 * Math.cos(v * 36 + u * 3));
    point.y += lift * .005;
    return point;
  };
  const sweep = new THREE.PlaneGeometry(1, 1, 52, 24);
  const positions = sweep.getAttribute('position');
  for (let row = 0; row <= 24; row++) for (let col = 0; col <= 52; col++) {
    const p = forelockPoint(col / 52, 1 - row / 24);
    positions.setXYZ(row * 53 + col, p.x, p.y, p.z);
  }
  sweep.computeVertexNormals();
  hair.add(new THREE.Mesh(sweep, combed));

  const strand = new THREE.MeshStandardNodeMaterial({ color: 0xcbb998, roughness: .61 });
  for (let i = 0; i < 16; i++) {
    const v = (i + .6) / 17, path = [];
    for (let j = 0; j <= 8; j++) {
      const u = .10 + j * (.73 + .13 * Math.sin(i * 4.3)) / 8;
      const p = forelockPoint(u, v);
      p.z -= .0007 * Math.sin(j * Math.PI / 8);
      path.push(p);
    }
    hair.add(new THREE.Mesh(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(path), 18, .0005, 4), strand));
  }
  mergeStatic(hair);
  return hair;
}
