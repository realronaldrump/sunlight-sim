import * as THREE from 'three/webgpu';
import { Heightfield } from './terrain/heightfield';
import { TerrainRenderer } from './terrain/terrainRenderer';
import { createTerrainMaterial, TerrainMaterialHandles } from './terrain/terrainMaterial';
import { Environment } from './sky/environment';
import { LiftSystem } from './lifts/liftSystem';
import { Player } from './skier/player';
import { InputManager } from './skier/input';
import { CameraRig } from './camera/cameraRig';
import { Hud } from './ui/hud';
import { TreeSystem } from './trees/trees';
import { RunSystem } from './runs/runs';
import { TrailMap } from './ui/trailMap';
import { NetClient } from './net/netClient';
import { showMenu, showRoomBox, ChatUI } from './ui/menu';
import { detectQuality, PRESETS, QualityPreset, pixelRatioFor } from './quality';
import { SkiAudio } from './audio/audio';
import { buildBuildings, buildResortExtras } from './world/buildings';
import { mergeStatic } from './world/mergeStatic';
import { Snowfall } from './sky/snowfall';
import { SkiTracks } from './skier/tracks';
import { OptionsPanel } from './ui/options';
import { ColliderGrid } from '../../shared/collision';
import { SurfaceMap } from '../../shared/surface';
import type { TerrainProbe, Vec3 } from '../../shared/skiPhysics';
import type { LiftDef } from '../../shared/lifts';
import { mogulOffset } from '../../shared/moguls';

export const WORLD_BASE = (import.meta.env.BASE_URL || '/') + 'world';

export interface RunInfo { id: number; name: string; difficulty: string; grooming: string; kind: string; points: number[][] }
export interface ResortData { lifts: LiftDef[]; runs: RunInfo[]; buildings: any[]; roads: any[]; peaks: any[] }

export class Game {
  renderer!: THREE.WebGPURenderer;
  scene = new THREE.Scene();
  camera = new THREE.PerspectiveCamera(62, 1, 0.25, 300000);
  hf = new Heightfield(WORLD_BASE);
  terrain!: TerrainRenderer;
  terrainMat!: TerrainMaterialHandles;
  env!: Environment;
  resort!: ResortData;
  lifts!: LiftSystem;
  surface: SurfaceMap | null = null;
  colliders = new ColliderGrid(8);
  player!: Player;
  trees!: TreeSystem;
  runs!: RunSystem;
  trailMap!: TrailMap;
  net: NetClient | null = null;
  chat!: ChatUI;
  quality!: QualityPreset;
  audio = new SkiAudio();
  snowfall = new Snowfall();
  tracks = new SkiTracks();
  private trackFade = 0;
  options!: OptionsPanel;
  private lastMode = '';
  private lastRideH = -1;
  input = new InputManager();
  camRig!: CameraRig;
  hud!: Hud;
  params = new URLSearchParams(location.search);
  timer = new THREE.Timer();
  fps = 60;
  frameMs = 16;
  flyMode = false;
  slopeOverlay = false;
  private fly = { yaw: 0, pitch: -0.2, keys: new Set<string>() };
  private tmpV = new THREE.Vector3();
  private tmpV2 = new THREE.Vector3();
  probe!: TerrainProbe;
  onFrame: ((dt: number) => void)[] = [];
  ready = false;

  constructor(private container: HTMLElement) {}

  setLoading(frac: number, text: string) {
    const b = document.getElementById('load-bar');
    const t = document.getElementById('load-text');
    if (b) b.style.width = `${Math.round(frac * 100)}%`;
    if (t) t.textContent = text;
  }

