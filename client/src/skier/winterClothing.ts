// The atlas is sampled in the bind pose, so the cut panels, pocket welts and stitching deform
// with the skier. Live rigs and baked chair passengers use the same pigments and cloth finish.
import * as THREE from 'three/webgpu';
import { attribute, color, mix, texture, varying, vec3 } from 'three/tsl';
import type { Node } from 'three/webgpu';

const neutral = new THREE.DataTexture(new Uint8Array([199, 0, 0, 255]), 1, 1);
neutral.needsUpdate = true;
let cloth: THREE.Texture = neutral;

export async function loadWinterClothing() {
  if (cloth !== neutral) return;
  const map = await new THREE.TextureLoader().loadAsync(new URL('./assets/winter-clothing.webp', import.meta.url).href);
  // glTF UVs start at the top of the image. This is a linear material mask.
  map.flipY = false;
  map.anisotropy = 4;
  map.needsUpdate = true;
  cloth = map;
}

/** Pick a coordinated fabric for the yoke/side panels from the guest's existing jacket colour. */
export function jacketAccent(jacket: THREE.Color, out: THREE.Color) {
  const hex = jacket.getHex();
  const choices = [0x253844, 0x394654, 0x495b63, 0xa9aaa1, 0x473e49, 0x33454a];
  const choice = ((hex >> 16) + ((hex >> 8) & 255) * 3 + (hex & 255) * 7) % choices.length;
  return out.setHex(choices[choice]).lerp(jacket, .20);
}

/** A stable adult build across the lift line, chair and slope. Lesson sizes come from the roster. */
export function guestBuild(out: THREE.Vector3, jacket: number, hat: number, size?: number) {
  if (size !== undefined) return out.setScalar(size);
  const seed = Math.imul(jacket ^ hat, 0x45d9f3b) >>> 0;
  const width = .91 + (seed & 255) / 255 * .18;
  return out.set(width, .96 + ((seed >>> 8) & 255) / 255 * .08, .98 + (width - 1) * .7);
}

export function clothingSurface(jacket: Node<'vec3'>, accent: Node<'vec3'>, skin: Node<'vec3'>,
    coatMask: Node<'float'>, skinMask: Node<'float'>, clothMask: Node<'float'>) {
  const detail = texture(cloth);
  // Tint at the vertices first. Interpolating white cloth and dark glove leather before
  // applying their dye produces a pale fringe along cuffs and the waist.
  const dye = (pigment: Node<'vec3'>) => varying(attribute('color', 'vec3')
    .mul(mix(vec3(1), pigment, coatMask)).mul(mix(vec3(1), skin, skinMask)));
  const base = mix(dye(jacket), dye(accent), detail.g.mul(clothMask));
  const relief = detail.r.div(.78);
  const trim = color(0x57626a).mul(relief.mul(relief));
  return {
    colorNode: mix(base, mix(base.mul(relief), trim, detail.b), clothMask),
    relief,
    roughnessDelta: detail.b.mul(clothMask).mul(-.27),
  };
}
