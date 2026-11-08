// @ts-nocheck -- TSL node graphs: @types/three node typings are too strict to be useful here.
// Snow terrain material (TSL). Handles earth curvature, groomed corduroy, glades, rock on very steep
// faces, forest darkening at distance, snow sparkle, and the beginner slope-angle overlay.
import * as THREE from 'three/webgpu';
import {
  Fn, uniform, vec2, vec3, vec4, float, positionLocal, positionWorld, normalWorld, modelWorldMatrix,
  dot, mix, smoothstep, clamp, acos, texture, cameraPosition, normalize, hash, floor, fract, abs, sin,
  max, length, select, step, pow, exp, mx_noise_float, dFdx, dFdy, cross, sign, normalView, positionView,
  transformNormalToView, attribute,
} from 'three/tsl';
import { EARTH_R_EFF } from '../../../shared/world';

export interface TerrainMaterialHandles {
  material: THREE.MeshStandardNodeMaterial;
  viewer: { value: THREE.Vector3 };
  slopeOverlay: { value: number };
  sunDir: { value: THREE.Vector3 };
  setSurface(tex: THREE.Texture, x0: number, n0: number, sizeX: number, sizeN: number): void;
  setLandcover(tex: THREE.Texture, x0: number, n0: number, sizeX: number, sizeN: number): void;
  setLandcoverMid(tex: THREE.Texture, x0: number, n0: number, sizeX: number, sizeN: number): void;
  setBase(tex: THREE.Texture, x0: number, n0: number, sizeX: number, sizeN: number): void;
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
  const baseBounds = uniform(new THREE.Vector4(0, 0, 1, 1));
  const midBounds = uniform(new THREE.Vector4(0, 0, 1, 1));

  mat.positionNode = curvedPosition();

  // local (x, n) of the fragment
  const xn = vec2(positionWorld.x, positionWorld.z.negate());
  const surfUV = xn.sub(surfBounds.xy).div(surfBounds.zw);
  const inSurf = step(0.0, surfUV.x).mul(step(surfUV.x, 1.0)).mul(step(0.0, surfUV.y)).mul(step(surfUV.y, 1.0));
  const surfTex = texture(placeholder, surfUV);
  const surf = surfTex.mul(inSurf);
  const landUV = xn.sub(landBounds.xy).div(landBounds.zw);
  const landTex = texture(placeholder, landUV);
  const midUV = xn.sub(midBounds.xy).div(midBounds.zw);
  const inMid = step(0.0, midUV.x).mul(step(midUV.x, 1.0)).mul(step(0.0, midUV.y)).mul(step(midUV.y, 1.0));
  const midTex = texture(placeholder, midUV);
  const land = mix(landTex, midTex, inMid);
  const baseUV = xn.sub(baseBounds.xy).div(baseBounds.zw);
  const inBase = step(0.0, baseUV.x).mul(step(baseUV.x, 1.0)).mul(step(0.0, baseUV.y)).mul(step(baseUV.y, 1.0));
  const baseTex = texture(placeholder, baseUV);
  const plowed = baseTex.r.mul(inBase);

  const nW = normalize(normalWorld);
  const flowDir = normalize(attribute('flow', 'vec2').add(vec2(1e-5, 0.0)));
  const slopeDeg = acos(clamp(nW.y, 0.0, 1.0)).mul(57.29578);
  const dist = length(positionWorld.sub(cameraPosition));

