// @ts-nocheck -- TSL node graphs: @types/three node typings are too strict to be useful here.
// Sky, sun, ambient light, aerial-perspective fog and cascaded shadows.
import * as THREE from 'three/webgpu';
import { SkyMesh } from 'three/addons/objects/SkyMesh.js';
import { CSMShadowNode } from 'three/addons/csm/CSMShadowNode.js';
import {
  Fn, uniform, vec3, float, exp, abs, select, positionWorld, cameraPosition, normalize, dot, max, pow, mix,
  fog, length, clamp, smoothstep, floor, hash,
} from 'three/tsl';
import { sunPosition, januaryMST } from './sun';
import { LAT, LON } from '../../../shared/world';
import { Clouds } from './clouds';
import { MountainShadow } from './mountainShadow';
import { sunTransmission, type SkyMode } from './cloudWeather';
import { eveningLights } from './eveningLights';

// Twilight sky keyframes by sun elevation (degrees): linear radiance at the zenith, at the horizon under
// the sun and at the horizon opposite. Tuned to meet the daytime sky model at 5 to 7 degrees and the
// night sky at -12, with a clean mountain-air sunset between.
const SKY_EL = [8, 4, 0, -3, -6, -9, -12];
const SKY_ZENITH = [[0.06, 0.2, 0.6], [0.035, 0.135, 0.46], [0.03, 0.1, 0.36], [0.024, 0.07, 0.25], [0.014, 0.038, 0.14], [0.009, 0.02, 0.07], [0.008, 0.014, 0.04]];
const SKY_SUN = [[0.78, 0.78, 0.62], [0.8, 0.68, 0.36], [0.92, 0.52, 0.2], [0.78, 0.34, 0.14], [0.4, 0.17, 0.1], [0.13, 0.075, 0.085], [0.05, 0.075, 0.15]];
const SKY_ANTI = [[0.4, 0.52, 0.72], [0.42, 0.5, 0.64], [0.48, 0.4, 0.5], [0.26, 0.24, 0.38], [0.1, 0.105, 0.2], [0.06, 0.075, 0.14], [0.05, 0.075, 0.15]];

export interface EnvOptions { shadows: boolean; shadowMapSize: number; cascades: number; shadowFar: number }

export class Environment {
  readonly sky = new SkyMesh();
  readonly sun = new THREE.DirectionalLight(0xfff4e6, 3.2);
  // Sky fill is kept well below the sun: on a clear high-altitude day diffuse sky light on flat snow
  // is roughly a quarter of the direct beam, so tree and terrain shadows read about 3 to 4x darker.
  readonly hemi = new THREE.HemisphereLight(0xb4d0ff, 0xeef1f4, 0.18);
  readonly sunDir = uniform(new THREE.Vector3(0, 1, 0));
  readonly hazeColor = uniform(new THREE.Color(0.66, 0.75, 0.88));
  readonly hazeDensity = uniform(1.1e-5);
  /** 0 by day, 1 at full night (sun 12 degrees below the horizon). */
  readonly night = uniform(0);
  /** Moonlight direction: a first-quarter moon high in the southeast evening sky (an estimate, not an ephemeris). */
  readonly moonDir = new THREE.Vector3(0.55, 0.62, 0.56).normalize();
  /** Direction of the light that casts shadows: the sun, or the moon after dusk. */
  readonly lightDir = new THREE.Vector3(0, 1, 0);
  private lightDirU = uniform(this.lightDir);
  /** Colour times intensity of the shadow-casting light, before clouds and mountains get in its way. */
  private radiance = uniform(new THREE.Color(1, 1, 1));
  /** Drifting cumulus and cirrus, the sun's glare, and cloud shadows on the ground. */
  readonly clouds: Clouds;
  /** The shadows the mountains themselves cast at low sun. */
  readonly mountains = new MountainShadow();
  // twilight and night sky colours at the zenith, on the horizon under the sun and on the horizon opposite
  private skyZenith = uniform(new THREE.Color(0.06, 0.2, 0.6));
  private skySun = uniform(new THREE.Color(0.8, 0.7, 0.4));
  private skyAnti = uniform(new THREE.Color(0.4, 0.5, 0.62));
  private skyBelt = uniform(0);
  /** How much of the sky is the twilight and night gradient rather than the daytime scattering model. */
  private skyBlend = uniform(0);
  private nightDome: THREE.Mesh;
  private overcastDome: THREE.Mesh;
  private overcastAmount = uniform(0);
  private dayHaze = new THREE.Color(0.66, 0.75, 0.88);
  hour = 11;
  snowing = false;
  /** 0 clear .. 1 a snow squall overhead: haze, flat light, cloud. */
  overcast = 0;
  private envOvercast = 0;
  csm: CSMShadowNode | null = null;
  private pmrem: THREE.PMREMGenerator | null = null;
  private envRT: THREE.RenderTarget | null = null;
  private skyScene = new THREE.Scene();
  private envDirty = true;
  sunInfo = sunPosition(januaryMST(11), LAT, LON);
  /** Image-based sky fill, see `hemi`. */
  envIntensity = 0.22;
  /** Base camera exposure for Khronos PBR Neutral tone mapping, before eye adaptation. */
  baseExposure = 0.74;
  /** Current adapted exposure multiplier (eye/camera adaptation to the lit terrain in view). */
  adaptation = 1;
  private adaptTarget = 1;
  private adaptClock = 0;
  private lastAdaptPos = new THREE.Vector3(1e9, 0, 0);

