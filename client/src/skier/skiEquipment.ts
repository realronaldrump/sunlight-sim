// Original ski equipment in meters. Molded shells, curved lenses, sidecut skis and working bindings.
import * as THREE from 'three/webgpu';

const rubber = new THREE.MeshStandardNodeMaterial({ color: 0x181c23, roughness: 0.94 });
const shell = new THREE.MeshStandardNodeMaterial({ color: 0x333c48, roughness: 0.45 });
const metal = new THREE.MeshStandardNodeMaterial({ color: 0x9ca5b0, metalness: 0.82, roughness: 0.26 });
const orange = new THREE.MeshStandardNodeMaterial({ color: 0xe97b32, roughness: 0.48 });
const cream = new THREE.MeshStandardNodeMaterial({ color: 0xf3e8d3, roughness: .3 });
const lacquer = new THREE.MeshStandardNodeMaterial({ color: 0xbf1535, roughness: .29, metalness: .14 });
const lens = new THREE.MeshPhysicalNodeMaterial({ color: 0xe9ad54, roughness: 0.16, metalness: 0.25, clearcoat: 1 });

function mesh(g: THREE.BufferGeometry, m: THREE.Material, parent: THREE.Object3D, x = 0, y = 0, z = 0) {
  const o = new THREE.Mesh(g, m); o.position.set(x, y, z); o.castShadow = true; o.receiveShadow = true; parent.add(o); return o;
}
function ellipsoid(parent: THREE.Object3D, mat: THREE.Material, x: number, y: number, z: number, sx: number, sy: number, sz: number) {
  const o = mesh(new THREE.SphereGeometry(1, 24, 16), mat, parent, x, y, z); o.scale.set(sx, sy, sz); return o;
}

export function helmetAndGoggles() {
  const g = new THREE.Group(); g.name = 'helmet-and-goggles';
  const helmet = mesh(new THREE.SphereGeometry(1, 36, 24, 0, Math.PI * 2, 0, Math.PI * 0.60), shell, g, 0, 0.065, 0.004);
  helmet.scale.set(0.116, 0.136, 0.146);
  const rim = mesh(new THREE.TorusGeometry(0.114, 0.007, 8, 40), rubber, g, 0, 0.027, 0.004);
  rim.rotation.x = Math.PI / 2; rim.scale.y = 1.24;
  for (const side of [-1, 1]) {
    ellipsoid(g, rubber, side * 0.106, -0.018, 0.014, 0.018, 0.055, 0.045);
    // Helmet ear straps run under the jaw, not across the face.
    const strap = mesh(new THREE.BoxGeometry(0.011, 0.108, 0.009), rubber, g, side * 0.078, -0.061, 0.015);
    strap.rotation.z = side * -0.35;
    mesh(new THREE.BoxGeometry(0.018, 0.014, 0.011), shell, g, side * 0.061, -0.104, 0.015);
  }
  for (const x of [-0.065, -0.032, 0, 0.032, 0.065]) {
    const vent = mesh(new THREE.BoxGeometry(0.011, 0.004, 0.046), rubber, g, x, 0.202 - Math.abs(x) * 0.45, -0.035);
    vent.rotation.z = -x * 5; vent.rotation.x = -0.15;
  }
  const band = mesh(new THREE.CylinderGeometry(0.111, 0.111, 0.032, 40, 1, true), rubber, g, 0, 0.025, 0.005);
  band.scale.z = 1.23;
  const glass = (scale: number) => {
    const positions: number[] = [], ids: number[] = [], rows = 8, cols = 32;
    for (let y = 0; y <= rows; y++) for (let x = 0; x <= cols; x++) {
      const u = x / cols * 2 - 1, v = y / rows;
      const px = u * 0.108 * scale;
      const notch = Math.exp(-u * u * 26) * 0.018 * (1 - v);
      const round = 0.65 + 0.35 * Math.sqrt(Math.max(0, 1 - u * u));
      positions.push(px, (v - 0.5) * 0.076 * scale * round + notch + 0.022, -0.139 + px * px * 4.458);
    }
    for (let y = 0; y < rows; y++) for (let x = 0; x < cols; x++) {
      const a = y * (cols + 1) + x, b = a + cols + 1;
      ids.push(a, b, b + 1, a, b + 1, a + 1);
    }
    const geo = new THREE.BufferGeometry(); geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3)); geo.setIndex(ids); geo.computeVertexNormals(); return geo;
  };
  mesh(glass(1.12), rubber, g, 0, 0, -0.023);
  mesh(glass(1), lens, g, 0, 0, -0.027);
  return g;
}

export function skiBoot() {
  const g = new THREE.Group(); g.name = 'four-buckle-ski-boot';
  ellipsoid(g, shell, 0, -0.025, -0.065, 0.078, 0.085, 0.175);
  mesh(new THREE.BoxGeometry(0.143, 0.022, 0.33), rubber, g, 0, -0.098, -0.06);
  const cuff = mesh(new THREE.CylinderGeometry(0.075, 0.067, 0.225, 24), shell, g, 0, 0.057, 0.012); cuff.rotation.x = -0.12;
  const liner = mesh(new THREE.CylinderGeometry(0.069, 0.07, 0.037, 24), rubber, g, 0, 0.168, -0.002); liner.rotation.x = -0.12;
  for (const [y, z, width] of [[0.127, -0.055, 0.13], [0.047, -0.061, 0.13], [-0.001, -0.112, 0.14], [-0.012, -0.19, 0.12]]) {
    mesh(new THREE.BoxGeometry(width, 0.014, 0.018), metal, g, 0, y, z);
    mesh(new THREE.BoxGeometry(0.033, 0.019, 0.025), orange, g, 0.042, y + 0.003, z - 0.005);
  }
  mesh(new THREE.BoxGeometry(0.147, 0.029, 0.018), rubber, g, 0, 0.153, -0.05);
  return g;
}