  const colorFn = Fn(() => {
    const groomed = surf.r;
    const piste = surf.g;
    const canopy = surf.b;
    const landCanopy = land.r.mul(float(1.0).sub(inSurf)); // forest where no tree instances are drawn
    const moguls = surf.a;
    // base Colorado snow: very slightly blue-white
    const snow = vec3(0.90, 0.93, 0.97).toVar();
    // subtle large-scale variation (wind packing, sun crust)
    const n1 = hash(floor(xn.mul(0.25)).dot(vec2(1.0, 157.0)));
    snow.mulAssign(float(0.985).add(n1.mul(0.03)));
    // groomed corduroy: ridges along the fall line, ~2.5 cm spacing, fade with distance
    const across = dot(vec2(positionWorld.x, positionWorld.z), vec2(flowDir.y.negate(), flowDir.x));
    const cord = abs(sin(across.mul(6.2831 / 0.04)));
    // fade the ridges once they get close to the pixel size (prevents moire)
    const footprint = abs(dFdx(across)).add(abs(dFdy(across)));
    const cordFade = float(1.0).sub(smoothstep(0.003, 0.009, footprint));
    snow.mulAssign(float(1.0).sub(groomed.mul(cordFade).mul(cord.mul(0.05))));
    // groomed snow is a touch brighter/smoother from far away
    snow.mulAssign(float(1.0).add(groomed.mul(0.015)));
    // forest from afar: trees darken the snow surface (only beyond near tree rendering range)
    // forest floor under the canopy is in shade; from afar the trees themselves dominate
    const midForest = smoothstep(120.0, 700.0, dist).mul(canopy).mul(0.38);
    const farForest = smoothstep(1500.0, 4000.0, dist).mul(canopy).mul(0.45);
    const forestCol = vec3(0.13, 0.17, 0.15);
    snow.assign(mix(snow, forestCol, midForest.add(farForest)));
    // distant forests (ESA WorldCover): dark conifer/aspen stands with some snow showing through
    const speck = hash(floor(xn.mul(0.08)).dot(vec2(13.0, 71.0)));
    const farCol = vec3(0.11, 0.145, 0.13).add(vec3(0.08).mul(speck));
    snow.assign(mix(snow, farCol, landCanopy.mul(0.78)));
    // exposed rock on very steep faces that are not runs
    // mogul fields: soft light/shade pattern of bumps (about 4 m spacing) where the run is not groomed
    const mp = vec2(positionWorld.x, positionWorld.z).mul(0.26);
    const bump = sin(mp.x.add(sin(mp.y.mul(0.7)))).mul(sin(mp.y.add(sin(mp.x.mul(0.6)))));
    const mogFade = float(1.0).sub(smoothstep(60.0, 400.0, dist));
    snow.mulAssign(float(1.0).add(bump.mul(moguls).mul(mogFade).mul(0.06)));
    // plowed roads and parking lots: packed snow over gravel with tyre tracks
    const tracks = abs(sin(dot(vec2(positionWorld.x, positionWorld.z), vec2(0.7, 0.7)).mul(3.1))).mul(0.06);
    const plowCol = vec3(0.58, 0.56, 0.53).mul(float(0.92).add(n1.mul(0.12)).sub(tracks));
    snow.assign(mix(snow, plowCol, plowed.mul(0.8)));
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

  // micro relief: wind ripples and grain everywhere, corduroy ridges on groomed runs. Applied as a
  // screen-space bump (derivative-based normal perturbation) that fades out with distance.
  mat.normalNode = Fn(() => {
    const p = positionWorld;
    const near = float(1.0).sub(smoothstep(8.0, 60.0, dist));
    const ripples = mx_noise_float(vec3(p.x.mul(0.9), 0.0, p.z.mul(2.6)).add(vec3(0.0, p.y.mul(0.3), 0.0))).mul(0.018);
    const grain = mx_noise_float(p.mul(5.0)).mul(0.0022);
    const across = dot(vec2(p.x, p.z), vec2(flowDir.y.negate(), flowDir.x));
    const footprint = abs(dFdx(across)).add(abs(dFdy(across)));
    const cordFade = float(1.0).sub(smoothstep(0.003, 0.008, footprint));
    const cord = abs(sin(across.mul(6.2831 / 0.04))).mul(0.005).mul(surf.r).mul(cordFade);
    const h = ripples.mul(float(1.0).sub(surf.r.mul(0.8))).add(grain).mul(near).add(cord);
    const dpx = dFdx(positionView), dpy = dFdy(positionView);
    const nv = normalize(transformNormalToView(nW));
    const r1 = cross(dpy, nv), r2 = cross(nv, dpx);
    const det = dot(dpx, r1);
    const grad = sign(det).mul(r1.mul(dFdx(h)).add(r2.mul(dFdy(h))));
    return normalize(abs(det).mul(nv).sub(grad));
  })();

  mat.roughnessNode = Fn(() => {
    const groomed = surf.r;
    return mix(float(0.72), float(0.6), groomed);
  })();
  mat.metalnessNode = float(0.0);

  // sparkle: tiny glints that change with view direction, only in sun and nearby
  mat.emissiveNode = Fn(() => {
    const cell = floor(positionWorld.mul(70.0));
    const seed = dot(cell, vec3(1.0, 57.0, 113.0));
    const view = normalize(cameraPosition.sub(positionWorld));
    const vq = floor(view.mul(36.0));
    const h = hash(seed.add(dot(vq, vec3(7.0, 131.0, 977.0))));
    const sunlit = clamp(dot(nW, sunDir).mul(4.0), 0.0, 1.0);
    const fade = float(1.0).sub(smoothstep(4.0, 25.0, dist));
    const glint = smoothstep(0.996, 1.0, h).mul(sunlit).mul(fade).mul(float(1.0).sub(slopeOverlay));
    return vec3(1.0, 0.98, 0.92).mul(glint.mul(2.2));
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
    setBase(tex, x0, n0, sx, sn) {
      baseTex.value = tex;
      baseBounds.value.set(x0, n0, sx, sn);
    },
    setLandcoverMid(tex, x0, n0, sx, sn) {
      midTex.value = tex;
      midBounds.value.set(x0, n0, sx, sn);
    },
    setLandcover(tex, x0, n0, sx, sn) {
      landTex.value = tex;
      landBounds.value.set(x0, n0, sx, sn);
    },
  };
}
