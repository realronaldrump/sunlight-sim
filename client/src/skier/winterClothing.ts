// The atlas is sampled in the bind pose, so the cut panels, pocket welts and stitching deform
// with the skier. Live rigs and baked chair passengers use the same pigments and cloth finish.
import * as THREE from 'three/webgpu';
import { attribute, color, mix, smoothstep, texture, uv, varying, vec2, vec3 } from 'three/tsl';
import type { Node } from 'three/webgpu';

const neutral = new THREE.DataTexture(new Uint8Array([199, 0, 0, 255]), 1, 1);
neutral.needsUpdate = true;
let cloth: THREE.Texture = neutral;
let faces: THREE.Texture = neutral;

export async function loadWinterClothing() {
  if (cloth !== neutral) return;
  const loader = new THREE.TextureLoader();
  const [map, portraits] = await Promise.all([
    loader.loadAsync(new URL('./assets/winter-clothing.webp', import.meta.url).href),
    loader.loadAsync(new URL('./assets/guest-faces.webp', import.meta.url).href),
  ]);
  // glTF UVs start at the top of the image. This is a linear material mask.
  map.flipY = false;
  map.anisotropy = 4;
  map.needsUpdate = true;
  cloth = map;
  portraits.flipY = false;
  portraits.colorSpace = THREE.SRGBColorSpace;
  portraits.anisotropy = 4;
  portraits.needsUpdate = true;
  faces = portraits;
}

export function faceStyle(jacket: number, scale = 1) {
  return (Math.imul(jacket, 0x45d9f3b) >>> 24) % (scale < 0.9 ? 2 : 4);
}

/** Pick a coordinated fabric for the yoke/side panels from the guest's existing jacket colour. */
export function jacketAccent(jacket: THREE.Color, out: THREE.Color) {
  const hex = jacket.getHex();
  const choices = [0x253844, 0x394654, 0x495b63, 0xa9aaa1, 0x473e49, 0x33454a];
  const choice = ((hex >> 16) + ((hex >> 8) & 255) * 3 + (hex & 255) * 7) % choices.length;
  return out.setHex(choices[choice]).lerp(jacket, 0.2);
}

/** A stable adult build across the lift line, chair and slope. Lesson sizes come from the roster. */
export function guestBuild(out: THREE.Vector3, jacket: number, hat: number, size?: number) {
  if (size !== undefined) return out.setScalar(size);
  const seed = Math.imul(jacket ^ hat, 0x45d9f3b) >>> 0;
  const width = 0.91 + ((seed & 255) / 255) * 0.18;
  return out.set(width, 0.96 + (((seed >>> 8) & 255) / 255) * 0.08, 0.98 + (width - 1) * 0.7);
}

export function clothingSurface(
  jacket: Node<'vec3'>,
  accent: Node<'vec3'>,
  skin: Node<'vec3'>,
  face: Node<'float'>,
  coatMask: Node<'float'>,
  skinMask: Node<'float'>,
  clothMask: Node<'float'>,
) {
  const detail = texture(cloth);
  // Tint at the vertices first. Interpolating white cloth and dark glove leather before
  // applying their dye produces a pale fringe along cuffs and the waist.
  const dye = (pigment: Node<'vec3'>) =>
    varying(
      attribute('color', 'vec3')
        .mul(mix(vec3(1), pigment, coatMask))
        .mul(mix(vec3(1), skin, skinMask)),
    );
  const base = mix(dye(jacket), dye(accent), detail.g.mul(clothMask));
  const relief = detail.r.div(0.78);
  const trim = color(0x57626a).mul(relief.mul(relief));
  const coords = uv().sub(vec2(0.625, 0.15625)).div(vec2(0.375, 0.71875)).clamp(0.002, 0.998);
  const tile = vec2(face.mod(2), face.div(2).floor());
  const faceColor = texture(faces, coords.add(tile).mul(0.5)).rgb.mul(skin);
  const faceCoverage = skinMask.mul(smoothstep(0.625, 0.634, uv().x), clothMask);
  const kit = mix(base, mix(base.mul(relief), trim, detail.b), clothMask);
  return {
    colorNode: mix(kit, faceColor, faceCoverage.mul(0.83)),
    relief,
    faceColor,
    faceCoverage,
    roughnessDelta: detail.b.mul(clothMask).mul(-0.27),
  };
}
