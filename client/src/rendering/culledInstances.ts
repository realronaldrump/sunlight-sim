// Material groups share a compact instance list for each view. The player camera and sun
// cascades use separate GPU buffers so a later pass cannot overwrite an earlier draw.
import * as THREE from 'three/webgpu';

type View = {
  mesh: THREE.InstancedMesh;
  ids: Int32Array;
  matrixVersion: number;
  colorVersion: number;
};
const scratch = new THREE.Sphere();

export class CulledInstances extends THREE.InstancedMesh {
  private views = new WeakMap<THREE.Camera, View>();
  private bounds = new Float32Array(0);
  private boundsVersion = -1;
  private boundsCount = -1;
  private world = new THREE.Matrix4();
  private transform = new THREE.Matrix4();
  private size = new THREE.Vector3();
  private center = new THREE.Vector3();
  private selected = new Int32Array(0);

  /** The geometry may sway in its shader after instancing, in world metres. */
  padding = 0;

  private updateBounds() {
    if (this.boundsVersion === this.instanceMatrix.version && this.boundsCount === this.count && this.world.equals(this.matrixWorld)) return;
    this.boundsVersion = this.instanceMatrix.version;
    this.boundsCount = this.count;
    this.world.copy(this.matrixWorld);
    if (this.selected.length < this.count) {
      this.selected = new Int32Array(this.count);
      this.bounds = new Float32Array(this.count * 4);
    }
    if (!this.geometry.boundingBox) this.geometry.computeBoundingBox();
    this.geometry.boundingBox!.getSize(this.size).multiplyScalar(.5);
    this.geometry.boundingBox!.getCenter(this.center);
    for (let i = 0; i < this.count; i++) {
      this.getMatrixAt(i, this.transform);
      this.transform.premultiply(this.world);
      const m = this.transform.elements;
      scratch.center.copy(this.center).applyMatrix4(this.transform).toArray(this.bounds, i * 4);
      // A transformed box encloses even the heavily nonuniform lidar tree scales.
      const { x, y, z } = this.size;
      const rx = Math.abs(m[0]) * x + Math.abs(m[4]) * y + Math.abs(m[8]) * z;
      const ry = Math.abs(m[1]) * x + Math.abs(m[5]) * y + Math.abs(m[9]) * z;
      const rz = Math.abs(m[2]) * x + Math.abs(m[6]) * y + Math.abs(m[10]) * z;
      this.bounds[i * 4 + 3] = Math.hypot(rx, ry, rz) + this.padding + .01;
    }
  }

  forView(camera: THREE.Camera, frustum: THREE.Frustum, shadow?: { canReceiveFrom(bound: THREE.Sphere): boolean }) {
    if (!this.count) return null;
    this.updateBounds();
    let count = 0;
    for (let i = 0; i < this.count; i++) {
      scratch.center.fromArray(this.bounds, i * 4);
      scratch.radius = this.bounds[i * 4 + 3];
      if (frustum.intersectsSphere(scratch) && (!shadow || shadow.canReceiveFrom(scratch))) this.selected[count++] = i;
    }
    if (!count) return null;
    let view = this.views.get(camera);
    if (!view || view.ids.length < count) {
      view?.mesh.dispose();
      const capacity = 2 ** Math.ceil(Math.log2(count));
      const mesh = new THREE.InstancedMesh(this.geometry, this.material, capacity);
      mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      if (this.instanceColor) {
        mesh.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(capacity * 3), 3).setUsage(THREE.DynamicDrawUsage);
      }
      mesh.frustumCulled = false;
      mesh.matrixWorld = this.matrixWorld;
      view = { mesh, ids: new Int32Array(capacity), matrixVersion: -1, colorVersion: -1 };
      this.views.set(camera, view);
    }
    const mesh = view.mesh;
    mesh.castShadow = this.castShadow; mesh.receiveShadow = this.receiveShadow;
    mesh.renderOrder = this.renderOrder;
    const colorVersion = this.instanceColor?.version ?? -1;
    let changed = mesh.count !== count || this.instanceMatrix.version !== view.matrixVersion || colorVersion !== view.colorVersion;
    for (let i = 0; i < count && !changed; i++) changed = this.selected[i] !== view.ids[i];
    if (changed) {
      const matrices = this.instanceMatrix.array, colors = this.instanceColor?.array;
      for (let i = 0; i < count; i++) {
        const id = view.ids[i] = this.selected[i];
        mesh.instanceMatrix.array.set(matrices.subarray(id * 16, id * 16 + 16), i * 16);
        if (colors) mesh.instanceColor!.array.set(colors.subarray(id * 3, id * 3 + 3), i * 3);
      }
      mesh.instanceMatrix.needsUpdate = true;
      if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
      view.matrixVersion = this.instanceMatrix.version; view.colorVersion = colorVersion;
      mesh.count = count;
    }
    return mesh;
  }
}
