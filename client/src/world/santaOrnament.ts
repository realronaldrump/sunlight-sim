import * as THREE from 'three/webgpu';

let haloMap: THREE.DataTexture | null = null;

function softLight() {
  if (haloMap) return haloMap;
  const size = 48, data = new Uint8Array(size * size * 4);
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    const r = Math.hypot((x + .5) / size - .5, (y + .5) / size - .5) * 2;
    const a = Math.max(0, 1 - r) ** 2.7;
    data.set([255, 228, 155, Math.round(a * 255)], (y * size + x) * 4);
  }
  haloMap = new THREE.DataTexture(data, size, size);
  haloMap.colorSpace = THREE.SRGBColorSpace;
  haloMap.magFilter = THREE.LinearFilter;
  haloMap.needsUpdate = true;
  return haloMap;
}

/** Origin is the wire hook. The star hangs below it in either the glove or a branch. */
export function makeSantaOrnament() {
  const group = new THREE.Group();
  group.name = 'santa-fir-star';
  const brass = new THREE.MeshStandardNodeMaterial({
    color: 0xffc45c, metalness: .57, roughness: .27,
    emissive: 0xff9029, emissiveIntensity: .65, transparent: true,
  });
  const shape = new THREE.Shape();
  for (let i = 0; i < 10; i++) {
    const angle = Math.PI / 2 + i * Math.PI / 5, r = i % 2 ? .047 : .114;
    const x = Math.cos(angle) * r, y = Math.sin(angle) * r;
    if (i) shape.lineTo(x, y); else shape.moveTo(x, y);
  }
  shape.closePath();
  const face = new THREE.Mesh(new THREE.ExtrudeGeometry(shape, {
    depth: .011, bevelSize: .003, bevelThickness: .003, bevelSegments: 2, steps: 1,
  }), brass);
  face.position.set(0, -.149, -.0055);
  const hook = new THREE.Mesh(new THREE.TorusGeometry(.022, .0024, 6, 20), brass);
  hook.position.y = -.018;
  const halo = new THREE.Sprite(new THREE.SpriteMaterial({
    map: softLight(), transparent: true, opacity: .37, depthWrite: false, blending: THREE.AdditiveBlending,
  }));
  halo.position.set(0, -.139, .009);
  halo.scale.setScalar(.47);
  group.add(face, hook, halo);
  return {
    group,
    glow(alpha: number, night: number, pulse: number) {
      brass.opacity = alpha;
      brass.emissiveIntensity = (.55 + night * .8 + pulse * .13) * alpha;
      halo.material.opacity = (.29 + night * .23 + pulse * .065) * alpha;
    },
  };
}
