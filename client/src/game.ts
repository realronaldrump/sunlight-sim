import * as THREE from 'three/webgpu';
import { Heightfield } from './terrain/heightfield';
import { TerrainRenderer } from './terrain/terrainRenderer';
import { createTerrainMaterial, TerrainMaterialHandles } from './terrain/terrainMaterial';
import { Environment } from './sky/environment';
import { LiftSystem } from './lifts/liftSystem';
import { Player } from './skier/player';
import { loadHumanAsset } from './skier/humanBody';
import { InputManager } from './skier/input';
import { CameraRig } from './camera/cameraRig';
import { Hud } from './ui/hud';
import { TreeSystem } from './trees/trees';
import { RunSystem } from './runs/runs';
import { TrailMap } from './ui/trailMap';
import { Minimap } from './ui/minimap';
import { NetClient } from './net/netClient';
import { showMenu, showRoomBox, ChatUI } from './ui/menu';
import { detectGraphics, PRESETS, QualityPreset, pixelRatioFor } from './quality';
import { initializeRenderer } from './rendererSetup';
import { SkiAudio } from './audio/audio';
import { AudioScene } from './audio/audioScene';
import { buildBuildings, buildResortExtras } from './world/buildings';
import { mergeStatic } from './world/mergeStatic';
import { AmbientSkiers } from './world/ambient';
import { Snowfall } from './sky/snowfall';
import { SkiTracks } from './skier/tracks';
import { OptionsPanel } from './ui/options';
import { ColliderGrid } from '../../shared/collision';
import { SurfaceMap } from '../../shared/surface';
import type { TerrainProbe, Vec3 } from '../../shared/skiPhysics';
import type { LiftDef } from '../../shared/lifts';
import { mogulOffset } from '../../shared/moguls';
import { FlightArea } from '../../shared/dronePhysics';
import { DroneSystem } from './drone/droneSystem';

export const WORLD_BASE = (import.meta.env.BASE_URL || '/') + 'world';

