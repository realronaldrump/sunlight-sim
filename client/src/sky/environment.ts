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
  private nightDome: THREE.Mesh;
  private dayHaze = new THREE.Color(0.66, 0.75, 0.88);
  hour = 11;
  snowing = false;
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
    (this.sky as unknown as { cloudCoverage?: { value: number } }).cloudCoverage && ((this.sky as unknown as { cloudCoverage: { value: number } }).cloudCoverage.value = 0.15);
    (this.sky.material as THREE.Material).fog = false;
    this.sky.frustumCulled = false;
    scene.add(this.sky);
    // Twilight and night sky over the daytime scattering sky: deep blue gradient, the afterglow on the
    // horizon below the set sun, stars and the moon. Kept inside the camera's far plane.
    this.nightDome = this.makeNightDome(250000);
    scene.add(this.nightDome);
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
    const alt = v.y;
    const twilight = smoothstep(0.0, 0.55, night).mul(float(1).sub(smoothstep(0.55, 1.0, night)));
    const base = mix(vec3(0.05, 0.075, 0.15), vec3(0.008, 0.014, 0.04), smoothstep(-0.02, 0.6, alt));
    const sunFlat = normalize(vec3(sunDir.x, 0, sunDir.z));
    const glow = pow(max(dot(v, sunFlat), 0), 3).mul(float(1).sub(smoothstep(0.0, 0.32, alt))).mul(twilight);
    const cell = floor(v.mul(700));
    const star = smoothstep(0.9988, 0.9998, hash(dot(cell, vec3(1.0, 157.0, 113.0)))).mul(smoothstep(0.03, 0.25, alt)).mul(smoothstep(0.55, 1.0, night));
    const moonDisc = smoothstep(0.99994, 0.99997, dot(v, moon));
    const moonHalo = pow(max(dot(v, moon), 0), 220).mul(0.08);
    mat.colorNode = base.add(vec3(0.62, 0.34, 0.24).mul(glow).mul(0.55)).add(vec3(0.85, 0.9, 1.0).mul(star))
      .add(vec3(0.95, 0.93, 0.86).mul(moonDisc)).add(vec3(0.5, 0.58, 0.75).mul(moonHalo));
    mat.opacityNode = clamp(night.mul(1.15), 0, 1).mul(this.snowing ? 0.85 : 1);
    const dome = new THREE.Mesh(new THREE.SphereGeometry(radius, 64, 32), mat);
    dome.frustumCulled = false; dome.renderOrder = -1;
    dome.name = 'night-sky';
    return dome;
  }

  /** Weather: clear (default) or light snowfall (lower visibility, overcast light). */
  setSnowing(on: boolean) {
    this.snowing = on;
    this.hazeDensity.value = on ? 3.2e-4 : 1.1e-5;
    this.dayHaze.setRGB(on ? 0.78 : 0.66, on ? 0.8 : 0.75, on ? 0.84 : 0.88);
    const sky = this.sky as unknown as { cloudCoverage?: { value: number }; cloudDensity?: { value: number } };
    if (sky.cloudCoverage) sky.cloudCoverage.value = on ? 0.95 : 0.15;
    if (sky.cloudDensity) sky.cloudDensity.value = on ? 0.9 : 0.4;
    this.setHour(this.hour);
  }

  setHour(hour: number) {
    this.hour = hour;
    this.sunInfo = sunPosition(januaryMST(hour), LAT, LON);
    const d = this.sunInfo.dir;
    this.sunDir.value.set(d.x, d.y, d.z).normalize();
    this.sky.sunPosition.value.copy(this.sunDir.value);
    const el = this.sunInfo.elevation;
    // warmer, dimmer light when the sun is low
    const t = THREE.MathUtils.clamp((el - 2) / 25, 0, 1);
    const night = THREE.MathUtils.smoothstep(-el, -1, 12);
    this.night.value = night;
    // by day the night dome would only cost a transparent full-sky pass
    this.nightDome.visible = night > 0.002;
    // after dusk the shadow-casting light becomes cool moonlight on the snow
    const moonlit = el < -1;
    this.lightDir.copy(moonlit ? this.moonDir : this.sunDir.value);
    if (moonlit) {
      this.sun.color.setRGB(0.62, 0.72, 1.0);
      this.sun.intensity = 0.42 * night * (this.snowing ? 0.3 : 1);
    } else {
      this.sun.color.setRGB(1.0, 0.78 + 0.18 * t, 0.6 + 0.32 * t);
      this.sun.intensity = 3.4 * THREE.MathUtils.clamp((el + 1) / 12, 0, 1) * (this.snowing ? 0.25 : 1);
    }
    this.hemi.intensity = THREE.MathUtils.lerp((0.1 + 0.08 * t) * (this.snowing ? 3.2 : 1), 0.07, night);
    this.hemi.color.setRGB(THREE.MathUtils.lerp(0.706, 0.32, night), THREE.MathUtils.lerp(0.816, 0.42, night), THREE.MathUtils.lerp(1, 0.75, night));
    this.hazeColor.value.copy(this.dayHaze).lerp(new THREE.Color(0.035, 0.05, 0.095), night);
    this.envDirty = true;
  }

  /** Keep the shadow light centered on the viewer. */
  update(target: THREE.Vector3) {
    const d = this.lightDir;
    this.sun.position.set(target.x + d.x * 2000, target.y + d.y * 2000, target.z + d.z * 2000);
    this.sun.target.position.copy(target);
    this.sun.target.updateMatrixWorld();
    if (this.envDirty) this.updateEnvMap();
  }

  /** The eye opens up at dusk so moonlit snow reads as blue-grey rather than black. */
  get exposure() { return this.baseExposure * this.adaptation * (1 + 2.2 * this.night.value); }

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
      this.adaptTarget = this.snowing ? 1 : THREE.MathUtils.clamp(Math.sqrt(flat / Math.max(key, 0.05)), 0.8, 1.45);
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
      if (this.night.value > 0.01) { const dome = this.nightDome.clone(); dome.scale.setScalar(900 / 250000); this.skyScene.add(dome); }
      const rt = this.pmrem.fromScene(this.skyScene, 0, 0.1, 2000);
      this.envRT?.dispose();
      this.envRT = rt;
      this.scene.environment = rt.texture;
      this.scene.environmentIntensity = this.envIntensity * (this.snowing ? 2.2 : 1);
    } catch (e) {
      console.warn('env map failed', e);
    }
  }
}
