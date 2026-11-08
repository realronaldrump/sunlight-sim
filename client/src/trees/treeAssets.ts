// Procedural tree geometry (near LOD) and impostor textures (far LOD). All generated in code.
import * as THREE from 'three/webgpu';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

// species: 0 spruce/fir, 1 Douglas-fir, 2 aspen (bare), 3 Gambel oak (bare shrub)

function colorize(g: THREE.BufferGeometry, fn: (p: THREE.Vector3, n: THREE.Vector3) => THREE.Color) {
  const pos = g.getAttribute('position'), nor = g.getAttribute('normal');
  const col = new Float32Array(pos.count * 3);
  const p = new THREE.Vector3(), n = new THREE.Vector3();
  for (let i = 0; i < pos.count; i++) {
    p.fromBufferAttribute(pos, i); n.fromBufferAttribute(nor, i);
    const c = fn(p, n);
    col[i * 3] = c.r; col[i * 3 + 1] = c.g; col[i * 3 + 2] = c.b;
  }
  g.setAttribute('color', new THREE.BufferAttribute(col, 3));
  return g;
}

function rand(seed: number) {
  let s = seed;
  return () => { s = (s * 16807) % 2147483647; return (s - 1) / 2147483646; };
}

/** Conifer normalized to height 1 and crown radius 1 (scaled per instance). */
export function coniferGeometry(kind: 0 | 1, detail: 'high' | 'low'): THREE.BufferGeometry {
  const parts: THREE.BufferGeometry[] = [];
  const r = rand(kind === 0 ? 7 : 13);
  const trunk = new THREE.CylinderGeometry(0.035, 0.06, 0.35, 6);
  trunk.translate(0, 0.175, 0);
  parts.push(colorize(trunk.toNonIndexed(), () => new THREE.Color(0x4a3426)));
  const layers = detail === 'high' ? (kind === 0 ? 9 : 7) : 3;
  const radial = detail === 'high' ? 9 : 6;
  for (let i = 0; i < layers; i++) {
    const t = i / layers;
    const y0 = 0.12 + t * 0.8;
    const h = (kind === 0 ? 0.24 : 0.28) * (1 - t * 0.35);
    const rad = (kind === 0 ? 0.95 : 1.0) * Math.pow(1 - t, kind === 0 ? 0.95 : 0.8) * (0.9 + r() * 0.2) + 0.05;
    const cone = new THREE.ConeGeometry(rad, h, radial, 1, true);
    // jagged rim: push alternate rim vertices in/out
    const pos = cone.getAttribute('position');
    for (let k = 0; k < pos.count; k++) {
      if (pos.getY(k) < 0) {
        const s = 0.75 + r() * 0.45;
        pos.setX(k, pos.getX(k) * s); pos.setZ(k, pos.getZ(k) * s);
        pos.setY(k, pos.getY(k) - r() * 0.04);
      }
    }
    cone.computeVertexNormals();
    cone.rotateY(r() * Math.PI);
    cone.translate(0, y0 + h / 2, 0);
    parts.push(colorize(cone.toNonIndexed(), (p, n) => {
      // snow on the top surfaces, dark needles below
      const snowy = Math.max(0, n.y - 0.25) * 1.5 * (0.6 + 0.4 * Math.sin(p.x * 40 + p.z * 31));
      const base = kind === 0 ? new THREE.Color(0x1d3324) : new THREE.Color(0x24382a);
      return base.lerp(new THREE.Color(0xe8eef5), Math.min(0.85, snowy));
    }));
  }
  const g = mergeGeometries(parts);
  g.computeBoundingSphere();
  return g;
}

/** Bare aspen: pale trunk with dark marks and a sparse branch crown. Height 1, radius ~1. */
export function aspenGeometry(detail: 'high' | 'low'): THREE.BufferGeometry {
  const parts: THREE.BufferGeometry[] = [];
  const r = rand(29);
  const trunk = new THREE.CylinderGeometry(0.018, 0.032, 1.0, detail === 'high' ? 7 : 4);
  trunk.translate(0, 0.5, 0);
  parts.push(colorize(trunk.toNonIndexed(), (p) => {
    const mark = Math.sin(p.y * 90) > 0.93 ? 0.35 : 1;
    return new THREE.Color(0xd8d6cc).multiplyScalar(mark * (p.y < 0.08 ? 0.6 : 1));
  }));
  const nb = detail === 'high' ? 14 : 5;
  for (let i = 0; i < nb; i++) {
    const y = 0.45 + r() * 0.5;
    const len = 0.25 + r() * 0.35 * (1 - (y - 0.45));
    const br = new THREE.CylinderGeometry(0.004, 0.01, len, 3);
    br.translate(0, len / 2, 0);
    br.rotateZ(0.5 + r() * 0.6);
    br.rotateY(r() * Math.PI * 2);
    br.translate(0, y, 0);
    parts.push(colorize(br.toNonIndexed(), () => new THREE.Color(0x8a8578)));
  }
  if (detail === 'high') {
    // fine twig haze: a few grey translucent-looking planes approximated by dark thin boxes
    for (let i = 0; i < 6; i++) {
      const tw = new THREE.ConeGeometry(0.25 + r() * 0.1, 0.25, 5, 1, true);
      tw.translate(0, 0.78 + r() * 0.18, 0);
      parts.push(colorize(tw.toNonIndexed(), () => new THREE.Color(0x6f675e)));
      break;
    }
  }
  return mergeGeometries(parts);
}

