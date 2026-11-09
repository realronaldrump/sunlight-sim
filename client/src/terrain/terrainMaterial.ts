// @ts-nocheck -- TSL node graphs: @types/three node typings are too strict to be useful here.
// Snow terrain material (TSL). Handles earth curvature, groomed corduroy, glades, rock on very steep
// faces, forest darkening at distance, snow sparkle, and the beginner slope-angle overlay.
import * as THREE from 'three/webgpu';
import {
  Fn, uniform, vec2, vec3, vec4, float, positionLocal, positionWorld, normalWorldGeometry, modelWorldMatrix,
  dot, mix, smoothstep, clamp, acos, texture, cameraPosition, normalize, abs, sin,
  length, select, step, mx_noise_float,
} from 'three/tsl';
import { EARTH_R_EFF } from '../../../shared/world';
import { createSnowSurface, useSnowLighting } from './snowSurface';

export interface TerrainMaterialHandles {
  material: THREE.MeshStandardNodeMaterial;
  viewer: { value: THREE.Vector3 };
  slopeOverlay: { value: number };
  sunDir: { value: THREE.Vector3 };
  ready: Promise<void>;
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

  const nW = normalize(normalWorldGeometry);
  const slopeDeg = acos(clamp(nW.y, 0.0, 1.0)).mul(57.29578);
  const dist = length(positionWorld.sub(cameraPosition));

  const overlayColor = Fn(() => {
    const ov = vec3(0.10, 0.75, 0.18).toVar(); // < 15 deg  green
    ov.assign(select(slopeDeg.greaterThan(15.0), vec3(0.08, 0.35, 1.0), ov)); // 15-25 blue
    ov.assign(select(slopeDeg.greaterThan(25.0), vec3(0.05, 0.05, 0.07), ov)); // 25-35 black
    ov.assign(select(slopeDeg.greaterThan(35.0), vec3(1.0, 0.32, 0.0), ov)); // 35-45 orange
    ov.assign(select(slopeDeg.greaterThan(45.0), vec3(0.95, 0.05, 0.05), ov)); // > 45 red
    return ov;
  });
  const overlay = overlayColor();
  const snowDetail = createSnowSurface(surf, dist, plowed);
  // Keep exposed faces and distant canopy out of the snow reflection model.
  const rockT = mix(float(48.0), float(33.0), smoothstep(1500.0, 15000.0, dist));
  const rock = smoothstep(rockT, rockT.add(10.0), slopeDeg).mul(float(1.0).sub(surf.g)).mul(0.85);

  const colorFn = Fn(() => {
    const canopy = surf.b;
    const landCanopy = land.r.mul(float(1.0).sub(inSurf)); // forest where no tree instances are drawn
    const snow = snowDetail.color.toVar();
    const n1 = mx_noise_float(vec3(xn.x.mul(0.3), 3.0, xn.y.mul(0.3))).mul(0.5).add(0.5);
    // forest from afar: trees darken the snow surface (only beyond near tree rendering range)
    // forest floor under the canopy is in shade; from afar the trees themselves dominate
    const midForest = smoothstep(120.0, 700.0, dist).mul(canopy).mul(0.38);
    const farForest = smoothstep(1500.0, 4000.0, dist).mul(canopy).mul(0.45);
    const forestCol = vec3(0.13, 0.17, 0.15);
    snow.assign(mix(snow, forestCol, midForest.add(farForest)));
    // distant forests (ESA WorldCover): dark conifer/aspen stands with some snow showing through
    const speck = mx_noise_float(vec3(xn.x.mul(0.08), 5.0, xn.y.mul(0.08))).mul(0.5).add(0.5);
    const farCol = vec3(0.11, 0.145, 0.13).add(vec3(0.08).mul(speck));
    snow.assign(mix(snow, farCol, landCanopy.mul(0.78)));
    // Mogul light and shade comes from the existing terrain geometry, not painted fake shadows.
    // plowed roads and parking lots: packed snow over gravel with tyre tracks
    const tracks = abs(sin(dot(vec2(positionWorld.x, positionWorld.z), vec2(0.7, 0.7)).mul(3.1))).mul(0.06);
    const plowCol = vec3(0.58, 0.56, 0.53).mul(float(0.92).add(n1.mul(0.12)).sub(tracks));
    snow.assign(mix(snow, plowCol, plowed.mul(0.8)));
    const rockCol = vec3(0.32, 0.30, 0.29).mul(float(0.85).add(n1.mul(0.3)));
    snow.assign(mix(snow, rockCol, rock));
    // beginner slope-angle overlay
    return mix(snow, overlay, slopeOverlay.mul(0.9));
  });
  mat.colorNode = colorFn();

  mat.normalNode = snowDetail.normal;
  mat.roughnessNode = mix(snowDetail.roughness, float(0.92), rock);
  mat.aoNode = snowDetail.ao;
  mat.metalnessNode = float(0.0);
  useSnowLighting(mat, rock.oneMinus().mul(plowed.oneMinus()).mul(slopeOverlay.oneMinus()), dist);
  // The beginner aid alone is self-lit so its colors remain legible in shadow.
  mat.emissiveNode = overlay.mul(slopeOverlay).mul(0.5);

  return {
    material: mat,
    viewer: viewerUniform,
    slopeOverlay,
    sunDir,
    ready: snowDetail.ready,
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
