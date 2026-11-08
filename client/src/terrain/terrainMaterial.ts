// @ts-nocheck -- TSL node graphs: @types/three node typings are too strict to be useful here.
// Snow terrain material (TSL). Handles earth curvature, groomed corduroy, glades, rock on very steep
// faces, forest darkening at distance, snow sparkle, and the beginner slope-angle overlay.
import * as THREE from 'three/webgpu';
import {
  Fn, uniform, vec2, vec3, vec4, float, positionLocal, positionWorld, normalWorld, modelWorldMatrix,
  dot, mix, smoothstep, clamp, acos, texture, cameraPosition, normalize, hash, floor, fract, abs, sin,
  max, length, select, step, pow, exp,
} from 'three/tsl';
import { EARTH_R_EFF } from '../../../shared/world';

export interface TerrainMaterialHandles {
  material: THREE.MeshStandardNodeMaterial;
  viewer: { value: THREE.Vector3 };
  slopeOverlay: { value: number };
  sunDir: { value: THREE.Vector3 };
  setSurface(tex: THREE.Texture, x0: number, n0: number, sizeX: number, sizeN: number): void;
  setLandcover(tex: THREE.Texture, x0: number, n0: number, sizeX: number, sizeN: number): void;
}

export const viewerUniform = uniform(new THREE.Vector3());

/** Apply refraction-corrected earth curvature relative to the viewer (shared with trees). */
export const curvedPosition = Fn(() => {
  const wp = modelWorldMatrix.mul(vec4(positionLocal, 1.0)).xyz;
  const d = wp.xz.sub(viewerUniform.xz);
  const drop = dot(d, d).div(2.0 * EARTH_R_EFF);
  return positionLocal.sub(vec3(0.0, drop, 0.0));
});