/** Gambel oak clump: several crooked grey-brown stems with a dense twiggy dome (bare, a few dead leaves). */
export function oakGeometry(detail: 'high' | 'low'): THREE.BufferGeometry {
  const parts: THREE.BufferGeometry[] = [];
  const r = rand(41);
  const stems = detail === 'high' ? 6 : 3;
  for (let i = 0; i < stems; i++) {
    const h = 0.6 + r() * 0.35;
    const s = new THREE.CylinderGeometry(0.012, 0.025, h, 4);
    s.translate(0, h / 2, 0);
    s.rotateZ((r() - 0.5) * 0.5); s.rotateX((r() - 0.5) * 0.5);
    s.translate((r() - 0.5) * 0.4, 0, (r() - 0.5) * 0.4);
    parts.push(colorize(s.toNonIndexed(), () => new THREE.Color(0x5b4e44)));
  }
  const dome = new THREE.IcosahedronGeometry(0.8, detail === 'high' ? 1 : 0);
  dome.scale(1, 0.55, 1); dome.translate(0, 0.62, 0);
  parts.push(colorize(dome.toNonIndexed(), (p, n) => {
    const snowy = Math.max(0, n.y - 0.5) * 1.2;
    return new THREE.Color(0x6e5440).lerp(new THREE.Color(0xdfe5ec), Math.min(0.6, snowy));
  }));
  return mergeGeometries(parts);
}

/** Impostor texture atlas (4 species side by side, 256x256 each) drawn on a canvas. */
export function impostorAtlas(): THREE.CanvasTexture {
  const S = 256;
  const cv = document.createElement('canvas');
  cv.width = S * 4; cv.height = S;
  const g = cv.getContext('2d')!;
  g.clearRect(0, 0, cv.width, cv.height);
  const r = rand(5);
  // 0 spruce: narrow spire with layered jagged branches and snow
  const conifer = (ox: number, width: number, col: string, snow: string) => {
    g.fillStyle = '#3b2a20';
    g.fillRect(ox + S / 2 - 4, S * 0.82, 8, S * 0.18);
    const layers = 14;
    for (let i = 0; i < layers; i++) {
      const t = i / layers;
      const y = S * (0.88 - t * 0.84);
      const w = width * Math.pow(1 - t, 0.9) * (0.85 + r() * 0.3) + 6;
      g.fillStyle = col;
      g.beginPath();
      g.moveTo(ox + S / 2 - w, y);
      for (let k = 0; k <= 8; k++) {
        const xx = ox + S / 2 - w + (2 * w * k) / 8;
        g.lineTo(xx, y + (k % 2 ? 6 : 0) + r() * 4);
      }
      g.lineTo(ox + S / 2, y - S * 0.11);
      g.closePath(); g.fill();
      g.fillStyle = snow;
      g.beginPath();
      g.moveTo(ox + S / 2 - w * 0.7, y - 4);
      g.lineTo(ox + S / 2, y - S * 0.1);
      g.lineTo(ox + S / 2 + w * 0.5, y - 6);
      g.closePath(); g.globalAlpha = 0.55; g.fill(); g.globalAlpha = 1;
    }
  };
  conifer(0, S * 0.36, '#1c3122', '#e6edf3');
  conifer(S, S * 0.44, '#233829', '#e2e9ef');
  // 2 aspen: pale trunk and grey twig crown
  {
    const ox = S * 2;
    g.strokeStyle = '#d9d6cc'; g.lineWidth = 7;
    g.beginPath(); g.moveTo(ox + S / 2, S); g.lineTo(ox + S / 2, S * 0.1); g.stroke();
    g.strokeStyle = 'rgba(110,100,92,0.85)';
    for (let i = 0; i < 140; i++) {
      const y = S * (0.12 + r() * 0.5);
      const a = (r() - 0.5) * 2.2;
      const len = 20 + r() * 50;
      g.lineWidth = 1 + r() * 1.5;
      g.beginPath(); g.moveTo(ox + S / 2, y + 30); g.lineTo(ox + S / 2 + Math.sin(a) * len, y + 30 - Math.cos(a) * len); g.stroke();
    }
  }
  // 3 oak clump
  {
    const ox = S * 3;
    for (let i = 0; i < 260; i++) {
      const a = r() * Math.PI, rr = r();
      const x = ox + S / 2 + Math.cos(a) * rr * S * 0.42, y = S * 0.95 - Math.sin(a) * rr * S * 0.55;
      g.fillStyle = r() < 0.7 ? 'rgba(98,76,58,0.9)' : 'rgba(150,110,70,0.9)';
      g.fillRect(x, y, 4 + r() * 6, 3 + r() * 5);
    }
  }
  const tex = new THREE.CanvasTexture(cv);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.generateMipmaps = true;
  tex.minFilter = THREE.LinearMipmapLinearFilter;
  tex.anisotropy = 4;
  return tex;
}

/** Two crossed quads, unit height, base at y=0, half-width 1, with uv offset per species via attribute. */
export function crossQuadGeometry(): THREE.BufferGeometry {
  const a = new THREE.PlaneGeometry(2, 1); a.translate(0, 0.5, 0);
  const b = a.clone(); b.rotateY(Math.PI / 2);
  return mergeGeometries([a, b]);
}