  async start() {
    this.setLoading(0.05, 'Starting renderer');
    const forceWebGL = this.params.get('webgl') === '1';
    this.quality = PRESETS[await detectQuality()];
    const Q = this.quality;
    this.renderer = new THREE.WebGPURenderer({ antialias: Q.antialias, forceWebGL });
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 0.55;
    this.renderer.shadowMap.enabled = Q.shadows;
    this.container.appendChild(this.renderer.domElement);
    await this.renderer.init();
    this.onResize();
    window.addEventListener('resize', () => this.onResize());

    this.setLoading(0.12, 'Loading resort data');
    const [_, resort, surface] = await Promise.all([
      this.hf.init(),
      fetch(`${WORLD_BASE}/resort.json`).then((r) => r.json()),
      SurfaceMap.load(WORLD_BASE, async (p) => (await fetch(p)).arrayBuffer()).catch(() => null),
    ]);
    void _;
    this.resort = resort;
    this.surface = surface;
    if (surface) this.hf.modifier = (x, n) => mogulOffset(x, n, surface.mogulsLocal(x, n));
    this.probe = {
      height: (x, z) => this.hf.heightAt(x, z),
      normal: (x, z, out: Vec3) => { const n = this.hf.normalAt(x, z, 1); out.x = n.x; out.y = n.y; out.z = n.z; return out; },
      surface: (x, z) => this.surface ? this.surface.at(x, z) : { groomed: 1, piste: 1, moguls: 0 },
    };

    this.terrainMat = createTerrainMaterial();
    this.terrain = new TerrainRenderer(this.hf, this.terrainMat.material);
    this.terrain.splitFactor = Q.terrainSplit;
    this.scene.add(this.terrain.group);
    this.env = new Environment(this.scene, this.renderer, this.camera, { shadows: Q.shadows, shadowMapSize: Q.shadowMapSize, cascades: Q.cascades, shadowFar: Q.shadowFar });
    this.terrainMat.sunDir.value.copy(this.env.sunDir.value);

    this.runs = new RunSystem(this.resort);
    await this.runs.load(WORLD_BASE).catch((e) => console.warn('runs raster failed', e));
    this.runLookup = (x, z) => this.runs.runAt(x, z);
    this.lifts = new LiftSystem(this.resort.lifts);
    this.scene.add(this.lifts.group);
    for (const c of this.lifts.colliders) this.colliders.add(c);

    // spawn near the main base lift (Segundo/Tercero bottom terminals by the base lodge)
    const seg = this.resort.lifts.find((l) => l.name === 'Segundo') ?? this.resort.lifts[0];
    this.setLoading(0.25, 'Loading terrain near the base');
    await this.hf.ensureArea(0, seg.bottom[0], -seg.bottom[2], 300);
    await Promise.all(this.resort.lifts.flatMap((l) => [this.hf.ensureArea(0, l.bottom[0], -l.bottom[2], 40), this.hf.ensureArea(0, l.top[0], -l.top[2], 40)]));
    this.lifts.settle((x, z) => this.hf.heightAt(x, z));
    const spawn = this.spawnPoint();
    this.setLoading(0.35, 'Loading trees');
    this.trees = new TreeSystem(WORLD_BASE, this.colliders, Q.treeNear, Q.treeFar);
    this.scene.add(this.trees.group);
    await this.trees.init(spawn).catch((e) => console.warn('trees failed', e));
    this.player = new Player(new THREE.Vector3(spawn.x, this.hf.heightAt(spawn.x, spawn.z), spawn.z), spawn.heading, this.probe, this.colliders, this.lifts);
    this.scene.add(this.player.model.root);
    this.runs.buildSigns((x, z) => this.hf.heightAt(x, z), this.colliders);
    this.runs.buildBoundary((x, z) => this.hf.heightAt(x, z));
    this.scene.add(this.runs.group);
    this.trailMap = new TrailMap(this.resort, WORLD_BASE);
    this.trailMap.onTeleport = (name) => this.teleportToRun(name);
    if (this.surface) {
      const s = this.surface;
      const tex = new THREE.DataTexture(s.data, s.w, s.h, THREE.RGBAFormat);
      tex.flipY = false; tex.magFilter = THREE.LinearFilter; tex.minFilter = THREE.LinearMipmapLinearFilter; tex.generateMipmaps = true;
      tex.needsUpdate = true;
      this.terrainMat.setSurface(tex, s.x0, s.n0, s.w * s.res, s.h * s.res);
    }
    await Promise.all([this.loadBaseMask(), this.loadLandcover()]);
    await this.hf.ensureArea(0, 0, 1000, 450);
    const staticGroup = new THREE.Group(); staticGroup.name = 'static';
    staticGroup.add(buildBuildings(this.resort.buildings, (x, z) => this.hf.heightAt(x, z), this.colliders));
    staticGroup.add(buildResortExtras(this.resort.lifts, (x, z) => this.hf.heightAt(x, z), (x, z) => this.hf.slopeDeg(x, z, 3), this.colliders));
    mergeStatic(staticGroup);
    this.scene.add(staticGroup);
    for (const g of this.lifts.group.children) if (!(g as THREE.InstancedMesh).isInstancedMesh) mergeStatic(g);
    mergeStatic(this.runs.group);
    this.camRig = new CameraRig(this.camera, this.renderer.domElement, (x, z) => this.hf.heightAt(x, z));
    this.camRig.blocked = (x, z) => this.colliders.query(x, z).some((c) => c.type === 'box' && Math.hypot(c.x - x, c.z - z) < 12);
    this.hud = new Hud();

    this.flyMode = this.params.get('fly') === '1';
    const cam = this.params.get('cam');
    if (cam) {
      const [x, y, z] = cam.split(',').map(Number);
      this.camera.position.set(x, y, z);
      this.flyMode = true;
      await this.hf.ensureArea(0, x, -z, 300);
    } else this.camera.position.copy(this.player.position).add(new THREE.Vector3(0, 3, 6));
    if (this.params.get('yaw')) this.fly.yaw = Number(this.params.get('yaw')) * Math.PI / 180;
    if (this.params.get('pitch')) this.fly.pitch = Number(this.params.get('pitch')) * Math.PI / 180;
    if (this.params.get('hour')) this.env.setHour(Number(this.params.get('hour')));
    this.scene.add(this.snowfall.mesh);
    this.scene.add(this.tracks.mesh);
    if (this.params.get('snow') === '1') this.setSnow(true);
    this.options = new OptionsPanel({
      hour: this.env.hour, snow: this.env.snowing, volume: this.audio.volume,
      setHour: (h) => this.env.setHour(h), setSnow: (on) => this.setSnow(on), setVolume: (v) => { this.audio.volume = v; },
    });
    this.setupFlyControls();

    this.setLoading(0.55, 'Building terrain');
    for (let i = 0; i < 300; i++) {
      this.updateCamera(1 / 60);
      this.terrain.update(this.camera.position);
      this.trees.update(this.camera.position);
      if (i > 5 && this.terrain.idle) break;
      this.setLoading(0.55 + 0.4 * (i / 300), 'Building terrain');
      await new Promise((r) => setTimeout(r, 16));
    }
    this.setLoading(1, 'Ready');
    document.getElementById('loading')?.classList.add('done');
    this.chat = new ChatUI();
    const startAudio = () => { if (this.params.get('mute') !== '1') this.audio.start(); };
    window.addEventListener('keydown', startAudio);
    window.addEventListener('pointerdown', startAudio);
    this.renderer.setAnimationLoop(() => this.frame());
    // start menu (skipped by ?autostart=1 for tests: name/color/room come from the URL)
    let choice: { name: string; color: string; room: string | null };
    if (this.params.get('autostart') === '1') {
      choice = { name: this.params.get('name') ?? 'Skier', color: '#' + (this.params.get('color') ?? 'd33a2c'), room: this.params.get('room') };
    } else {
      this.input.enabled = false;
      const r = await showMenu({ quality: this.quality.name });
      this.input.enabled = true;
      if (r.quality !== 'auto' && r.quality !== this.quality.name) { location.reload(); return; }
      choice = r;
    }
    this.playerName = choice.name; this.playerColor = choice.color;
    this.player.model.setJacket(choice.color);
    if (choice.room) await this.joinRoom(choice.room);
    this.ready = true;
  }

