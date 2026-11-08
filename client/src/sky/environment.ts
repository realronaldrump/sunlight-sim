// @ts-nocheck -- TSL node graphs: @types/three node typings are too strict to be useful here.
// Sky, sun, ambient light, aerial-perspective fog and cascaded shadows.
import * as THREE from 'three/webgpu';
import { SkyMesh } from 'three/addons/objects/SkyMesh.js';
import { CSMShadowNode } from 'three/addons/csm/CSMShadowNode.js';
import {
  Fn, uniform, vec3, float, exp, abs, select, positionWorld, cameraPosition, normalize, dot, max, pow, mix,
  fog, length, clamp,
} from 'three/tsl';
import { sunPosition, januaryMST } from './sun';
import { LAT, LON } from '../../../shared/world';

export interface EnvOptions { shadows: boolean; shadowMapSize: number; cascades: number; shadowFar: number }

export class Environment {
  readonly sky = new SkyMesh();
  readonly sun = new THREE.DirectionalLight(0xfff4e6, 3.2);
  readonly hemi = new THREE.HemisphereLight(0xbcd4ff, 0xe8ecf2, 0.55);
  readonly sunDir = uniform(new THREE.Vector3(0, 1, 0));
  readonly hazeColor = uniform(new THREE.Color(0.66, 0.75, 0.88));
  readonly hazeDensity = uniform(1.6e-5);
  hour = 11;
  snowing = false;
  csm: CSMShadowNode | null = null;
  private pmrem: THREE.PMREMGenerator | null = null;
  private envRT: THREE.RenderTarget | null = null;
  private skyScene = new THREE.Scene();
  private envDirty = true;
  sunInfo = sunPosition(januaryMST(11), LAT, LON);

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

  /** Weather: clear (default) or light snowfall (lower visibility, overcast light). */
  setSnowing(on: boolean) {
    this.snowing = on;
    this.hazeDensity.value = on ? 3.2e-4 : 1.6e-5;
    this.hazeColor.value.setRGB(on ? 0.78 : 0.66, on ? 0.8 : 0.75, on ? 0.84 : 0.88);
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
    this.sun.color.setRGB(1.0, 0.78 + 0.18 * t, 0.6 + 0.32 * t);
    this.sun.intensity = 3.4 * THREE.MathUtils.clamp((el + 1) / 12, 0, 1) * (this.snowing ? 0.25 : 1);
    this.hemi.intensity = (0.25 + 0.35 * t) * (this.snowing ? 1.8 : 1);
    this.envDirty = true;
  }

  /** Keep the shadow light centered on the viewer. */
  update(target: THREE.Vector3) {
    const d = this.sunDir.value;
    this.sun.position.set(target.x + d.x * 2000, target.y + d.y * 2000, target.z + d.z * 2000);
    this.sun.target.position.copy(target);
    this.sun.target.updateMatrixWorld();
    if (this.envDirty) this.updateEnvMap();
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
      const rt = this.pmrem.fromScene(this.skyScene, 0, 0.1, 2000);
      this.envRT?.dispose();
      this.envRT = rt;
      this.scene.environment = rt.texture;
      this.scene.environmentIntensity = 0.65;
    } catch (e) {
      console.warn('env map failed', e);
    }
  }
}
