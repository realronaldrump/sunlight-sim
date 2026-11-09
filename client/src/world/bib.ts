// Ski school bibs and the instructor's printed uniform, painted onto the CC0 human's torso.
// The body keeps its jacket, skin tone and roughness masks; the print covers the front and back of
// the torso (a bib's open sides, or the whole uniform jacket). Attributes are packed so a dressed
// body uses no more vertex buffers than the original (WebGPU allows eight per draw).
import * as THREE from 'three/webgpu';
import { attribute, mix, texture, vec2, vec3, float } from 'three/tsl';
import type { HumanBody } from '../skier/humanBody';

export interface BibPrint {
  /** Background colour of the printed panel (bib fabric, or the uniform jacket). */
  color: string;
  ink: string;
  number?: string;
  /** Small lettering above the number on the back. */
  backTitle?: string;
  /** Large lettering on the back (instructor uniform). */
  backName?: string;
  frontTitle?: string;
  /** 'bib': front and back panels with open sides. 'uniform': the whole torso. */
  cut: 'bib' | 'uniform';
}

function printTexture(p: BibPrint) {
  const canvas = document.createElement('canvas');
  canvas.width = 1024; canvas.height = 512;
  const ctx = canvas.getContext('2d')!;
  ctx.fillStyle = p.color; ctx.fillRect(0, 0, 1024, 512);
  // subtle fabric weave
  ctx.globalAlpha = 0.06; ctx.fillStyle = '#000';
  for (let y = 0; y < 512; y += 6) ctx.fillRect(0, y, 1024, 2);
  ctx.globalAlpha = 1;
  ctx.fillStyle = p.ink; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  const font = (px: number, weight = 'bold') => `${weight} ${px}px Helvetica, Arial, sans-serif`;
  // front half (left of the canvas), centred on the chest
  if (p.frontTitle) { ctx.font = font(p.cut === 'bib' ? 26 : 30); ctx.fillText(p.frontTitle, p.cut === 'bib' ? 256 : 330, p.cut === 'bib' ? 120 : 150); }
  if (p.number) { ctx.font = font(170); ctx.fillText(p.number, 256, 290); }
  // back half
  if (p.backTitle) { ctx.font = font(30); ctx.fillText(p.backTitle, 768, p.backName ? 300 : 120); }
  if (p.backName) { ctx.font = font(62); ctx.fillText(p.backName, 768, 220); }
  if (p.number) { ctx.font = font(190); ctx.fillText(p.number, 768, 300); }
  if (p.cut === 'bib') {
    // hemmed edges of the panels
    ctx.strokeStyle = 'rgba(0,0,0,0.25)'; ctx.lineWidth = 8;
    ctx.strokeRect(96, 4, 320, 504); ctx.strokeRect(608, 4, 320, 504);
  }
  const map = new THREE.CanvasTexture(canvas);
  map.colorSpace = THREE.SRGBColorSpace;
  map.anisotropy = 4;
  return map;
}

const dressed = new WeakMap<THREE.BufferGeometry, Map<string, THREE.BufferGeometry>>();

/** Geometry with packed masks: look = (jacket, skinTone, roughness, front), print = (u, v, coverage, 0). */
function dressGeometry(source: THREE.BufferGeometry, bones: THREE.Bone[], cut: BibPrint['cut']) {
  let byCut = dressed.get(source);
  if (!byCut) dressed.set(source, byCut = new Map());
  const cached = byCut.get(cut);
  if (cached) return cached;
  const geometry = source.clone();
  const position = geometry.getAttribute('position'), joints = geometry.getAttribute('skinIndex'), weights = geometry.getAttribute('skinWeight');
  const jacket = geometry.getAttribute('jacket'), skin = geometry.getAttribute('skinTone'), rough = geometry.getAttribute('roughness');
  const look = new Float32Array(position.count * 4), print = new Float32Array(position.count * 4);
  const sleeveBones = bones.map(({ name }) => /upperarm|lowerarm|hand|index|middle|ring|pinky|thumb/.test(name));
  const smooth = THREE.MathUtils.smoothstep;
  for (let i = 0; i < position.count; i++) {
    const x = position.getX(i), y = position.getY(i), z = position.getZ(i);
    let sleeve = 0;
    for (let j = 0; j < 4; j++) if (sleeveBones[joints.getComponent(i, j)]) sleeve += weights.getComponent(i, j);
    const torso = smooth(y, 0.97, 1.0) * (1 - smooth(y, 1.44, 1.48)) * (1 - smooth(sleeve, 0.16, 0.6)) * jacket.getX(i) * (1 - skin.getX(i));
    const panel = cut === 'bib' ? 1 - smooth(Math.abs(x), 0.135, 0.165) : 1;
    look[i * 4] = jacket.getX(i); look[i * 4 + 1] = skin.getX(i); look[i * 4 + 2] = rough.getX(i);
    look[i * 4 + 3] = smooth(-z, -0.03, 0.05);
    print[i * 4] = THREE.MathUtils.clamp(0.5 + x / 0.55, 0.003, 0.997);
    print[i * 4 + 1] = THREE.MathUtils.clamp((y - 0.99) / 0.5, 0.003, 0.997);
    print[i * 4 + 2] = torso * panel;
  }
  for (const name of ['jacket', 'skinTone', 'roughness']) geometry.deleteAttribute(name);
  geometry.setAttribute('look', new THREE.BufferAttribute(look, 4));
  geometry.setAttribute('print', new THREE.BufferAttribute(print, 4));
  byCut.set(cut, geometry);
  return geometry;
}

/** Re-dress one body. Jacket and skin tone stay adjustable through the body's own uniforms. */
export function dressBib(human: HumanBody, jacket: THREE.Color, skinTint: THREE.Color, p: BibPrint) {
  human.mesh.geometry = dressGeometry(human.mesh.geometry, human.mesh.skeleton.bones, p.cut);
  const look = attribute('look', 'vec4'), fit = attribute('print', 'vec4');
  const map = printTexture(p);
  // the viewer facing the wearer sees their right side on the left: mirror the front half
  const front = texture(map, vec2(float(1).sub(fit.x).mul(0.5), fit.y)).rgb;
  const back = texture(map, vec2(fit.x.mul(0.5).add(0.5), fit.y)).rgb;
  const printed = mix(back, front, look.w);
  const base = attribute('color', 'vec3').mul(mix(vec3(1), vec3(jacket.r, jacket.g, jacket.b), look.x)).mul(mix(vec3(1), vec3(skinTint.r, skinTint.g, skinTint.b), look.y));
  const material = new THREE.MeshStandardNodeMaterial({ roughness: 0.85 });
  material.colorNode = mix(base, printed, fit.z);
  material.roughnessNode = mix(look.z, float(0.7), fit.z);
  human.mesh.material = material;
}
