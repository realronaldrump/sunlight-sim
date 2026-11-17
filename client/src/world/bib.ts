// Ski school bibs and the instructor's printed uniform, painted onto the CC0 human's torso.
// The body keeps its jacket, skin tone and roughness masks; the print covers the front and back of
// the torso (a bib's open sides, or the whole uniform jacket). Attributes are packed so a dressed
// body uses no more vertex buffers than the original (WebGPU allows eight per draw).
import * as THREE from 'three/webgpu';
import { attribute, mix, texture, vec2, float } from 'three/tsl';
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
  /** Ski patrol: a white cross on the back and a small one on the chest. */
  cross?: boolean;
}

function printTexture(p: BibPrint) {
  const canvas = document.createElement('canvas');
  canvas.width = 1024; canvas.height = 512;
  const ctx = canvas.getContext('2d')!;
  // The uniform is screen-printed directly on the shell. Children's bibs have a separate
  // mesh panel, woven binding at both edges and a number readable from either direction.
  if (p.cut === 'bib') {
    ctx.fillStyle = p.color; ctx.fillRect(0, 0, 1024, 512);
    for (const center of [256, 768]) {
      ctx.fillStyle = '#c7531e';
      ctx.beginPath(); ctx.moveTo(center-256,0); ctx.lineTo(center+256,0);
      ctx.lineTo(center+256,77); ctx.quadraticCurveTo(center,12,center-256,77); ctx.fill();
      for (const side of [-1,1]) {
        ctx.strokeStyle = '#3c3941'; ctx.lineWidth = 14; ctx.beginPath();
        ctx.moveTo(center+side*149,0); ctx.bezierCurveTo(center+side*127,115,center+side*150,304,center+side*153,512); ctx.stroke();
        ctx.strokeStyle = '#edc49a'; ctx.lineWidth = 2; ctx.setLineDash([5,4]); ctx.stroke(); ctx.setLineDash([]);
      }
      ctx.fillStyle = '#efc294'; ctx.fillRect(center-142,430,284,5);
    }
    ctx.fillStyle = 'rgba(65,42,32,.12)';
    for (let y=2; y<512; y+=7) for (let x=(y%2)*3; x<1024; x+=7) ctx.fillRect(x,y,2,2);
  }
  ctx.fillStyle = p.ink; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  const lettering = (text: string, x: number,y: number,size: number, width: number) => {
    ctx.font = `bold ${size}px Helvetica, Arial, sans-serif`;
    ctx.fillText(text,x,y,width);
  };
  if (p.frontTitle) lettering(p.frontTitle,p.cut === 'bib' ? 256 : 339,145,p.cut === 'bib' ? 30 : 23,p.cut === 'bib' ? 244 : 102);
  if (p.number) {
    for (const x of [256,768]) lettering(p.number,x,290,193,235);
  }
  if (p.backTitle) lettering(p.backTitle,768,p.backName ? 256 : 132,p.backName ? 21 : 26,292);
  if (p.backName) lettering(p.backName,768,p.cross ? 145 : 200,58,298);
  if (p.cross) {
    ctx.fillRect(741,218,54,163); ctx.fillRect(686,273,164,54);
    ctx.fillRect(211,155,19,57); ctx.fillRect(192,174,57,19);
  }
  const map = new THREE.CanvasTexture(canvas);
  map.colorSpace = THREE.SRGBColorSpace;
  map.anisotropy = 4;
  return map;
}

const dressed = new WeakMap<THREE.BufferGeometry, Map<string, THREE.BufferGeometry>>();

/** Both sides of the print and its coverage share one vertex buffer. */
function dressGeometry(source: THREE.BufferGeometry, bones: THREE.Bone[], cut: BibPrint['cut']) {
  let byCut = dressed.get(source);
  if (!byCut) dressed.set(source, byCut = new Map());
  const cached = byCut.get(cut);
  if (cached) return cached;
  const geometry = source.clone();
  const position = geometry.getAttribute('position'), joints = geometry.getAttribute('skinIndex'), weights = geometry.getAttribute('skinWeight');
  const jacket = geometry.getAttribute('jacket'), skin = geometry.getAttribute('skinTone');
  const print = new Float32Array(position.count * 4);
  const sleeveBones = bones.map(({ name }) => /upperarm|lowerarm|hand|index|middle|ring|pinky|thumb/.test(name));
  const smooth = THREE.MathUtils.smoothstep;
  for (let i = 0; i < position.count; i++) {
    const x = position.getX(i), y = position.getY(i), z = position.getZ(i);
    let sleeve = 0;
    for (let j = 0; j < 4; j++) if (sleeveBones[joints.getComponent(i, j)]) sleeve += weights.getComponent(i, j);
    const torso = smooth(y, 0.97, 1.0) * (1 - smooth(y, 1.44, 1.48)) * (1 - smooth(sleeve, 0.16, 0.6)) * jacket.getX(i) * (1 - skin.getX(i));
    const panel = cut === 'bib' ? 1 - smooth(Math.abs(x), 0.135, 0.165) : 1;
    print[i * 4 + 3] = smooth(-z, -0.03, 0.05);
    print[i * 4] = THREE.MathUtils.clamp(0.5 + x / 0.55, 0.003, 0.997);
    print[i * 4 + 1] = THREE.MathUtils.clamp((y - 0.99) / 0.5, 0.003, 0.997);
    print[i * 4 + 2] = torso * panel;
  }
  geometry.setAttribute('print', new THREE.BufferAttribute(print, 4));
  byCut.set(cut, geometry);
  return geometry;
}

/** Re-dress one body. Jacket and skin tone stay adjustable through the body's own uniforms. */
export function dressBib(human: HumanBody, p: BibPrint) {
  human.mesh.geometry = dressGeometry(human.mesh.geometry, human.mesh.skeleton.bones, p.cut);
  const fit = attribute('print', 'vec4'), map = printTexture(p);
  const front = texture(map, vec2(float(1).sub(fit.x).mul(0.5), fit.y));
  const back = texture(map, vec2(fit.x.mul(0.5).add(0.5), fit.y));
  const ink = mix(back, front, fit.w), coverage = fit.z.mul(ink.a);
  const material = human.mesh.material as THREE.MeshStandardNodeMaterial;
  material.colorNode = mix(human.fabric.colorNode, ink.rgb.mul(human.fabric.relief.mul(.20).add(.80)), coverage);
  material.roughnessNode = mix(attribute('roughness', 'float').add(human.fabric.roughnessDelta), float(.84), coverage);
}