export interface RunInfo { id: number; name: string; difficulty: string; grooming: string; kind: string; points: number[][]; outline?: number[][][] }
export interface ResortData { lifts: LiftDef[]; runs: RunInfo[]; buildings: any[]; roads: any[]; peaks: any[]; boundary?: number[][]; map?: { x0: number; x1: number; z0: number; z1: number } }

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
  minimap!: Minimap;
  net: NetClient | null = null;
  chat!: ChatUI;
  quality!: QualityPreset;
  audio = new SkiAudio();
  snowfall = new Snowfall();
  tracks = new SkiTracks((x, z) => this.probe.height(x, z));
  ambient: AmbientSkiers | null = null;
  private trackFade = 0;
  options!: OptionsPanel;
  private audioScene = new AudioScene();
  input = new InputManager();
  camRig!: CameraRig;
  hud!: Hud;
  drone!: DroneSystem;
  private launchingDrone = false;
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
    const graphics = await detectGraphics(this.params.get('webgl') === '1');
    this.quality = PRESETS[graphics.quality];
    const Q = this.quality;
    this.renderer = await initializeRenderer(Q.antialias, graphics.forceWebGL);
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 0.55;
    this.renderer.shadowMap.enabled = Q.shadows;
    this.container.appendChild(this.renderer.domElement);
    this.onResize();
    window.addEventListener('resize', () => this.onResize());

    this.setLoading(0.12, 'Loading resort data');
    const [_, resort, surface] = await Promise.all([
      this.hf.init(),
      fetch(`${WORLD_BASE}/resort.json`, { cache: 'no-cache' }).then((r) => r.json()),
      SurfaceMap.load(WORLD_BASE, async (p) => (await fetch(p)).arrayBuffer()).catch(() => null),
      loadHumanAsset((import.meta.env.BASE_URL || '/').replace(/\/$/, '')),
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
    this.terrain = new TerrainRenderer(this.hf, this.terrainMat.material, this.resort.runs);
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
    this.probe = this.lifts.buildStationSurfaces(this.probe);
    const spawn = this.spawnPoint();
    this.setLoading(0.35, 'Loading trees');
    this.trees = new TreeSystem(WORLD_BASE, this.colliders, Q.treeNear, Q.treeFar, this.resort.buildings);
    this.scene.add(this.trees.group);
    await this.trees.init(spawn).catch((e) => console.warn('trees failed', e));
    this.player = new Player(new THREE.Vector3(spawn.x, this.hf.heightAt(spawn.x, spawn.z), spawn.z), spawn.heading, this.probe, this.colliders, this.lifts);
    this.scene.add(this.player.model.root);
    this.runs.buildSigns((x, z) => this.hf.heightAt(x, z), this.colliders);
    this.runs.buildBoundary((x, z) => this.hf.heightAt(x, z));
    this.scene.add(this.runs.group);
    this.trailMap = new TrailMap(this.resort, WORLD_BASE);
    this.trailMap.onTeleport = (name) => this.teleportToRun(name);
    this.trailMap.onJoinPlayer = (name) => this.joinFriend(name);
    this.minimap = new Minimap(this.resort, WORLD_BASE);
    this.minimap.onOpenMap = () => this.trailMap.toggle(true);
    if (this.surface) {
      const s = this.surface;
      const tex = new THREE.DataTexture(s.data, s.w, s.h, THREE.RGBAFormat);
      tex.flipY = false; tex.magFilter = THREE.LinearFilter; tex.minFilter = THREE.LinearMipmapLinearFilter; tex.generateMipmaps = true;
      tex.needsUpdate = true;
      this.terrainMat.setSurface(tex, s.x0, s.n0, s.w * s.res, s.h * s.res);
    }
    await Promise.all([this.loadBaseMask(), this.loadLandcover(), this.terrainMat.ready]);
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
    this.drone = new DroneSystem(new FlightArea(this.resort.boundary ?? [
      [-1200,0,-1200],[1200,0,-1200],[1200,0,1200],[-1200,0,1200],
    ]), {
      height: (x,z) => this.probe.height(x,z),
      ready: (x,z) => { const level = this.hf.bestLevel(x,-z); return level >= 0 && level <= 1; },
      obstacles: (x,z) => this.colliders.query(x,z),
    }, this.camera,this.renderer.domElement,this.scene);
    this.drone.hud.onToggle = () => this.toggleDrone();
    this.drone.hud.onCamera = () => this.drone.cycleCamera();
    this.drone.hud.onRecall = () => this.recallDrone();

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
    if (this.params.get('ambient') !== '0') {
      this.ambient = new AmbientSkiers(this.resort.runs, this.probe, this.quality.name === 'low' ? 4 : 8);
      this.scene.add(this.ambient.group);
    }
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
    if (this.drone?.active) this.toggleDrone();
    const s = this.spawnPoint();
    this.player.teleport(s.x, s.z, s.heading);
    this.net?.markTeleport();
    this.hud.toast('Back at the base area');
  }

  async toggleDrone() {
    if (!this.ready || this.chat?.open || this.launchingDrone) return;
    if (this.drone.active) {
      this.drone.exit(); this.camRig.enabled = true; this.camRig.reset();
      this.audioScene = new AudioScene();
      this.hud.toast('Back on skis');
    } else {
      // A skier may have travelled outside the flight area. Load the clamped launch
      // point before sampling its height, rather than launching in coarse/missing terrain.
      const launch = {...this.player.st.pos}; this.drone.area.constrain(launch);
      const level = this.hf.bestLevel(launch.x,-launch.z);
      if (level < 0 || level > 1) {
        this.launchingDrone = true;
        this.hud.toast('Preparing drone launch');
        try { await this.hf.ensureArea(0,launch.x,-launch.z,200); }
        finally { this.launchingDrone = false; }
        const loaded = this.hf.bestLevel(launch.x,-launch.z);
        if (loaded < 0 || loaded > 1) { this.hud.toast('Drone terrain is not ready. Try again shortly.'); return; }
      }
      this.flyMode = false;
      const st = this.player.st;
      if (!this.player.ride) { this.player.teleport(st.pos.x,st.pos.z,st.heading); this.net?.markTeleport(); }
      this.drone.enter(this.player.st.pos,this.player.st.heading);
      this.camRig.enabled = false;
      this.audioScene = new AudioScene();
      this.hud.toast('Drone ready. WASD to fly, E / Q up and down.',4);
    }
    this.env.csm?.updateFrustums();
    this.input.clear(); this.tracks.break();
  }

  recallDrone() {
    if (!this.drone.active) return;
    this.drone.recall(this.player.st.pos,this.player.st.heading);
    this.input.clear(); this.audioScene = new AudioScene();
    this.hud.toast('Drone recalled above your skier');
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
    if (this.drone?.active) return;
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
    this.input.enabled = this.ready && !this.chat?.open && !this.trailMap?.visible && !this.options?.visible;
    const actions = this.input.actions();
    if (actions.drone && this.ready && !this.chat?.open && !this.trailMap.visible && !this.options.visible) this.toggleDrone();
    if (actions.chat && this.net?.connected) this.chat.openInput();
    if (!this.flyMode) {
      if (this.drone.active) {
        if (actions.camera && this.input.enabled) this.drone.cycleCamera();
        if (actions.getUp && this.input.enabled) this.recallDrone();
        this.drone.controlsEnabled = this.input.enabled;
        this.drone.update(dt,this.input.drone());
        this.player.update(dt,{steer:0,tuck:false,plow:0,push:false,stop:true},true);
      } else {
      const inp = this.input.ski(dt);
      if (actions.getUp && this.input.enabled) this.player.getUp();
      if (actions.skipLift && this.input.enabled) this.player.skipRide();
      if (actions.respawn && this.input.enabled) this.respawn();
      if (actions.camera && this.input.enabled) this.hud.toast(`Camera: ${{ chase: 'chase', first: 'first person', side: 'side profile' }[this.camRig.cycle()]}`);
      this.player.update(dt, inp, !this.ready);
      }
      if (this.net) {
        if (!this.drone.active && this.net.collideLocal()) { this.player.st.mode = 'fallen'; this.player.st.modeTime = 0; }
        this.net.update(dt);
      }
    }
    if (actions.help) { if (this.drone.active) this.drone.hud.help(); else this.hud.toggleHelp(); }
    if (actions.mute) { this.audio.enabled = !this.audio.enabled; this.hud.toast(this.audio.enabled ? 'Sound on' : 'Sound off'); }
    if (actions.map) this.trailMap.toggle();
    if (actions.minimap) this.minimap.toggle();
    if (actions.options) this.options.toggle();
    if (this.trailMap.visible) {
      const st2 = this.drone.state ? {pos:this.drone.state.pos,heading:this.drone.state.yaw} : this.player.st;
      this.trailMap.players = [{ name: this.drone.active ? 'Your drone' : this.playerName, color: this.playerColor, x: st2.pos.x, z: st2.pos.z, heading: st2.heading, self: true },
        ...this.remoteMapPlayers(), ...(this.drone.active ? [{name:'Your skier',color:this.playerColor,x:this.player.st.pos.x,z:this.player.st.pos.z,heading:this.player.st.heading}] : [])];
      if (Math.random() < 0.2) this.trailMap.draw();
    }
    if (actions.slope) {
      this.slopeOverlay = !this.slopeOverlay;
      this.terrainMat.slopeOverlay.value = this.slopeOverlay ? 1 : 0;
      this.hud.toast(this.slopeOverlay ? 'Slope overlay on: green < 15, blue 15-25, black 25-35, orange 35-45, red > 45 deg' : 'Slope overlay off', 4);
    }
    this.lifts.update([
      ...(this.player.ride ? [this.player.ride] : []),
      ...[...(this.net?.remotes.values() ?? [])].flatMap(r => r.ride ? [r.ride] : []),
    ], this.camera.position);
    this.ambient?.update(dt, this.player.position, this.camera.position);
    this.updateCamera(dt);
    for (const f of this.onFrame) f(dt);
    const p = this.drone.state?.pos ?? (this.flyMode ? this.camera.position : this.player.position);
    void this.hf.ensureArea(0, p.x, -p.z, 160);
    if (this.drone.active) void this.hf.ensureArea(0,this.player.st.pos.x,-this.player.st.pos.z,80);
    // Keep the parked skier or occupied chair's precise snow surface resident too.
    const keepRadius = this.drone.active ? Math.max(900,Math.hypot(p.x-this.player.st.pos.x,p.z-this.player.st.pos.z)+100) : 900;
    if (Math.random() < 0.01) this.hf.evict(p.x, -p.z, keepRadius);
    this.trees.update(this.camera.position);
    if (this.snowfall.mesh.visible) this.snowfall.update(this.camera.position);
    this.terrainMat.viewer.value.copy(this.camera.position);
    this.terrain.update(this.camera.position);
    this.tmpV.set(p.x,p.y,p.z); this.env.update(this.tmpV);

    const st = this.player.st;
    const mapPos = this.drone.state?.pos ?? st.pos;
    const run = this.player.ride && !this.drone.active ? null : (this.runAt(mapPos.x, mapPos.z) as (RunInfo & { stats?: { avgDeg: number; maxDeg: number } }) | null);
    this.minimap.update(dt, {
      self: { name: this.drone.active ? 'Your drone' : this.playerName, color: this.playerColor, x: mapPos.x, z: mapPos.z, heading: this.drone.state?.yaw ?? st.heading, self: true },
      others: [...this.remoteMapPlayers(), ...(this.drone.active ? [{name:'Your skier',color:this.playerColor,x:st.pos.x,z:st.pos.z,heading:st.heading}] : [])], run,
      lift: this.drone.active ? null : this.player.ride ? this.lifts.paths[this.player.ride.lift].def.name : null,
      active: this.ready && !this.trailMap.visible, drone: this.drone.active,
    });
    this.hud.update(dt, st.speed, this.player.ride ? 0 : st.slopeDeg, st.pos.y, this.modeLabel(), run);
    this.drone.hud.update(dt,this.drone.state,this.drone.fpv,Math.hypot(mapPos.x-st.pos.x,mapPos.z-st.pos.z),
      this.drone.area.nearest(mapPos.x,mapPos.z).remaining,this.ready,this.trailMap.visible || this.options.visible,!this.input.enabled);
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
    this.net.localDrone = () => {
      const s=this.drone.state;
      return s ? {x:s.pos.x,y:s.pos.y,z:s.pos.z,yaw:s.yaw,pitch:s.pitch,bank:s.bank,tilt:s.tilt,rpm:s.rpm} : null;
    };
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
    if (this.drone?.active) this.toggleDrone();
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

  /** Teleport next to another player (or to the top of the lift they are riding). */
  async joinFriend(name: string) {
    const r = this.net ? [...this.net.remotes.values()].find((x) => x.name === name) : null;
    if (!r) return;
    if (this.drone.active) this.toggleDrone();
    let x: number, z: number, heading: number;
    if (r.ride) {
      const up = this.lifts.paths[r.ride.lift].unloadPoint();
      x = up.x; z = up.z; heading = up.heading;
    } else {
      const p = r.model.root.position;
      heading = r.heading;
      x = p.x + Math.cos(heading) * 2.5; z = p.z - Math.sin(heading) * 2.5; // 2.5 m to their right
    }
    await this.hf.ensureArea(0, x, -z, 200);
    this.player.teleport(x, z, heading);
    this.net?.markTeleport();
    this.hud.toast(r.ride ? `Waiting for ${name} at the top of the lift` : `Joined ${name}`);
  }

  async teleportToRun(name: string) {
    const top = this.runs.runTops().get(name);
    if (!top) return;
    if (this.drone.active) this.toggleDrone();
    // start a few meters down the run, facing down it
    const x = top.x + top.dx * 4, z = top.z + top.dz * 4;
    await this.hf.ensureArea(0, x, -z, 200);
    this.player.teleport(x, z, Math.atan2(-top.dx, -top.dz));
    this.net?.markTeleport();
    this.hud.toast(`Top of ${name}`);
  }

  private updateLiftArrow() {
    const st = this.player.st;
    if (this.player.ride || this.flyMode || this.drone.active) { this.hud.hideLiftDirection(); return; }
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
    if (this.drone.active || this.player.ride || st.mode === 'fallen' || st.mode === 'air' || st.speed < 1.2 || !st.grounded) { this.tracks.break(); }
    else {
      const d = new THREE.Vector3(-Math.sin(st.heading), 0, -Math.cos(st.heading));
      const r = new THREE.Vector3(-d.z, 0, d.x);
      const w = 0.14 + 0.2 * st.plow;
      const l = new THREE.Vector3(st.pos.x - r.x * w, 0, st.pos.z - r.z * w);
      const rr = new THREE.Vector3(st.pos.x + r.x * w, 0, st.pos.z + r.z * w);
      l.y = this.probe.height(l.x, l.z); rr.y = this.probe.height(rr.x, rr.z);
      const surf = this.surface ? this.surface.at(st.pos.x, st.pos.z) : { groomed: 1, piste: 1, moguls: 0 };
      // deeper, wider tracks in soft snow and when skidding
      this.tracks.add(l, rr, d, 0.1 + 0.25 * st.skid, 0.6 + 0.6 * (1 - surf.groomed) + 0.4 * st.skid);
    }
    this.trackFade += dt;
    this.tracks.update(dt);
    if (this.trackFade > 1) { this.tracks.fade(this.trackFade); this.trackFade = 0; }
  }

  private updateAudio(dt: number) {
    const flight = this.drone.state;
    const st = flight ? { ...this.player.st, pos:{x:this.camera.position.x,y:this.camera.position.y-1.6,z:this.camera.position.z},
      vel:flight.vel,speed:flight.speed,mode:'air' as const,grounded:false,edge:0,skid:0,plow:0,tuck:0,lastImpact:0 } : this.player.st;
    const surface = this.surface ? this.surface.at(st.pos.x, st.pos.z) : { groomed: 1, piste: 1, moguls: 0 };
    const forward = this.camera.getWorldDirection(this.tmpV2);
    const neighbors = this.ambient?.soundSources() ?? [];
    for (const r of this.net?.remotes.values() ?? []) {
      if (!r.last) continue;
      const pos = r.model.root.position, state = r.last;
      neighbors.push({ pos, speed: Math.hypot(state.vx, state.vy, state.vz), skid: state.plow,
        groomed: this.surface?.at(pos.x, pos.z).groomed ?? 1,
        active: !r.ride && state.mode !== 'air' && state.mode !== 'riding' });
    }
    this.audio.update(dt, this.audioScene.sample(dt, st, flight ? null : this.player.ride,
      this.lifts.paths, surface, forward, this.env.snowing, neighbors));
    this.drone.audio.update(this.audio.ctx,flight,this.audio.volume,this.audio.enabled,this.drone.fpv);
  }

  private modeLabel() {
    const st = this.player.st;
    if (this.player.ride) return `Riding ${this.lifts.paths[this.player.ride.lift].def.name}`;
    return { skiing: '', standing: '', air: 'Airborne', fallen: 'Fallen: press R', gettingUp: 'Getting up', riding: '' }[st.mode] ?? '';
  }

  private updateHints() {
    if (this.drone.active) { this.hud.hint(null); return; }
    const pl = this.player;
    if (pl.ride) {
      const path = this.lifts.paths[pl.ride.lift];
      const remain = path.remainingRideTime(pl.ride.chair, this.lifts.now());
      this.hud.hint(`${path.def.name} lift: ${Math.floor(remain / 60)}:${String(Math.floor(remain % 60)).padStart(2, '0')} to the top. Press <b>F</b> to skip.`);
    } else if (pl.inLoadZone >= 0) {
      const path = this.lifts.paths[pl.inLoadZone], t = this.lifts.now();
      const wait = Math.ceil(path.nextChairAt(path.loadU, t).arrive - t);
      this.hud.hint(`${path.def.name}: face uphill and wait at the red line. Next chair in ${wait} s.`);
    } else if (pl.st.mode === 'fallen' && pl.st.speed < 1) {
      this.hud.hint('You fell. Press <b>R</b> to get up');
    } else this.hud.hint(null);
  }
}