export function skiWithBindings(festive = false) {
  const g = new THREE.Group(); g.name = 'sidecut-ski-and-bindings';
  const pos: number[] = [], col: number[] = [], ids: number[] = [];
  const segments = 50;
  for (let i = 0; i <= segments; i++) {
    const t = i / segments, z = 0.78 - t * 1.74;
    const tip = Math.max(0, (t - 0.86) / 0.14), tail = Math.max(0, (0.07 - t) / 0.07);
    const width = (0.043 + 0.021 * Math.pow(Math.abs(t - 0.44) * 1.8, 1.5)) * (1 - 0.45 * tip ** 4);
    const top = 0.021 + 0.10 * tip ** 2 + 0.027 * tail ** 2;
    for (const [x, y] of [[-width, top], [width, top], [-width, top - 0.018], [width, top - 0.018]]) {
      pos.push(x, y, z);
      const bright = t > 0.73 && t < 0.83;
      const band = (i + (x > 0 ? 3 : 0)) % 13;
      const holiday = band < 2 ? [0.78, 0.49, 0.15] : band < 6 ? [0.9, 0.84, 0.70] : [0.48, 0.021, 0.038];
      const paint = festive ? holiday : bright ? [0.87, 0.32, 0.08] : [0.035, 0.12, 0.20];
      col.push(...(y === top ? paint : [0.075, 0.08, 0.09]));
    }
  }
  for (let i = 0; i < segments; i++) {
    const a = i * 4, b = a + 4;
    ids.push(a, b+1, b, a, a+1, b+1, a+2, b+3, a+3, a+2, b+2, b+3, a, b+2, a+2, a, b, b+2, a+1, b+3, b+1, a+1, a+3, b+3);
  }
  const geo = new THREE.BufferGeometry(); geo.setAttribute('position', new THREE.Float32BufferAttribute(pos,3)); geo.setAttribute('color', new THREE.Float32BufferAttribute(col,3)); geo.setIndex(ids); geo.computeVertexNormals();
  mesh(geo, new THREE.MeshStandardNodeMaterial({vertexColors:true,roughness:0.3,metalness:0.14}), g);
  mesh(new THREE.BoxGeometry(0.073, 0.022, 0.43), metal, g, 0, 0.032, -0.025);
  for (const z of [-0.235, 0.135]) {
    mesh(new THREE.BoxGeometry(0.10, 0.052, 0.072), rubber, g, 0, 0.055, z);
    mesh(new THREE.BoxGeometry(0.075, 0.024, 0.058), metal, g, 0, 0.086, z);
  }
  return g;
}

export function skiPole(festive = false) {
  const g = new THREE.Group(); g.name = 'ski-pole';
  mesh(new THREE.CylinderGeometry(0.007, 0.004, 1.16, 10), festive ? cream : metal, g);
  if (festive) {
    const helix: THREE.Vector3[] = [];
    for (let i = 0; i <= 110; i++) {
      const t = i / 110, radius = 0.004 + t * .003;
      helix.push(new THREE.Vector3(Math.cos(t * 61) * radius, t * .95 - .46, Math.sin(t * 61) * radius));
    }
    mesh(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(helix), 110, .0023, 5, false), lacquer, g);
  }
  mesh(new THREE.CylinderGeometry(0.017, 0.019, 0.13, 14), rubber, g, 0, -0.51, 0);
  mesh(new THREE.CylinderGeometry(0.009, 0.009, 0.14, 10), orange, g, 0, -0.35, 0);
  const basket = mesh(new THREE.TorusGeometry(0.037, 0.006, 6, 16), rubber, g, 0, 0.49, 0); basket.rotation.x = Math.PI/2;
  for (let i=0;i<4;i++) { const spoke=mesh(new THREE.BoxGeometry(0.072,0.006,0.006),rubber,g,0,0.49,0);spoke.rotation.y=i*Math.PI/4; }
  const strap = mesh(new THREE.TorusGeometry(0.026, 0.003, 6, 18), rubber, g, 0.025, -0.52, 0); strap.scale.y = 1.7;
  return g;
}

export function jacketCollar(color: THREE.Color) {
  const g = new THREE.Group();
  const mat = new THREE.MeshStandardNodeMaterial({color,roughness:0.95});
  const collar = mesh(new THREE.CylinderGeometry(0.081,0.14,0.115,28,1,true),mat,g,0,-0.035,0.012);
  const lining = mesh(new THREE.CylinderGeometry(0.078,0.078,0.025,28,1,true),rubber,g,0,0.028,0.012);
  lining.material.side = THREE.DoubleSide; collar.material.side = THREE.DoubleSide;
  const hood=mesh(new THREE.TorusGeometry(0.092,0.024,12,28,Math.PI*1.5),mat,g,0,-0.025,0.06);
  hood.rotation.x=1.2; hood.rotation.z=-Math.PI*0.25; hood.scale.x=1.3;
  return { group:g, material:mat };
}