  constructor(private scene: THREE.Scene, private renderer: THREE.WebGPURenderer, private camera: THREE.PerspectiveCamera, opts: EnvOptions) {
    this.sky.scale.setScalar(450000);
    this.sky.turbidity.value = 1.6;
    this.sky.rayleigh.value = 1.35;
    this.sky.mieCoefficient.value = 0.0018;
    this.sky.mieDirectionalG.value = 0.78;
    // clouds and the sun's disc are drawn by the cloud layer, which also shades the ground to match
    (this.sky as unknown as { cloudCoverage?: { value: number } }).cloudCoverage && ((this.sky as unknown as { cloudCoverage: { value: number } }).cloudCoverage.value = 0);
    this.sky.showSunDisc.value = 0;
    (this.sky.material as THREE.Material).fog = false;
    this.sky.frustumCulled = false;
    scene.add(this.sky);
    // Twilight and night sky over the daytime scattering sky: deep blue gradient, the afterglow on the
    // horizon below the set sun, stars and the moon. Kept inside the camera's far plane.
    this.nightDome = this.makeNightDome(250000);
    scene.add(this.nightDome);
    // a grey ceiling of snow cloud as a squall moves overhead
    this.overcastDome = this.makeOvercastDome(249000);
    scene.add(this.overcastDome);
    this.clouds = new Clouds({ sunDir: this.sunDir, lightDir: this.lightDirU, hazeColor: this.hazeColor, night: this.night });
    scene.add(this.clouds.group);
    // every lit surface gets its sunlight through the clouds and past the mountains
    this.sun.colorNode = vec3(this.radiance).mul(this.clouds.shadow).mul(this.mountains.visibility);
    scene.add(this.hemi);
    scene.add(this.sun);
    scene.add(this.sun.target);

    this.sun.castShadow = opts.shadows;
    if (opts.shadows) {
      this.sun.shadow.mapSize.set(opts.shadowMapSize, opts.shadowMapSize);
      this.sun.shadow.camera.near = 1;
      this.sun.shadow.camera.far = 4000;
      this.sun.shadow.bias = -0.0004;
      this.sun.shadow.normalBias = 0.6;
      this.csm = new CSMShadowNode(this.sun, { cascades: opts.cascades, maxFar: opts.shadowFar, mode: 'practical', lightMargin: 400 });
      this.csm.fade = true;
      this.sun.shadow.shadowNode = this.csm;
    }

    // Aerial perspective: exponential atmosphere integrated along the view ray.
    const H = 7000.0;
    const factor = Fn(() => {
      const d = length(positionWorld.sub(cameraPosition));
      const hc = cameraPosition.y, dh = positionWorld.y.sub(hc);
      const k = exp(hc.sub(2500.0).div(H).negate());
      const ratio = select(abs(dh).greaterThan(1.0), float(1.0).sub(exp(dh.div(H).negate())).mul(H).div(dh), float(1.0));
      const optical = this.hazeDensity.mul(d).mul(k).mul(ratio);
      return clamp(float(1.0).sub(exp(optical.negate())), 0.0, 0.92);
    })();
    const color = Fn(() => {
      const v = normalize(positionWorld.sub(cameraPosition));
      const s = pow(max(dot(v, this.sunDir), 0.0), 6.0);
      return mix(vec3(this.hazeColor), vec3(1.0, 0.93, 0.82), s.mul(0.45));
    })();
    scene.fogNode = fog(color, factor);
    this.setHour(11);
  }

