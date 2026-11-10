import * as THREE from 'three/webgpu';
import headData from './assets/santa-face/head.json';
import albedoUrl from './assets/santa-face/albedo.webp?url';
import roughnessUrl from './assets/santa-face/roughness.webp?url';

const loader = new THREE.TextureLoader();
let textures: { albedo: THREE.Texture; roughness: THREE.Texture } | undefined;

export async function loadSantaLikeness() {
  if (textures) return;
  const [albedo, roughness] = await Promise.all([loader.loadAsync(albedoUrl), loader.loadAsync(roughnessUrl)]);
  albedo.colorSpace = THREE.SRGBColorSpace;
  albedo.anisotropy = 4;
  textures = { albedo, roughness };
}

/** All points are in the ski rig's head frame, with the face looking along -Z. */
export function santaPortrait() {
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(headData.position, 3));
  geometry.setAttribute('uv', new THREE.Float32BufferAttribute(headData.uv, 2));
  geometry.setIndex(headData.index);
  geometry.computeVertexNormals();
  geometry.addGroup(0, headData.faceIndexCount, 0);
  geometry.addGroup(headData.faceIndexCount, headData.index.length - headData.faceIndexCount, 1);
  const tone = new THREE.Color().setRGB(headData.skin[0] / 255, headData.skin[1] / 255, headData.skin[2] / 255, THREE.SRGBColorSpace);
  const face = new THREE.MeshPhysicalNodeMaterial({
    color: textures ? 0xffffff : tone,
    map: textures?.albedo ?? null,
    roughness: textures ? 1 : .68,
    roughnessMap: textures?.roughness ?? null,
    specularIntensity: .4,
  });
  const skin = new THREE.MeshStandardNodeMaterial({ color: tone, roughness: .72 });
  const mesh = new THREE.Mesh(geometry, [face, skin]);
  mesh.name = 'santa-portrait';
  mesh.castShadow = true; mesh.receiveShadow = true;
  return { mesh, skullIndexCount: headData.skullIndexCount };
}