  private spawnCache: { x: number; z: number; heading: number } | null = null;
  /** A gentle spot near the Segundo load line (main base lift), facing the load line. */
  spawnPoint() {
    if (this.spawnCache) return this.spawnCache;
    const li = Math.max(0, this.resort.lifts.findIndex((l) => l.name === 'Segundo'));
    const path = this.lifts.paths[li];
    const lp = path.loadPoint();
    // preferred spot: 14 m before the load line on the loading side
    const px = lp.x - path.ax * 14 + path.rx * 3, pz = lp.z - path.az * 14 + path.rz * 3;
    let best = { x: px, z: pz, score: Infinity };
    for (let i = -20; i <= 20; i++) for (let j = -20; j <= 20; j++) {
      const x = px + i * 1.5, z = pz + j * 1.5;
      if (this.hf.bestLevel(x, -z) !== 0) continue;
      const slope = this.hf.slopeDeg(x, z, 2.5);
      if (slope > 4.5 || path.inLoadZone(x, z)) continue;
      if (this.colliders.query(x, z).some((c) => Math.hypot(c.x - x, c.z - z) < 4)) continue;
      const score = Math.hypot(x - px, z - pz) + slope * 2;
      if (score < best.score) best = { x, z, score };
    }
    const heading = Math.atan2(-(lp.x - best.x), -(lp.z - best.z));
    if (best.score < Infinity) this.spawnCache = { x: best.x, z: best.z, heading };
    return { x: best.x, z: best.z, heading };
  }