  private makeNightDome(radius: number) {
    const mat = new THREE.MeshBasicNodeMaterial({ side: THREE.BackSide, transparent: true, depthWrite: false });
    mat.fog = false;
    const sunDir = this.sunDir, night = this.night, moon = uniform(this.moonDir);
    const v = normalize(positionWorld.sub(cameraPosition));
    const alt = max(v.y, 0);
    // Twilight: the scattering sky model goes dark the moment the sun sets, but a real sky stays bright
    // for half an hour. A gradient from the zenith to two horizons, one under the sun and one opposite.
    const sunFlat = normalize(vec3(sunDir.x, 0, sunDir.z));
    const toSun = dot(normalize(vec3(v.x, 0, v.z).add(vec3(1e-5, 0, 0))), sunFlat).mul(0.5).add(0.5);
    const side = pow(toSun, 2.5), anti = pow(toSun.oneMinus(), 2);
    const low = exp(alt.mul(-5.5));
    const glowBand = exp(alt.mul(-11)).mul(side);
    let col = mix(vec3(this.skyZenith), mix(vec3(this.skyAnti), vec3(this.skySun), side), low)
      .add(vec3(this.skySun).mul(glowBand).mul(0.55));
    // the Belt of Venus: a pink band over the blue-grey shadow of the earth, opposite the set sun
    const belt = anti.mul(exp(alt.sub(0.13).div(0.075).pow(2).negate())).mul(this.skyBelt);
    col = col.add(vec3(0.42, 0.2, 0.26).mul(belt)).mul(float(1).sub(anti.mul(float(1).sub(smoothstep(0.0, 0.09, alt))).mul(this.skyBelt).mul(0.4)));
    const cell = floor(v.mul(700));
    const star = smoothstep(0.9988, 0.9998, hash(dot(cell, vec3(1.0, 157.0, 113.0)))).mul(smoothstep(0.03, 0.25, v.y)).mul(smoothstep(0.55, 1.0, night));
    const moonDisc = smoothstep(0.99994, 0.99997, dot(v, moon)).mul(smoothstep(0.25, 0.7, night));
    const moonHalo = pow(max(dot(v, moon), 0), 220).mul(0.08).mul(smoothstep(0.25, 0.7, night));
    mat.colorNode = col.add(vec3(0.85, 0.9, 1.0).mul(star))
      .add(vec3(0.95, 0.93, 0.86).mul(moonDisc)).add(vec3(0.5, 0.58, 0.75).mul(moonHalo));
    mat.opacityNode = this.skyBlend;
    const dome = new THREE.Mesh(new THREE.SphereGeometry(radius, 64, 32), mat);
    dome.frustumCulled = false; dome.renderOrder = -1;
    dome.name = 'night-sky';
    return dome;
  }

