// @ts-nocheck -- TSL node graphs: @types/three node typings are too strict to be useful here.
// The sky above the mountain: drifting fair-weather cumulus and high cirrus, the sun's disc and glare,
// and the shadows those clouds drop on the snow. One noise field drives both what you see overhead and
// what the sunlight does on the ground, so a shadow sliding down Ute belongs to a cloud you can look
// up and find. Everything follows the shared resort clock.
import * as THREE from 'three/webgpu';
import {
  Fn, uniform, vec2, vec3, float, texture, positionWorld, cameraPosition, normalize, dot, max, exp, sqrt,
  smoothstep, clamp, mix, pow,
} from 'three/tsl';
import { EARTH_R_EFF } from '../../../shared/world';
import { makeCloudNoise } from './skyNoise';
import {
  cloudStateAt, sunTransmission, CUMULUS_BASE, CIRRUS_ALT, CUMULUS_TILE, CIRRUS_TILE, REGION_SCALE, DETAIL_SCALE, HIGH2_SCALE,
  type SkyMode,
} from './cloudWeather';

export interface SkyUniforms {
  sunDir: { value: THREE.Vector3 };
  /** Direction of the shadow-casting light (sun, or moon after dusk). */
  lightDir: { value: THREE.Vector3 };
  hazeColor: { value: THREE.Color };
  night: { value: number };
}

const lerp = THREE.MathUtils.lerp, sstep = THREE.MathUtils.smoothstep;

export class Clouds {
  readonly group = new THREE.Group();
  readonly dome: THREE.Mesh;
  readonly glare: THREE.Mesh;
  /** Sunlight let through by the cumulus above a lit surface (1 in the open, lower in a cloud's shadow). */
  readonly shadow;
  readonly cover = uniform(0.15);
  readonly cirrus = uniform(0.3);
  private offShape = uniform(new THREE.Vector2());
  private offRegion = uniform(new THREE.Vector2());
  private offDetail = uniform(new THREE.Vector2());
  private offHigh = uniform(new THREE.Vector2());
  private offHigh2 = uniform(new THREE.Vector2());
  private sunFlat = uniform(new THREE.Vector2(0, 1));
  private litColor = uniform(new THREE.Color(1, 1, 1));
  private shadeColor = uniform(new THREE.Color(0.56, 0.62, 0.72));
  private highColor = uniform(new THREE.Color(1, 1, 1));
  private underLit = uniform(0);
  private silver = uniform(1);
  private glareColor = uniform(new THREE.Color(1, 1, 1));
  private shadowStrength = uniform(0.8);
  private fade = uniform(1);
  private tex: THREE.DataTexture;
  /** Test hook and status board: the cloud state last applied. */
  state = cloudStateAt(0, 'clear');