export function createTerrainMaterial(): TerrainMaterialHandles {
  const mat = new THREE.MeshStandardNodeMaterial();
  const slopeOverlay = uniform(0);
  const sunDir = uniform(new THREE.Vector3(0, 1, 0));
  const placeholder = new THREE.DataTexture(new Uint8Array([0, 0, 0, 255]), 1, 1);
  placeholder.needsUpdate = true;
  const surfBounds = uniform(new THREE.Vector4(0, 0, 1, 1));
  const landBounds = uniform(new THREE.Vector4(0, 0, 1, 1));

  mat.positionNode = curvedPosition();

  // local (x, n) of the fragment
  const xn = vec2(positionWorld.x, positionWorld.z.negate());
  const surfUV = xn.sub(surfBounds.xy).div(surfBounds.zw);
  const inSurf = step(0.0, surfUV.x).mul(step(surfUV.x, 1.0)).mul(step(0.0, surfUV.y)).mul(step(surfUV.y, 1.0));
  const surfTex = texture(placeholder, surfUV);
  const surf = surfTex.mul(inSurf);
  const landUV = xn.sub(landBounds.xy).div(landBounds.zw);
  const landTex = texture(placeholder, landUV);
  const land = landTex;

  const nW = normalize(normalWorld);
  const slopeDeg = acos(clamp(nW.y, 0.0, 1.0)).mul(57.29578);
  const dist = length(positionWorld.sub(cameraPosition));

  const colorFn = Fn(() => {
    const groomed = surf.r;
    const piste = surf.g;
    const canopy = max(surf.b, land.r.mul(float(1.0).sub(inSurf)));
    const moguls = surf.a;
    // base Colorado snow: very slightly blue-white
    const snow = vec3(0.90, 0.93, 0.97).toVar();
    // subtle large-scale variation (wind packing, sun crust)
    const n1 = hash(floor(xn.mul(0.25)).dot(vec2(1.0, 157.0)));
    snow.mulAssign(float(0.985).add(n1.mul(0.03)));
    // groomed corduroy: ridges along the fall line, ~2.5 cm spacing, fade with distance
    const fall = normalize(vec2(nW.x, nW.z).add(vec2(1e-4, 0.0)));
    const across = dot(vec2(positionWorld.x, positionWorld.z), vec2(fall.y.negate(), fall.x));
    const cord = abs(sin(across.mul(6.2831 / 0.025)));
    const cordFade = float(1.0).sub(smoothstep(4.0, 22.0, dist));
    snow.mulAssign(float(1.0).sub(groomed.mul(cordFade).mul(cord.mul(0.06))));
    // groomed snow is a touch brighter/smoother from far away
    snow.mulAssign(float(1.0).add(groomed.mul(0.015)));
    // forest from afar: trees darken the snow surface (only beyond near tree rendering range)
    // forest floor under the canopy is in shade; from afar the trees themselves dominate
    const midForest = smoothstep(120.0, 700.0, dist).mul(canopy).mul(0.38);
    const farForest = smoothstep(1500.0, 4000.0, dist).mul(canopy).mul(0.45);
    const forestCol = vec3(0.13, 0.17, 0.15);
    snow.assign(mix(snow, forestCol, midForest.add(farForest)));
    // exposed rock on very steep faces that are not runs
    // mogul fields: soft light/shade pattern of bumps (about 4 m spacing) where the run is not groomed
    const mp = vec2(positionWorld.x, positionWorld.z).mul(0.26);
    const bump = sin(mp.x.add(sin(mp.y.mul(0.7)))).mul(sin(mp.y.add(sin(mp.x.mul(0.6)))));
    const mogFade = float(1.0).sub(smoothstep(60.0, 400.0, dist));
    snow.mulAssign(float(1.0).add(bump.mul(moguls).mul(mogFade).mul(0.06)));
    const rock = smoothstep(48.0, 58.0, slopeDeg).mul(float(1.0).sub(piste));
    const rockCol = vec3(0.32, 0.30, 0.29).mul(float(0.85).add(n1.mul(0.3)));
    snow.assign(mix(snow, rockCol, rock));
    // beginner slope-angle overlay
    const ov = vec3(0.10, 0.75, 0.18).toVar(); // < 15 deg  green
    ov.assign(select(slopeDeg.greaterThan(15.0), vec3(0.08, 0.35, 1.0), ov)); // 15-25 blue
    ov.assign(select(slopeDeg.greaterThan(25.0), vec3(0.05, 0.05, 0.07), ov)); // 25-35 black
    ov.assign(select(slopeDeg.greaterThan(35.0), vec3(1.0, 0.45, 0.0), ov)); // 35-45 orange
    ov.assign(select(slopeDeg.greaterThan(45.0), vec3(0.95, 0.05, 0.05), ov)); // > 45 red
    return mix(snow, ov, slopeOverlay.mul(0.78));
  });
  mat.colorNode = colorFn();

  mat.roughnessNode = Fn(() => {
    const groomed = surf.r;
    return mix(float(0.72), float(0.6), groomed);
  })();
  mat.metalnessNode = float(0.0);

  // sparkle: tiny glints that change with view direction, only in sun and nearby
  mat.emissiveNode = Fn(() => {
    const cell = floor(positionWorld.mul(28.0));
    const seed = dot(cell, vec3(1.0, 57.0, 113.0));
    const view = normalize(cameraPosition.sub(positionWorld));
    const vq = floor(view.mul(36.0));
    const h = hash(seed.add(dot(vq, vec3(7.0, 131.0, 977.0))));
    const sunlit = clamp(dot(nW, sunDir).mul(4.0), 0.0, 1.0);
    const fade = float(1.0).sub(smoothstep(6.0, 45.0, dist));
    const glint = smoothstep(0.9965, 1.0, h).mul(sunlit).mul(fade).mul(float(1.0).sub(slopeOverlay));
    return vec3(1.0, 0.98, 0.92).mul(glint.mul(3.0));
  })();

  void exp; void pow; void fract;

  return {
    material: mat,
    viewer: viewerUniform,
    slopeOverlay,
    sunDir,
    setSurface(tex, x0, n0, sx, sn) {
      surfTex.value = tex;
      surfBounds.value.set(x0, n0, sx, sn);
    },
    setLandcover(tex, x0, n0, sx, sn) {
      landTex.value = tex;
      landBounds.value.set(x0, n0, sx, sn);
    },
  };
}