  private makeOvercastDome(radius: number) {
    const mat = new THREE.MeshBasicNodeMaterial({ side: THREE.BackSide, transparent: true, depthWrite: false });
    mat.fog = false;
    const v = normalize(positionWorld.sub(cameraPosition));
    const lit = float(1).sub(this.night.mul(0.88));
    // brighter toward the horizon under a snow ceiling, a little brighter toward the hidden sun
    const sunGlow = pow(max(dot(v, this.sunDir), 0), 4).mul(0.12);
    const base = mix(vec3(0.8, 0.82, 0.86), vec3(0.62, 0.65, 0.71), smoothstep(0.0, 0.7, v.y));
    mat.colorNode = base.add(sunGlow).mul(lit);
    mat.opacityNode = this.overcastAmount.mul(smoothstep(-0.15, 0.05, v.y).mul(0.1).add(0.88)).clamp(0, 0.97);
    const dome = new THREE.Mesh(new THREE.SphereGeometry(radius, 48, 24), mat);
    dome.frustumCulled = false; dome.renderOrder = -0.96; dome.visible = false; dome.name = 'overcast-sky';
    return dome;
  }

  /** Weather: clear (default) or light snowfall (lower visibility, overcast light). */
  setSnowing(on: boolean) { this.setWeather(on ? 1 : 0); }

  /** Continuous weather: a squall drifting overhead raises this from 0 toward 1 and back. */
  setWeather(k: number) {
    k = THREE.MathUtils.clamp(k, 0, 1);
    if (Math.abs(k - this.overcast) < 0.01 && !(k === 0 && this.overcast > 0)) return;
    this.overcast = k;
    this.snowing = k > 0.15;
    this.overcastAmount.value = THREE.MathUtils.smoothstep(k, 0.05, 0.7);
    this.overcastDome.visible = k > 0.03;
    const lerp = THREE.MathUtils.lerp, kk = Math.pow(k, 1.3);
    this.hazeDensity.value = lerp(1.1e-5, 3.2e-4, kk);
    this.dayHaze.setRGB(lerp(0.66, 0.78, k), lerp(0.75, 0.8, k), lerp(0.88, 0.84, k));
    // re-light; the sky environment map is rebuilt only for a real change in the weather
    const regen = Math.abs(k - this.envOvercast) > 0.1 || (k === 0) !== (this.envOvercast === 0);
    this.setHour(this.hour, regen);
    if (regen) this.envOvercast = k;
  }