  constructor(private u: SkyUniforms) {
    const N = 512;
    const tex = this.tex = new THREE.DataTexture(makeCloudNoise(N), N, N, THREE.RGBAFormat);
    tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
    tex.magFilter = THREE.LinearFilter; tex.minFilter = THREE.LinearMipmapLinearFilter; tex.generateMipmaps = true;
    tex.anisotropy = 8; tex.colorSpace = THREE.NoColorSpace; tex.needsUpdate = true;
    tex.name = 'cloud noise';

    const sample = (uv, lod?) => (lod === undefined ? texture(tex, uv) : texture(tex, uv).level(lod));
    // cumulus thickness 0..1 at a point of the cloud deck (metres east, south)
    const threshold = (P, lod?) => {
      const region = sample(P.div(CUMULUS_TILE).mul(REGION_SCALE).add(vec2(0.31, 0.67)).sub(this.offRegion), lod).a;
      return float(1).sub(clamp(this.cover.add(region.sub(0.5).mul(0.55).mul(this.cover.mul(2.2).min(1))), 0, 1));
    };
    const billows = (P, lod?) => sample(P.div(CUMULUS_TILE).mul(DETAIL_SCALE).add(vec2(0.13, 0.57)).sub(this.offDetail), lod).g;
    const heap = (P, thr, lod?, detail?) => {
      const uv = P.div(CUMULUS_TILE);
      const shape = sample(uv.sub(this.offShape), lod).r;
      let d = shape.mul(0.76).add((detail ?? billows(P, lod === undefined ? undefined : lod + 1)).mul(0.24));
      // crisp cauliflower edges only where they are looked at, not in the soft shadows on the ground
      if (lod === undefined) d = d.add(sample(uv.mul(DETAIL_SCALE * 3.3).add(vec2(0.71, 0.29)).sub(this.offDetail.mul(3.3))).g.sub(0.5).mul(0.07));
      return smoothstep(thr.sub(0.015), thr.add(0.16), d);
    };
    // distance along a view ray to a shell `H` metres above sea level, on the same curved earth as the terrain
    const v = normalize(positionWorld.sub(cameraPosition));
    const shell = (H: number) => {
      const b = float(EARTH_R_EFF).add(cameraPosition.y).mul(max(v.y, -0.02));
      const c = float(H).sub(cameraPosition.y).max(50).mul(float(2 * EARTH_R_EFF + H).add(cameraPosition.y));
      return c.div(b.add(sqrt(b.mul(b).add(c))));
    };
    const sunward = max(dot(v, u.sunDir), 0);

    // ---- cumulus and cirrus dome
    const t1 = shell(CUMULUS_BASE);
    const P1 = cameraPosition.xz.add(v.xz.mul(t1));
    const thr = threshold(P1);
    const relief = billows(P1);
    const dens = heap(P1, thr, undefined, relief);
    const densSun = heap(P1.add(this.sunFlat.mul(380)), thr);
    // thin edges glow, the side toward the sun is bright, the heart of the heap is grey underneath,
    // and the billows give the underside its lumps
    const edge = exp(dens.mul(-2.4));
    const facing = dens.sub(densSun).mul(1.7);
    const lumps = relief.sub(0.5).mul(dens);
    const dayLit = clamp(edge.mul(0.8).add(facing).add(lumps.mul(0.34)).add(0.12), 0, 1);
    // at sunset the sun shines up onto the cloud bases
    const lowLit = clamp(edge.mul(0.25).add(facing.mul(0.9)).add(lumps.mul(0.7)).add(0.52), 0, 1);
    const lit = mix(dayLit, lowLit, this.underLit);
    const cum = mix(vec3(this.shadeColor), vec3(this.litColor), lit)
      .add(vec3(this.litColor).mul(pow(sunward, 20).mul(edge).mul(this.silver)));
    const far1 = float(1).sub(exp(t1.div(-70000)));
    const horizon = smoothstep(-0.012, 0.03, v.y);
    const cumCol = mix(cum, vec3(u.hazeColor).mul(mix(1.0, 1.12, pow(sunward, 6))), far1.mul(0.85));
    const aCum = pow(dens, 0.75).mul(0.97).mul(horizon).mul(exp(t1.div(-80000)));

    const t2 = shell(CIRRUS_ALT);
    const P2 = cameraPosition.xz.add(v.xz.mul(t2));
    // fibres stretched along the upper wind (west to east, tilted a little)
    const q = vec2(P2.x.mul(0.94).sub(P2.y.mul(0.34)), P2.x.mul(0.34).add(P2.y.mul(0.94))).div(CIRRUS_TILE);
    const s1 = sample(vec2(q.x.mul(0.34), q.y.mul(1.25)).sub(this.offHigh)).b;
    const s2 = sample(vec2(q.x.mul(0.34), q.y.mul(1.25)).mul(HIGH2_SCALE).add(vec2(0.41, 0.17)).sub(this.offHigh2)).b;
    const patch = sample(q.mul(0.55).add(vec2(0.7, 0.2)).sub(this.offHigh.mul(0.55))).a;
    const cthr = float(1).sub(this.cirrus.mul(patch.mul(1.3).add(0.15)).clamp(0, 1));
    const cir = smoothstep(cthr.sub(0.05), cthr.add(0.4), s1.mul(0.68).add(s2.mul(0.32)));
    const far2 = float(1).sub(exp(t2.div(-140000)));
    const cirCol = mix(vec3(this.highColor).mul(float(0.9).add(pow(sunward, 10).mul(0.5).mul(this.silver))), vec3(u.hazeColor), far2.mul(0.8));
    const aCir = cir.mul(0.6).mul(smoothstep(0.0, 0.07, v.y)).mul(exp(t2.div(-260000)));

    const alpha = aCum.add(aCir.mul(aCum.oneMinus()));
    const domeMat = new THREE.MeshBasicNodeMaterial({ side: THREE.BackSide, transparent: true, depthWrite: false });
    domeMat.fog = false;
    domeMat.colorNode = cumCol.mul(aCum).add(cirCol.mul(aCir).mul(aCum.oneMinus())).div(max(alpha, 1e-4));
    domeMat.opacityNode = alpha.mul(this.fade);
    this.dome = new THREE.Mesh(new THREE.SphereGeometry(240000, 48, 24), domeMat);
    this.dome.frustumCulled = false; this.dome.renderOrder = -0.98; this.dome.name = 'clouds';

    // ---- the sun: a disc too bright to look at, a tight bloom and a wide soft halo, dimmed by cloud
    const d = v.sub(u.sunDir), a2 = dot(d, d); // squared angle from the sun's centre (radians)
    const disc = float(1).sub(smoothstep(1.9e-5, 2.9e-5, a2));
    const bloom = exp(a2.div(-4.5e-4)).mul(10).add(exp(a2.div(-6e-3)).mul(2.0)).add(exp(a2.div(-0.07)).mul(0.42)).add(exp(a2.div(-0.5)).mul(0.1));
    const through = float(1).sub(aCum.mul(0.94)).mul(float(1).sub(aCir.mul(0.35)));
    const glareMat = new THREE.MeshBasicNodeMaterial({ transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide });
    glareMat.fog = false;
    // the halo dies away before the edge of its quad
    const window = float(1).sub(smoothstep(0.2, 0.4, a2));
    glareMat.colorNode = vec3(this.glareColor).mul(disc.mul(26).add(bloom)).mul(through).mul(window).mul(smoothstep(-0.03, 0.01, v.y));
    this.glare = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), glareMat);
    this.glare.frustumCulled = false; this.glare.renderOrder = -0.94; this.glare.name = 'sun glare';
    this.group.add(this.dome, this.glare);
    this.group.name = 'sky clouds';

    // ---- cloud shadows: the same field, looked up where the light ray to this surface crosses the deck
    this.shadow = Fn(() => {
      const L = u.lightDir;
      const k = float(CUMULUS_BASE).sub(positionWorld.y).div(max(L.y, 0.1));
      const P = positionWorld.xz.add(L.xz.mul(k));
      return float(1).sub(heap(P, threshold(P, 0), 1).mul(this.shadowStrength));
    })();
  }

  /** Drift and amount for shared time `now`. `overcast` 0..1 is the snow cloud overhead. */
  update(now: number, mode: SkyMode, overcast: number, camera: THREE.Vector3) {
    const s = this.state = cloudStateAt(now, mode);
    this.cover.value = lerp(s.cover, 1, sstep(overcast, 0.1, 0.8));
    this.cirrus.value = s.cirrus;
    this.offShape.value.set(...s.shape); this.offRegion.value.set(...s.region); this.offDetail.value.set(...s.detail);
    this.offHigh.value.set(...s.high); this.offHigh2.value.set(...s.high2);
    // under a snow ceiling the grey dome takes over
    this.fade.value = 1 - 0.9 * sstep(overcast, 0.25, 0.8);
    this.dome.position.copy(camera);
    const sun = this.u.sunDir.value, R = 150000;
    this.glare.position.set(camera.x + sun.x * R, camera.y + sun.y * R, camera.z + sun.z * R);
    this.glare.scale.setScalar(R * 1.7);
    this.glare.lookAt(camera);
  }

  /** Colours for a sun elevation (degrees). Called whenever the hour or the weather changes. */
  setLight(elevation: number, overcast: number) {
    const sun = this.u.sunDir.value, fl = Math.hypot(sun.x, sun.z) || 1;
    this.sunFlat.value.set(sun.x / fl, sun.z / fl);
    const night = this.u.night.value;
    // the cloud deck is well above the ground, so it sees the sun a little longer and a little higher
    const tint = (el: number, floorG: number, floorB: number) => {
      const c = sunTransmission(el), m = Math.max(c[0], c[1], c[2], 1e-6);
      return [Math.pow(c[0] / m, 0.8), Math.max(Math.pow(c[1] / m, 0.8), floorG), Math.max(Math.pow(c[2] / m, 0.8), floorB)];
    };
    // after dusk only faint moonlight picks out the edges
    const moon = night * 0.55;
    const low = tint(elevation + 1.2, 0.34, 0.2), lowB = 1.05 * sstep(elevation, -6.5, 5);
    this.litColor.value.setRGB(low[0] * lowB * 1.04 + 0.1 * moon, low[1] * lowB * 1.02 + 0.115 * moon, low[2] * lowB + 0.15 * moon);
    const high = tint(elevation + 3.5, 0.52, 0.46), highB = 1.05 * sstep(elevation, -10, 2);
    this.highColor.value.setRGB(high[0] * highB + 0.07 * moon, high[1] * highB + 0.08 * moon, high[2] * highB + 0.11 * moon);
    // shaded cloud: blue-grey by day, mauve at dusk, nearly black against the stars
    const day = sstep(elevation, -7, 9), dusk = sstep(elevation, -7, 0) * (1 - sstep(elevation, 2, 10));
    const k = Math.pow(day, 1.4);
    this.shadeColor.value.setRGB(
      lerp(0.03, 0.56, k) + 0.1 * dusk, lerp(0.04, 0.62, k) - 0.02 * dusk, lerp(0.07, 0.72, k) + 0.04 * dusk);
    this.underLit.value = (1 - sstep(elevation, 1, 9)) * sstep(elevation, -5.5, -1);
    this.silver.value = sstep(elevation, -3, 4) * (1 - overcast);
    const c = sunTransmission(elevation), up = sstep(elevation, -1.6, 0.2) * (1 - sstep(overcast, 0.1, 0.7));
    this.glareColor.value.setRGB(c[0] * up, c[1] * 0.97 * up, c[2] * 0.92 * up);
    // long, raking shadows at sunrise and sunset would streak for miles; mountains shade everything by then
    this.shadowStrength.value = (night > 0.5 ? 0.5 : 0.86 * sstep(elevation, 1.5, 7)) * (1 - overcast);
  }
}
