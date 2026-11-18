// Cull against the part of a shadow map the player can actually see. Casters can be outside the
// camera frustum: sweep their bound away from the sun and keep it if it can reach the cascade.
import * as THREE from 'three/webgpu';
import { EARTH_R_EFF } from '../../../shared/world';
import { CulledInstances } from '../rendering/culledInstances';
import { TerrainChunkMesh } from '../terrain/terrainShadows';
import type { CSMShadowNode } from 'three/addons/csm/CSMShadowNode.js';

export class ShadowReceivers {
  private frustum = new THREE.Frustum();
  private rates = new Float64Array(6);
  private matrix = new THREE.Matrix4();

  set(camera: THREE.PerspectiveCamera, sun: THREE.Vector3, near: number, far: number, padding: number) {
    this.matrix.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse);
    this.frustum.setFromProjectionMatrix(this.matrix, camera.coordinateSystem, camera.reversedDepth);
    // Side planes come from the actual projection, including FOV and aspect changes.
    const planes = this.frustum.planes;
    const forward = planes[5].normal.setFromMatrixColumn(camera.matrixWorld, 2).negate().normalize();
    planes[5].constant = -forward.dot(camera.position) - near;
    planes[4].normal.copy(forward).negate();
    planes[4].constant = forward.dot(camera.position) + far;
    for (let i = 0; i < planes.length; i++) {
      planes[i].constant += padding;
      this.rates[i] = planes[i].normal.dot(sun);
    }
  }

  canReceiveFrom(sphere: THREE.Sphere) {
    let enter = 0, exit = Infinity;
    for (let i = 0; i < 6; i++) {
      const distance = this.frustum.planes[i].distanceToPoint(sphere.center) + sphere.radius;
      const rate = this.rates[i];
      if (rate > 1e-10) exit = Math.min(exit, distance / rate);
      else if (rate < -1e-10) enter = Math.max(enter, distance / rate);
      else if (distance < 0) return false;
      if (enter > exit) return false;
    }
    return true;
  }
}

export class MountainDrawingPipeline extends THREE.StandardDrawingPipeline {
  private receivers = new ShadowReceivers();
  private cascade = false;
  private sphere = new THREE.Sphere();

  constructor(private view: THREE.PerspectiveCamera, private csm: CSMShadowNode | null, private sun: THREE.Vector3) { super(); }

  override begin(...args: Parameters<THREE.StandardDrawingPipeline['begin']>) {
    super.begin(...args);
    const camera = args[0], csm = this.csm;
    if (!csm) return;
    const i = csm.lights.findIndex(l => l.shadow?.camera === camera);
    this.cascade = i !== -1;
    if (!this.cascade) return;
    const a = i ? csm.breaks[i - 1] : 0, b = csm.breaks[i];
    const range = Math.min(this.view.far, csm.maxFar) - this.view.near;
    // Three blends the neighboring maps across half of its 0.25 * split² fade margin.
    const start = this.view.near + range * (a - .125 * a * a);
    const end = this.view.near + range * (b + .125 * b * b);
    const shadow = csm.lights[i].shadow!;
    const texel = (shadow.camera.right - shadow.camera.left) / shadow.mapSize.x;
    this.receivers.set(this.view, this.sun, start, end, 2 + 4 * texel);
  }

  override project(...args: Parameters<THREE.StandardDrawingPipeline['project']>) {
    const [object, camera] = args;
    if (object instanceof CulledInstances && !(camera as THREE.ArrayCamera).isArrayCamera) {
      if (!object.visible || !object.layers.test(camera.layers) || (this.cascade && !object.castShadow)) return;
      const mesh = object.forView(camera, this._frustum, this.cascade ? this.receivers : undefined);
      if (!mesh) return;
      args[0] = mesh;
    }
    super.project(...args);
  }

  override pushRenderItem(...args: Parameters<THREE.StandardDrawingPipeline['pushRenderItem']>) {
    if (this.cascade && args[1] instanceof TerrainChunkMesh) {
      const caster = args[1].caster(this.sun, this.view.position);
      args[1] = caster;
      args[2] = caster.geometry;
    }
    super.pushRenderItem(...args);
  }

  override isCulled(object: THREE.Object3D, camera: THREE.Camera) {
    if (this.cascade && !object.castShadow) return true;
    if (super.isCulled(object, camera)) return true;
    if (!this.cascade || !object.frustumCulled) return false;
    const mesh = object as THREE.Mesh & { boundingSphere?: THREE.Sphere | null };
    const bound = mesh.boundingSphere ?? mesh.geometry?.boundingSphere;
    if (!bound) return false;
    this.sphere.copy(bound).applyMatrix4(object.matrixWorld);
    // The terrain shader can lower the far DEM below its geometry bound.
    if (object.userData.level !== undefined) this.sphere.radius += 0.5 * (this.sphere.center.distanceTo(this.view.position) + this.sphere.radius) ** 2 / EARTH_R_EFF;
    return !this.receivers.canReceiveFrom(this.sphere);
  }
}