  setHour(hour: number, rebuildSky = true) {
    this.hour = hour;
    this.sunInfo = sunPosition(januaryMST(hour), LAT, LON);
    const d = this.sunInfo.dir;
    this.sunDir.value.set(d.x, d.y, d.z).normalize();
    this.sky.sunPosition.value.copy(this.sunDir.value);
    const el = this.sunInfo.elevation;
    const t = THREE.MathUtils.clamp((el - 2) / 25, 0, 1);
    const night = THREE.MathUtils.smoothstep(-el, -1, 12);
    this.night.value = night;
    // the twilight gradient takes over from the daytime sky as the sun nears the horizon
    const blend = 1 - THREE.MathUtils.smoothstep(el, 0.5, 7);
    this.skyBlend.value = blend;
    const key = (table: number[][]) => {
      let i = 0; while (i < SKY_EL.length - 2 && el < SKY_EL[i + 1]) i++;
      const k = THREE.MathUtils.clamp((SKY_EL[i] - el) / (SKY_EL[i] - SKY_EL[i + 1]), 0, 1), a = table[i], b = table[i + 1];
      return [0, 1, 2].map((c) => a[c] + (b[c] - a[c]) * k);
    };
    const dim = 1 - 0.6 * this.overcast;
    { const z = key(SKY_ZENITH), sn = key(SKY_SUN), an = key(SKY_ANTI);
      this.skyZenith.value.setRGB(z[0] * dim, z[1] * dim, z[2] * dim); this.skySun.value.setRGB(sn[0] * dim, sn[1] * dim, sn[2] * dim); this.skyAnti.value.setRGB(an[0] * dim, an[1] * dim, an[2] * dim); }
    this.skyBelt.value = THREE.MathUtils.smoothstep(el, -7, -1.5) * (1 - THREE.MathUtils.smoothstep(el, 1.5, 5)) * dim;
    // by day the dome would only cost a transparent full-sky pass
    this.nightDome.visible = blend > 0.002;
    // once the sun is a couple of degrees down the shadow-casting light becomes cool moonlight on the snow
    const moonlit = el < -2.4;
    this.lightDir.copy(moonlit ? this.moonDir : this.sunDir.value);
    if (moonlit) {
      this.sun.color.setRGB(0.62, 0.72, 1.0);
      this.sun.intensity = 0.42 * THREE.MathUtils.smoothstep(-el, 2.4, 9) * (1 - 0.7 * this.overcast);
    } else {
      // Sunlight through more and more air as it sinks: gold, then orange, then the last red on the peaks.
      // The mountain shadow map decides who still sees it once it is near or below the level horizon.
      const c = sunTransmission(el);
      this.sun.color.setRGB(c[0], 0.96 * c[1], 0.92 * c[2]);
      this.sun.intensity = 3.4 * THREE.MathUtils.smoothstep(el, -2.4, -0.8) * (1 - 0.75 * this.overcast);
    }
    this.radiance.value.copy(this.sun.color).multiplyScalar(this.sun.intensity);
    this.mountains.setSun(this.sunInfo.azimuth, el, moonlit ? 0 : 1);
    this.clouds.setLight(el, this.overcast);
    // windows light up as the sun goes (earlier under a snow sky)
    eveningLights.value = 1 - THREE.MathUtils.smoothstep(el - 3 * this.overcast, -3.5, 2.5);
    // twilight: the sky fill turns mauve under the afterglow before it goes to night blue
    const dusk = THREE.MathUtils.smoothstep(el, -7, -1) * (1 - THREE.MathUtils.smoothstep(el, 1, 7));
    this.twilight = dusk;
    // after the sun leaves a slope the whole bright sky still lights it
    this.ambientBoost = 1 + 2.4 * (1 - THREE.MathUtils.smoothstep(el, 0, 14)) * (1 - night);
    this.hemi.intensity = THREE.MathUtils.lerp((0.1 + 0.08 * t) * (1 + 2.2 * this.overcast), 0.07, night) * this.ambientBoost;
    this.scene.environmentIntensity = this.envIntensity * (1 + 1.2 * this.overcast) * this.ambientBoost;
    this.hemi.color.setRGB(THREE.MathUtils.lerp(0.706, 0.32, night) + 0.2 * dusk, THREE.MathUtils.lerp(0.816, 0.42, night) - 0.06 * dusk, THREE.MathUtils.lerp(1, 0.75, night) - 0.08 * dusk);
    this.hazeColor.value.copy(this.dayHaze).lerp(new THREE.Color(0.035, 0.05, 0.095), night);
    // the eye opens as the light goes: full sun, golden hour, shade after sunset, then night
    this.lowSun = 1 - THREE.MathUtils.smoothstep(el, 0, 16);
    if (rebuildSky) this.envDirty = true;
  }

  /** Keep the shadow light centered on the viewer. */
  update(target: THREE.Vector3) {
    const d = this.lightDir;
    this.sun.position.set(target.x + d.x * 2000, target.y + d.y * 2000, target.z + d.z * 2000);
    this.sun.target.position.copy(target);
    this.sun.target.updateMatrixWorld();
    if (this.envDirty) this.updateEnvMap();
  }

  /** 0 by day, 1 around sunset and sunrise (golden hour and the blue hour after it). */
  lowSun = 0;
  private ambientBoost = 1;
  /** 0..1 the mauve afterglow just after sunset and before sunrise. */
  twilight = 0;

