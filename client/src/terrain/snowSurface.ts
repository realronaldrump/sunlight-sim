// @ts-nocheck -- TSL node graphs use the same typing exception as terrainMaterial.ts.
import * as THREE from 'three/webgpu';
import {
  Fn, vec2, vec3, float, texture, positionWorld, positionView, normalViewGeometry,
  normalWorldGeometry, normalView, positionViewDirection, transformNormalToView,
  attribute, dot, normalize, cross, abs, sign, dFdx, dFdy, smoothstep, sin, cos, fract,
  mix, max, min, pow, floor, hash, length, mx_noise_float,
} from 'three/tsl';

/** A scanned, world-anchored snow surface. All heights are shading relief, never DEM offsets. */
export function createSnowSurface(surf, dist, plowed, state) {
  const fallback = new THREE.DataTexture(new Uint8Array([128, 128, 230, 255]), 1, 1);
  fallback.needsUpdate = true;
  const scan = texture(fallback);
  const ready = new THREE.TextureLoader().loadAsync(`${import.meta.env.BASE_URL}textures/snow/snow-detail.webp`).then((tex) => {
    tex.name = 'CC0 Snow 02: height / grain / roughness / occlusion';
    tex.colorSpace = THREE.NoColorSpace;
    tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
    tex.minFilter = THREE.LinearMipmapLinearFilter;
    tex.magFilter = THREE.LinearFilter;
    tex.anisotropy = 8;
    scan.value = tex;
    fallback.dispose();
  }).catch((error) => console.warn('Snow detail texture unavailable; using procedural snow', error));

  const p = positionWorld.xz;
  const groomed = smoothstep(0.12, 0.9, surf.r).mul(plowed.oneMinus());
  const powder = groomed.oneMinus();
  const near = float(1).sub(smoothstep(12, 55, dist));
  // Two incommensurate, rotated projections break up obvious texture repetition. The source
  // covers 2 m. Only the second low-frequency layer is enlarged for soft wind-deposited pillows.
  const scanned = scan.sample(p.mul(0.5));
  const rotated = vec2(p.x.mul(0.8).sub(p.y.mul(0.6)), p.x.mul(0.6).add(p.y.mul(0.8)));
  const drifts = scan.sample(rotated.mul(0.137).add(vec2(0.27, 0.63)));
  const driftNoise = mx_noise_float(vec3(p.x.mul(0.037), 9.2, p.y.mul(0.037)));
  const wind = mx_noise_float(vec3(rotated.x.mul(0.32), 17.0, rotated.y.mul(1.9)));
  const windExposure = smoothstep(0.08, 0.48, dot(normalWorldGeometry, vec3(-0.8, 0, 0.6))).mul(powder);

  // Coordinates are signed distances from smoothed run centerlines, in meters.
  const grooming = attribute('grooming', 'vec2');
  const across = grooming.x;
  const footprint = abs(dFdx(across)).add(abs(dFdy(across)));
  const cordFade = float(1).sub(smoothstep(0.003, 0.012, footprint));
  const phase = across.mul(2 * Math.PI / 0.032);
  const cord = cos(phase).mul(0.5).add(0.5);
  // Tiller passes have a narrow soft overlap, not evenly spaced dark road markings.
  const seamDistance = abs(fract(across.div(4.8).add(0.5)).sub(0.5)).mul(4.8);
  const seam = float(1).sub(smoothstep(0.025, 0.10, seamDistance));
  const wear = smoothstep(-0.32, 0.5, driftNoise).mul(0.28);
  // What the snow remembers (snowState.ts): skier traffic, tonight's grooming, a normal day's busy lines,
  // and new snow on top of it all.
  const memory = state.sample;
  const baseline = memory.b.mul(state.hours.div(6).clamp(0, 1)).mul(memory.g.oneMinus());
  const worn = memory.r.add(baseline.mul(0.85)).clamp(0, 1).mul(state.fresh.oneMinus());
  const hardpack = worn.mul(groomed);          // scraped, polished main line on a groomed run
  const chop = worn.mul(powder);               // skied-out chop off the groomers
  const fresh = groomed.mul(wear.oneMinus()).mul(hardpack.mul(0.9).oneMinus()).mul(state.fresh.mul(0.9).oneMinus());
  const along = grooming.y;
  // scrape streaks stretched along the run, read from the scanned snow (cheaper than procedural noise)
  const streaks = scan.sample(vec2(across.mul(0.55), along.mul(0.025))).r;
  const chopNoise = drifts.r.sub(0.5).mul(2.0);
  const grainFade = float(1).sub(smoothstep(0.012, 0.05, max(length(dFdx(p)), length(dFdy(p)))));

  const height = Fn(() => {
    const relief = scanned.r.sub(0.5).mul(mix(0.035, 0.002, groomed)).toVar();
    relief.addAssign(drifts.r.sub(0.5).mul(powder).mul(0.075));
    relief.addAssign(wind.mul(powder).mul(mix(0.004, 0.017, windExposure)));
    relief.addAssign(scanned.g.sub(0.5).mul(0.0028).mul(grainFade));
    relief.addAssign(cord.mul(0.0017).mul(cordFade).mul(fresh));
    relief.addAssign(seam.mul(0.003).mul(groomed).mul(hardpack.oneMinus()));
    // scraped streaks along the run where traffic has polished it; lumpy chop where powder was skied out
    relief.addAssign(streaks.sub(0.5).mul(0.006).mul(hardpack));
    relief.addAssign(chopNoise.mul(0.03).mul(chop));
    // a new layer of snow softens everything underneath
    relief.mulAssign(float(1).sub(state.fresh.mul(0.55)));
    return relief.mul(near).mul(plowed.mul(0.85).oneMinus());
  })();

  const normal = Fn(() => {
    const dx = dFdx(positionView), dy = dFdy(positionView);
    const n = normalViewGeometry;
    const r1 = cross(dy, n), r2 = cross(n, dx);
    const det = dot(dx, r1);
    const gradient = sign(det).mul(r1.mul(dFdx(height)).add(r2.mul(dFdy(height))));
    return normalize(max(abs(det), 1e-8).mul(n).sub(gradient));
  })();

  const cavity = scanned.a.oneMinus().mul(powder.mul(0.22).add(0.045)).mul(near);
  const microShade = cord.oneMinus().mul(cordFade).mul(fresh).mul(0.035);
  const color = vec3(0.91, 0.945, 0.98)
    .mul(float(0.99).add(driftNoise.mul(0.018)))
    .mul(microShade.oneMinus())
    .mul(mix(vec3(1), vec3(0.73, 0.84, 0.97), cavity))
    .mul(float(1).sub(seam.mul(groomed).mul(near).mul(0.018)))
    // packed, scraped snow reads a little grey-blue; fresh snow a little brighter
    .mul(mix(vec3(1), vec3(0.85, 0.895, 0.945), hardpack.mul(streaks.mul(0.55).add(0.45))))
    .mul(mix(vec3(1), vec3(0.95, 0.965, 0.98), chop.mul(0.6)))
    .mul(float(1).add(state.fresh.mul(0.02)));
  const roughness = mix(0.84, 0.65, groomed)
    .add(scanned.b.sub(0.5).mul(0.13).mul(near))
    .sub(windExposure.mul(0.08))
    // polished hardpack throws a sheen in the sun; new snow is matte
    .sub(hardpack.mul(0.17)).add(state.fresh.mul(0.12)).clamp(0.45, 0.95);
  // Ambient shelter darkens hollows without baking a light direction into the albedo.
  const ao = float(1).sub(cavity.mul(0.42)).sub(surf.b.mul(0.16)).clamp(0.68, 1);
  return { color, normal, roughness, ao, ready };
}