  respawn() {
    const s = this.spawnPoint();
    this.player.teleport(s.x, s.z, s.heading);
    this.net?.markTeleport();
    this.hud.toast('Back at the base area');
  }

  private onResize() {
    const w = window.innerWidth, h = window.innerHeight;
    this.renderer.setPixelRatio(pixelRatioFor(this.quality, w, h));
    this.renderer.setSize(w, h);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    this.env?.csm?.updateFrustums();
  }

  private setupFlyControls() {
    window.addEventListener('keydown', (e) => this.fly.keys.add(e.code));
    window.addEventListener('keyup', (e) => this.fly.keys.delete(e.code));
    let drag = false, lx = 0, ly = 0;
    this.renderer.domElement.addEventListener('mousedown', (e) => { drag = true; lx = e.clientX; ly = e.clientY; });
    window.addEventListener('mouseup', () => (drag = false));
    window.addEventListener('mousemove', (e) => {
      if (!drag || !this.flyMode) return;
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
  }

  private updateCamera(dt: number) {
    if (this.flyMode) { this.updateFlyCamera(dt); return; }
    const st = this.player.st;
    this.tmpV.set(st.vel.x, st.vel.y, st.vel.z);
    this.camRig.update(dt, this.player.position, st.heading, this.tmpV, this.player.fallLine(this.tmpV2), !!this.player.ride);
  }

  runAt(x: number, z: number): RunInfo | null {
    return this.runLookup ? this.runLookup(x, z) : null;
  }
  runLookup: ((x: number, z: number) => RunInfo | null) | null = null;

  private frame() {
    this.timer.update();
    const t0 = performance.now();
    const dt = Math.min(this.timer.getDelta(), 0.1);
    this.fps = this.fps * 0.95 + (dt > 0 ? 1 / dt : 60) * 0.05;
    const actions = this.input.actions();
    this.input.enabled = !this.chat?.open;
    if (actions.chat && this.net?.connected) this.chat.openInput();
    if (!this.flyMode) {
      const inp = this.input.ski(dt);
      if (actions.getUp) this.player.getUp();
      if (actions.skipLift) this.player.skipRide();
      if (actions.respawn) this.respawn();
      if (actions.camera) this.hud.toast(`Camera: ${{ chase: 'chase', first: 'first person', side: 'side profile' }[this.camRig.cycle()]}`);
      this.player.update(dt, inp);
      if (this.net) {
        if (this.net.collideLocal()) { this.player.st.mode = 'fallen'; this.player.st.modeTime = 0; }
        this.net.update(dt);
      }
    }
    if (actions.help) this.hud.toggleHelp();
    if (actions.mute) { this.audio.enabled = !this.audio.enabled; this.hud.toast(this.audio.enabled ? 'Sound on' : 'Sound off'); }
    if (actions.map) this.trailMap.toggle();
    if (actions.options) this.options.toggle();
    if (this.trailMap.visible) {
      const st2 = this.player.st;
      this.trailMap.players = [{ name: this.playerName, color: this.playerColor, x: st2.pos.x, z: st2.pos.z, heading: st2.heading, self: true }, ...this.remoteMapPlayers()];
      if (Math.random() < 0.2) this.trailMap.draw();
    }
    if (actions.slope) {
      this.slopeOverlay = !this.slopeOverlay;
      this.terrainMat.slopeOverlay.value = this.slopeOverlay ? 1 : 0;
      this.hud.toast(this.slopeOverlay ? 'Slope overlay on: green < 15, blue 15-25, black 25-35, orange 35-45, red > 45 deg' : 'Slope overlay off', 4);
    }
    this.lifts.update();
    this.updateCamera(dt);
    for (const f of this.onFrame) f(dt);
    const p = this.flyMode ? this.camera.position : this.player.position;
    void this.hf.ensureArea(0, p.x, -p.z, 160);
    if (Math.random() < 0.01) this.hf.evict(p.x, -p.z, 900);
    this.trees.update(this.camera.position);
    if (this.snowfall.mesh.visible) this.snowfall.update(this.camera.position);
    this.terrainMat.viewer.value.copy(this.camera.position);
    this.terrain.update(this.camera.position);
    this.env.update(p);

    const st = this.player.st;
    const run = this.player.ride ? null : (this.runAt(st.pos.x, st.pos.z) as (RunInfo & { stats?: { avgDeg: number; maxDeg: number } }) | null);
    this.hud.update(dt, st.speed, this.player.ride ? 0 : st.slopeDeg, st.pos.y, this.modeLabel(), run);
    this.updateHints();
    this.updateLiftArrow();
    this.updateAudio(dt);
    this.updateTracks(dt);
    this.renderer.render(this.scene, this.camera);
    this.frameMs = this.frameMs * 0.9 + (performance.now() - t0) * 0.1;
    if (Math.random() < 0.1) {
      const info = this.renderer.info;
      this.hud.stats(`${this.fps.toFixed(0)} fps  cpu ${this.frameMs.toFixed(1)} ms\nterrain ${this.terrain.visibleCount} chunks\ncalls ${info.render.drawCalls} tris ${(info.render.triangles / 1e6).toFixed(2)}M`);
    }
  }

  private async loadGrid(file: string, magic: string) {
    const buf = await (await fetch(`${WORLD_BASE}/${file}`)).arrayBuffer();
    const u8 = new Uint8Array(buf);
    const raw = u8[0] === 0x1f ? await new Response(new Blob([u8]).stream().pipeThrough(new DecompressionStream('gzip'))).arrayBuffer() : buf;
    const dv = new DataView(raw);
    const m = String.fromCharCode(dv.getUint8(0), dv.getUint8(1), dv.getUint8(2), dv.getUint8(3));
    if (m !== magic) throw new Error('bad grid ' + file);
    const x0 = dv.getFloat32(4, true), n0 = dv.getFloat32(8, true), res = dv.getFloat32(12, true);
    const w = dv.getUint16(16, true), h = dv.getUint16(18, true);
    const tex = new THREE.DataTexture(new Uint8Array(raw, 20, w * h), w, h, THREE.RedFormat);
    tex.magFilter = THREE.LinearFilter; tex.minFilter = THREE.LinearMipmapLinearFilter; tex.generateMipmaps = true; tex.needsUpdate = true;
    return { tex, x0, n0, sx: w * res, sn: h * res };
  }

  private async loadLandcover() {
    try {
      const [far, mid] = await Promise.all([this.loadGrid('landcover_far.bin.gz', 'SLL1'), this.loadGrid('landcover_mid.bin.gz', 'SLL1')]);
      this.terrainMat.setLandcover(far.tex, far.x0, far.n0, far.sx, far.sn);
      this.terrainMat.setLandcoverMid(mid.tex, mid.x0, mid.n0, mid.sx, mid.sn);
    } catch (e) { console.warn('landcover failed', e); }
  }

  private async loadBaseMask() {
    try {
      const buf = await (await fetch(`${WORLD_BASE}/base.bin.gz`)).arrayBuffer();
      const u8 = new Uint8Array(buf);
      const raw = u8[0] === 0x1f ? await new Response(new Blob([u8]).stream().pipeThrough(new DecompressionStream('gzip'))).arrayBuffer() : buf;
      const dv = new DataView(raw);
      const x0 = dv.getFloat32(4, true), n0 = dv.getFloat32(8, true), res = dv.getFloat32(12, true);
      const w = dv.getUint16(16, true), h = dv.getUint16(18, true);
      const tex = new THREE.DataTexture(new Uint8Array(raw, 20, w * h), w, h, THREE.RedFormat);
      tex.magFilter = THREE.LinearFilter; tex.minFilter = THREE.LinearMipmapLinearFilter; tex.generateMipmaps = true; tex.needsUpdate = true;
      this.terrainMat.setBase(tex, x0, n0, w * res, h * res);
    } catch (e) { console.warn('base mask failed', e); }
  }

  async joinRoom(room: string) {
    this.net = new NetClient(this.player, this.lifts);
    this.scene.add(this.net.group);
    this.net.onChat = (n, t) => this.chat.add(n, t);
    this.net.onStatus = (t) => this.hud.toast(t, 3);
    this.chat.onSend = (t) => this.net?.chat(t);
    this.remoteMapPlayers = () => this.net?.mapPlayers() ?? [];
    const ok = await this.net.connect(NetClient.defaultUrl(), room, this.playerName, this.playerColor);
    if (ok) showRoomBox(room);
    else this.hud.toast('Could not reach the multiplayer server. Skiing solo.', 5);
    return ok;
  }

  setSnow(on: boolean) {
    this.env.setSnowing(on);
    this.snowfall.mesh.visible = on;
  }

  playerName = 'You';
  playerColor = '#d33a2c';
  remoteMapPlayers: () => { name: string; color: string; x: number; z: number; heading: number }[] = () => [];

  /** Test hook: put a free camera at (x, y, z) looking along yaw/pitch (degrees). y < 0 = meters above ground. */
  async setView(x: number, y: number, z: number, yawDeg: number, pitchDeg: number) {
    this.flyMode = true;
    await this.hf.ensureArea(0, x, -z, 250);
    const gy = this.hf.heightAt(x, z);
    this.camera.position.set(x, y < 0 ? gy - y : y, z);
    this.fly.yaw = yawDeg * Math.PI / 180;
    this.fly.pitch = pitchDeg * Math.PI / 180;
    this.fly.keys.clear();
  }

  /** Test hook: resolves when terrain and nearby trees have finished streaming. */
  async waitIdle(timeoutMs = 20000) {
    const t0 = performance.now();
    let calm = 0;
    while (performance.now() - t0 < timeoutMs) {
      await new Promise((r) => setTimeout(r, 100));
      const busy = !this.terrain.idle || this.trees.loaded < this.trees.total;
      calm = busy ? 0 : calm + 1;
      if (calm >= 5) return true;
    }
    return false;
  }

  /** Test hook: look from (x,z) toward a target point (game coords). */
  lookAt(x: number, z: number, tx: number, ty: number, tz: number, eyeAbove = 1.7) {
    const gy = this.hf.heightAt(x, z);
    const dx = tx - x, dz = tz - z, dy = ty - (gy + eyeAbove);
    const yaw = Math.atan2(-dx, -dz) * 180 / Math.PI;
    const pitch = Math.atan2(dy, Math.hypot(dx, dz)) * 180 / Math.PI;
    return this.setView(x, -eyeAbove, z, yaw, pitch);
  }

  async teleportToRun(name: string) {
    const top = this.runs.runTops().get(name);
    if (!top) return;
    // start a few meters down the run, facing down it
    const x = top.x + top.dx * 4, z = top.z + top.dz * 4;
    await this.hf.ensureArea(0, x, -z, 200);
    this.player.teleport(x, z, Math.atan2(-top.dx, -top.dz));
    this.net?.markTeleport();
    this.hud.toast(`Top of ${name}`);
  }

  private updateLiftArrow() {
    const st = this.player.st;
    if (this.player.ride || this.flyMode) { this.hud.hideLiftDirection(); return; }
    let best: { name: string; d: number; x: number; z: number } | null = null;
    for (const p of this.lifts.paths) {
      const lp = p.loadPoint();
      const d = Math.hypot(lp.x - st.pos.x, lp.z - st.pos.z);
      if (!best || d < best.d) best = { name: p.def.name, d, x: lp.x, z: lp.z };
    }
    if (!best || best.d < 12) { this.hud.hideLiftDirection(); return; }
    const camDir = new THREE.Vector3(); this.camera.getWorldDirection(camDir);
    const camYaw = Math.atan2(camDir.x, -camDir.z);
    const tgtYaw = Math.atan2(best.x - st.pos.x, -(best.z - st.pos.z));
    this.hud.liftDirection(best.name, best.d, tgtYaw - camYaw);
  }

  private updateTracks(dt: number) {
    const st = this.player.st;
    if (this.player.ride || st.mode === 'fallen' || st.mode === 'air' || st.speed < 1.2 || !st.grounded) { this.tracks.break(); }
    else {
      const d = new THREE.Vector3(-Math.sin(st.heading), 0, -Math.cos(st.heading));
      const r = new THREE.Vector3(-d.z, 0, d.x);
      const w = 0.14 + 0.2 * st.plow;
      const l = new THREE.Vector3(st.pos.x - r.x * w, 0, st.pos.z - r.z * w);
      const rr = new THREE.Vector3(st.pos.x + r.x * w, 0, st.pos.z + r.z * w);
      l.y = this.hf.heightAt(l.x, l.z); rr.y = this.hf.heightAt(rr.x, rr.z);
      const surf = this.surface ? this.surface.at(st.pos.x, st.pos.z) : { groomed: 1, piste: 1, moguls: 0 };
      // deeper, wider tracks in soft snow and when skidding
      this.tracks.add(l, rr, d, 0.1 + 0.25 * st.skid, 0.6 + 0.6 * (1 - surf.groomed) + 0.4 * st.skid);
    }
    this.trackFade += dt;
    if (this.trackFade > 1) { this.tracks.fade(this.trackFade); this.trackFade = 0; }
  }

  private updateAudio(dt: number) {
    const pl = this.player, st = pl.st;
    const surf = this.surface ? this.surface.at(st.pos.x, st.pos.z) : { groomed: 1, piste: 1, moguls: 0 };
    let near = Infinity;
    for (const l of this.resort.lifts) {
      near = Math.min(near, Math.hypot(st.pos.x - l.bottom[0], st.pos.z - l.bottom[2]), Math.hypot(st.pos.x - l.top[0], st.pos.z - l.top[2]));
    }
    let towerPass = false;
    if (pl.ride) {
      const path = this.lifts.paths[pl.ride.lift];
      const b = path.def.bottom;
      const h = (st.pos.x - b[0]) * path.ax + (st.pos.z - b[2]) * path.az;
      if (this.lastRideH >= 0) for (const sup of path.def.supports) if (sup.kind === 'tower' && this.lastRideH < sup.s && h >= sup.s) towerPass = true;
      this.lastRideH = h;
    } else this.lastRideH = -1;
    const fell = st.mode === 'fallen' && this.lastMode !== 'fallen';
    this.lastMode = st.mode;
    this.audio.update(dt, {
      speed: st.speed, skid: st.skid, edge: st.edge, grounded: st.grounded, groomed: surf.groomed, moguls: surf.moguls,
      plow: st.plow, riding: !!pl.ride, nearTerminal: near, towerPass, fell, inAir: st.mode === 'air',
    });
  }

  private modeLabel() {
    const st = this.player.st;
    if (this.player.ride) return `Riding ${this.lifts.paths[this.player.ride.lift].def.name}`;
    return { skiing: '', standing: '', air: 'Airborne', fallen: 'Fallen: press R', gettingUp: 'Getting up', riding: '' }[st.mode] ?? '';
  }

  private updateHints() {
    const pl = this.player;
    if (pl.ride) {
      const path = this.lifts.paths[pl.ride.lift];
      const b = path.def.bottom;
      const along = (pl.st.pos.x - b[0]) * path.ax + (pl.st.pos.z - b[2]) * path.az;
      const remain = Math.max(0, (path.horiz - along) / path.def.speed);
      this.hud.hint(`${path.def.name} lift: ${Math.floor(remain / 60)}:${String(Math.floor(remain % 60)).padStart(2, '0')} to the top. Press <b>F</b> to skip.`);
    } else if (pl.inLoadZone >= 0) {
      this.hud.hint(`Wait on the red line, the ${this.lifts.paths[pl.inLoadZone].def.name} chair is coming`);
    } else if (pl.st.mode === 'fallen' && pl.st.speed < 1) {
      this.hud.hint('You fell. Press <b>R</b> to get up');
    } else this.hud.hint(null);
  }
}