  /** The eye opens up at dusk so moonlit snow reads as blue-grey rather than black. */
  get exposure() { return this.baseExposure * this.adaptation * (1 + 0.9 * this.lowSun + 1.3 * this.night.value); }

  /** Clouds on the shared clock and the mountain shadow map; once a frame. */
  updateSky(dt: number, now: number, mode: SkyMode, camera: THREE.Vector3) {
    this.clouds.update(now, mode, this.overcast, camera);
    this.mountains.update(dt);
  }

  /**
   * Gradual eye adaptation. Samples the terrain the camera is looking at and compares its direct plus
   * sky irradiance with flat open snow. North-facing slopes in low January sun are brightened, sunny
   * faces darkened, but only partially (square root response) so sun and shade still read differently.
   */
  adapt(dt: number, cam: THREE.Camera, normalAt: (x: number, z: number) => { x: number; y: number; z: number }, indoor = false) {
    this.adaptClock += dt;
    // a teleport or camera cut adapts immediately instead of fading in from the old view
    const cut = cam.position.distanceTo(this.lastAdaptPos) > 30;
    this.lastAdaptPos.copy(cam.position);
    if (this.adaptClock > 0.25 || cut) {
      this.adaptClock = 0;
      const dir = new THREE.Vector3(); cam.getWorldDirection(dir);
      const fx = dir.x, fz = dir.z, fl = Math.hypot(fx, fz) || 1;
      const ux = fx / fl, uz = fz / fl;
      const s = this.lightDir;
      const fill = 0.19;
      let key = 0, weight = 0;
      for (const d of [3, 8, 18, 40, 90, 180]) {
        for (const lat of [-0.6, 0, 0.6]) {
          const x = cam.position.x + ux * d - uz * lat * d, z = cam.position.z + uz * d + ux * lat * d;
          const n = normalAt(x, z);
          const w = 1 / Math.sqrt(d);
          key += w * (Math.max(0, n.x * s.x + n.y * s.y + n.z * s.z) + fill);
          weight += w;
        }
      }
      key /= weight;
      const flat = Math.max(0.05, Math.max(0, s.y)) + fill;
      this.adaptTarget = THREE.MathUtils.lerp(THREE.MathUtils.clamp(Math.sqrt(flat / Math.max(key, 0.05)), 0.8, 1.45), 1, this.overcast);
      // indoors the eye opens up to lamp light, so windows read bright as they do in a real lodge
      if (indoor) this.adaptTarget = 2.1;
    }
    // eyes adapt over a second or two
    if (cut) this.adaptation = this.adaptTarget;
    else this.adaptation += (this.adaptTarget - this.adaptation) * (1 - Math.exp(-dt / 1.4));
  }

  private updateEnvMap() {
    this.envDirty = false;
    try {
      if (!this.pmrem) this.pmrem = new THREE.PMREMGenerator(this.renderer);
      const sky2 = new SkyMesh();
      sky2.scale.setScalar(1000);
      sky2.turbidity.value = this.sky.turbidity.value;
      sky2.rayleigh.value = this.sky.rayleigh.value;
      sky2.mieCoefficient.value = this.sky.mieCoefficient.value;
      sky2.mieDirectionalG.value = this.sky.mieDirectionalG.value;
      sky2.sunPosition.value.copy(this.sunDir.value);
      sky2.showSunDisc.value = 0;
      this.skyScene.clear();
      this.skyScene.add(sky2);
      if (this.skyBlend.value > 0.01) { const dome = this.nightDome.clone(); dome.scale.setScalar(900 / 250000); this.skyScene.add(dome); }
      const rt = this.pmrem.fromScene(this.skyScene, 0, 0.1, 2000);
      this.envRT?.dispose();
      this.envRT = rt;
      this.scene.environment = rt.texture;
      this.scene.environmentIntensity = this.envIntensity * (1 + 1.2 * this.overcast) * this.ambientBoost;
    } catch (e) {
      console.warn('env map failed', e);
    }
  }
}