/** Extend Three's standard PBR light evaluation so crystals receive the same light attenuation
 * and cascade shadows as the snow. No emissive glitter, screen-space noise, or quantized view bins.
 */
class SnowLightingModel extends THREE.PhysicalLightingModel {
  constructor(private snowCoverage, private dist) { super(); }

  direct(input, builder) {
    super.direct(input, builder);
    const { lightDirection, lightColor, reflectedLight } = input;
    const p = positionWorld.xz.mul(110);
    const seed = dot(floor(p), vec2(17, 131));
    const n = normalWorldGeometry;
    const tangent = normalize(cross(n, vec3(0, 0, 1)).add(vec3(1e-5, 0, 0)));
    const bitangent = cross(n, tangent);
    const facet = normalize(n.add(tangent.mul(hash(seed).sub(0.5).mul(1.8)))
      .add(bitangent.mul(hash(seed.add(73)).sub(0.5).mul(1.8))));
    const half = normalize(lightDirection.add(positionViewDirection));
    const lobe = pow(max(dot(transformNormalToView(facet), half), 0), 850);
    const center = vec2(hash(seed.add(11)), hash(seed.add(37))).mul(0.5).add(0.25);
    const spot = float(1).sub(smoothstep(0.08, 0.34, length(fract(p).sub(center))));
    const pixelSize = max(length(dFdx(p)), length(dFdy(p)));
    const resolved = float(1).sub(smoothstep(0.65, 1.7, pixelSize));
    const fade = float(1).sub(smoothstep(8, 24, this.dist));
    const facing = max(dot(normalView, lightDirection), 0);
    const glint = lobe.mul(spot).mul(resolved).mul(fade).mul(facing).mul(this.snowCoverage);
    reflectedLight.directSpecular.addAssign(lightColor.mul(glint).mul(3.0));

    // Bounded shallow-scattering approximation at grazing angles. This also receives shadows;
    // the existing blue skylight supplies the much larger diffuse fill in sheltered snow.
    const grazing = pow(float(1).sub(max(dot(normalView, positionViewDirection), 0)), 3);
    const scatter = grazing.mul(facing).mul(this.snowCoverage).mul(0.065);
    reflectedLight.directDiffuse.addAssign(lightColor.mul(vec3(0.74, 0.86, 1.0)).mul(scatter));
  }
}

export function useSnowLighting(material, snowCoverage, dist) {
  material.setupLightingModel = () => new SnowLightingModel(snowCoverage, dist);
}
