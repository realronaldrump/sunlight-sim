import * as THREE from 'three/webgpu';
import { Heightfield } from './terrain/heightfield';
import { TerrainRenderer } from './terrain/terrainRenderer';
import { createTerrainMaterial, TerrainMaterialHandles } from './terrain/terrainMaterial';
import { Environment } from './sky/environment';

export const WORLD_BASE = (import.meta.env.BASE_URL || '/') + 'world';

export class Game {
  renderer!: THREE.WebGPURenderer;
  scene = new THREE.Scene();
  camera = new THREE.PerspectiveCamera(60, 1, 0.3, 300000);
  hf = new Heightfield(WORLD_BASE);
  terrain!: TerrainRenderer;
  terrainMat!: TerrainMaterialHandles;
  env!: Environment;
  params = new URLSearchParams(location.search);
  clock = new THREE.Clock();
  fps = 0;
  private fly = { yaw: 0, pitch: -0.2, keys: new Set<string>() };

  constructor(private container: HTMLElement) {}

  private setLoading(frac: number, text: string) {
    const b = document.getElementById('load-bar');
    const t = document.getElementById('load-text');
    if (b) b.style.width = `${Math.round(frac * 100)}%`;
    if (t) t.textContent = text;
  }

  async start() {
    this.setLoading(0.05, 'Starting renderer');
    const forceWebGL = this.params.get('webgl') === '1';
    this.renderer = new THREE.WebGPURenderer({ antialias: true, forceWebGL, logarithmicDepthBuffer: false });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 0.55;
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.container.appendChild(this.renderer.domElement);
    await this.renderer.init();
    this.onResize();
    window.addEventListener('resize', () => this.onResize());

    this.setLoading(0.15, 'Loading terrain index');
    await this.hf.init();
    this.terrainMat = createTerrainMaterial();
    this.terrain = new TerrainRenderer(this.hf, this.terrainMat.material);
    this.scene.add(this.terrain.group);
    this.env = new Environment(this.scene, this.renderer, this.camera, { shadows: true, shadowMapSize: 2048, cascades: 3, shadowFar: 900 });
    this.terrainMat.sunDir.value.copy(this.env.sunDir.value);

    // initial camera
    const cam = this.params.get('cam');
    let x = 0, z = 0, y = 0;
    if (cam) { [x, y, z] = cam.split(',').map(Number); }
    await this.hf.ensureArea(0, x, -z, 300);
    const ground = this.hf.heightAt(x, z);
    if (!cam) y = ground + 40;
    this.camera.position.set(x, y, z);
    if (this.params.get('yaw')) this.fly.yaw = Number(this.params.get('yaw')) * Math.PI / 180;
    if (this.params.get('pitch')) this.fly.pitch = Number(this.params.get('pitch')) * Math.PI / 180;
    this.setupFlyControls();

    this.setLoading(0.5, 'Building terrain');
    // warm up terrain until nearby chunks are built
    for (let i = 0; i < 200; i++) {
      this.updateFlyCamera(0);
      this.terrain.update(this.camera.position);
      if (i > 5 && this.terrain.idle) break;
      await new Promise((r) => setTimeout(r, 16));
    }
    this.setLoading(1, 'Ready');
    document.getElementById('loading')?.classList.add('done');
    this.renderer.setAnimationLoop(() => this.frame());
  }

  private onResize() {
    const w = window.innerWidth, h = window.innerHeight;
    this.renderer.setSize(w, h);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    this.env?.csm?.updateFrustums();
  }

  private setupFlyControls() {
    const el = this.renderer.domElement;
    window.addEventListener('keydown', (e) => this.fly.keys.add(e.code));
    window.addEventListener('keyup', (e) => this.fly.keys.delete(e.code));
    let drag = false, lx = 0, ly = 0;
    el.addEventListener('mousedown', (e) => { drag = true; lx = e.clientX; ly = e.clientY; });
    window.addEventListener('mouseup', () => (drag = false));
    window.addEventListener('mousemove', (e) => {
      if (!drag) return;
      this.fly.yaw -= (e.clientX - lx) * 0.004;
      this.fly.pitch = THREE.MathUtils.clamp(this.fly.pitch - (e.clientY - ly) * 0.004, -1.5, 1.5);
      lx = e.clientX; ly = e.clientY;
    });
  }

  private updateFlyCamera(dt: number) {
    const k = this.fly.keys;
    const speed = (k.has('ShiftLeft') ? 300 : 40) * dt;
    const fwd = new THREE.Vector3(-Math.sin(this.fly.yaw), 0, -Math.cos(this.fly.yaw));
    const right = new THREE.Vector3(-fwd.z, 0, fwd.x);
    if (k.has('KeyW')) this.camera.position.addScaledVector(fwd, speed);
    if (k.has('KeyS')) this.camera.position.addScaledVector(fwd, -speed);
    if (k.has('KeyD')) this.camera.position.addScaledVector(right, speed);
    if (k.has('KeyA')) this.camera.position.addScaledVector(right, -speed);
    if (k.has('KeyE')) this.camera.position.y += speed;
    if (k.has('KeyQ')) this.camera.position.y -= speed;
    const g = this.hf.heightAt(this.camera.position.x, this.camera.position.z);
    if (this.camera.position.y < g + 1.5) this.camera.position.y = g + 1.5;
    this.camera.rotation.set(this.fly.pitch, this.fly.yaw, 0, 'YXZ');
    void this.hf.ensureArea(0, this.camera.position.x, -this.camera.position.z, 200);
  }

  private frame() {
    const dt = Math.min(this.clock.getDelta(), 0.1);
    this.fps = this.fps * 0.95 + (dt > 0 ? 1 / dt : 0) * 0.05;
    this.updateFlyCamera(dt);
    this.terrainMat.viewer.value.copy(this.camera.position);
    this.terrain.update(this.camera.position);
    this.env.update(this.camera.position);
    this.renderer.render(this.scene, this.camera);
  }
}
