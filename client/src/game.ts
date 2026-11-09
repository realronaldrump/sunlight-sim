import * as THREE from 'three/webgpu';
import { Heightfield } from './terrain/heightfield';
import { TerrainRenderer } from './terrain/terrainRenderer';
import { createTerrainMaterial, TerrainMaterialHandles } from './terrain/terrainMaterial';
import { Environment } from './sky/environment';
import { LiftSystem } from './lifts/liftSystem';
import { Player } from './skier/player';
import { loadHumanAsset, loadCrowdHumanAsset } from './skier/humanBody';
import { BaseLife } from './world/baseLife';
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
import { buildBuildings } from './world/buildings';
import { LODGE_SKI_START, lodgeSiteFootprints } from './world/mainLodge';
import { walkable } from './world/walkable';
import { GAUGE, UNLOAD_SLOWDOWN } from '../../shared/lifts';
import { OnFoot } from './skier/onFoot';
import { mergeStatic } from './world/mergeStatic';
import { AmbientSkiers } from './world/ambient';
import { Snowfall } from './sky/snowfall';
import { SkiTracks } from './skier/tracks';
import { SnowState } from './terrain/snowState';
import { SnowMemory } from './terrain/snowMemory';
import { Snowcats } from './world/snowcats';
import { Patrol, PATROL_CALL } from './world/patrol';
import { Weather, savedWeather, saveWeather, type WeatherMode } from './sky/weather';
import { crowdLevel, liftsOpen, resortDayHour, savedClockMode, saveClockMode, HOURS, type ClockMode } from './world/resortDay';
import { OptionsPanel } from './ui/options';
import { ColliderGrid } from '../../shared/collision';
import { SurfaceMap } from '../../shared/surface';
import type { TerrainProbe, Vec3 } from '../../shared/skiPhysics';
import type { LiftDef } from '../../shared/lifts';
import { mogulOffset } from '../../shared/moguls';
import { FlightArea } from '../../shared/dronePhysics';
import { DroneSystem } from './drone/droneSystem';
import { TouchControls } from './drone/touchControls';
import { IPHONE } from './platform';
import { fitPlayerLabel } from './net/playerLabels';
import { formatDistance } from './ui/units';
import { LIFT_SPEEDS, isLiftSpeed, type LiftSpeed } from '../../shared/liftClock';
import { LiftRideControls } from './ui/liftRideControls';
import { PlayerMarker } from './drone/playerMarker';
import { LessonGroup, INSTRUCTOR_NAME, LESSON_NAME } from './world/lesson';
import { LessonHud } from './ui/lessonHud';
import { MissedUnloadGates } from './lifts/missedUnloadGate';
import { ComicPops } from './ui/comicPops';
import { YardSale } from './world/yardSale';
import { flingVelocity } from '../../shared/missedUnload';
import { resortClock } from './world/resortClock';
import { MountainGuestView } from './world/mountainGuestView';
import { SANTA_ACHIEVEMENT } from './world/santaDiscovery';
import { ConditionsBoard } from './world/conditionsBoard';
import { conditionsFor } from './world/conditions';
import { LINEUP } from './world/lesson';
import { SkiLog, type Descent } from './log/skiLog';
import { SkiLogPanel } from './ui/skiLogPanel';
import { formatDistance as fmtDist, formatFeet } from './ui/units';
import { skiWithBindings, skiPole } from './skier/skiEquipment';
import type { Poi } from './world/walkable';
import type { RemoteSkier } from './net/netClient';
import { collideCylinder } from '../../shared/skiPhysics';

export const WORLD_BASE = (import.meta.env.BASE_URL || '/') + 'world';

export interface RunInfo { id: number; name: string; difficulty: string; grooming: string; kind: string; points: number[][]; outline?: number[][][] }
export interface ResortData { lifts: LiftDef[]; runs: RunInfo[]; buildings: any[]; roads: any[]; peaks: any[]; boundary?: number[][]; map?: { x0: number; x1: number; z0: number; z1: number } }


const AUTO_UNLOAD_KEY = 'sunlight.autoUnload';
function savedAutoUnload() { try { return localStorage.getItem(AUTO_UNLOAD_KEY) === '1'; } catch { return false; } }
function saveAutoUnload(on: boolean) { try { localStorage.setItem(AUTO_UNLOAD_KEY, on ? '1' : '0'); } catch { /* private mode */ } }

export class Game {
  readonly droneOnly = IPHONE;
  touch: TouchControls | null = null;
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
  private shareInvite?: () => Promise<void>;
  chat!: ChatUI;
  quality!: QualityPreset;
  audio = new SkiAudio();
  snowfall = new Snowfall();
  // your own tracks last about an hour of skiing; everyone else's are lighter and longer chords
  tracks = new SkiTracks((x, z) => this.probe.height(x, z), { max: 8000, life: 3600 });
  crowdTracks = new SkiTracks((x, z) => this.probe.height(x, z), { max: 6000, life: 2400, spray: false });
  snowState: SnowState | null = null;
  snowMemory: SnowMemory | null = null;
  snowcats: Snowcats | null = null;
  patrol: Patrol | null = null;
  weather = new Weather();
  /** Changing (squalls on the shared clock), clear, or steady light snow. */
  weatherMode: WeatherMode = 'changing';
  /** 0..1 how hard it is snowing where you are. */
  snowAmount = 0;
  /** Test and review hook: pin the cloud clock (seconds) or the amount of cumulus and cirrus (0..1). */
  skyOverride: { now?: number; cover?: number; cirrus?: number } | null = null;
  private weatherTimer = 0;
  /** Free Explore (you set the time, lifts always run) or Resort Day (shared clock, operating hours). */
  clockMode: ClockMode = savedClockMode();
  private dayTimer = 0;
  private snowNote: string | null = null;
  /** Hours of a normal day's traffic since the runs were groomed (lifts open at 9). */
  get skiedHours() { return this.snowHoursOverride ?? Math.max(0, Math.min(7, (this.env?.hour ?? 11) - 9)); }
  /** Test hook: hours of traffic regardless of the time of day. */
  snowHoursOverride: number | null = null;
  ambient: AmbientSkiers | null = null;
  mountainGuest!: MountainGuestView;
  private trackFade = 0;
  options!: OptionsPanel;
  private audioScene = new AudioScene();
  input = new InputManager();
  camRig!: CameraRig;
  hud!: Hud;
  drone!: DroneSystem;
  liftControls!: LiftRideControls;
  playerMarker!: PlayerMarker;
  private fastLift: number | null = null;
  onFoot!: OnFoot;
  baseLife: BaseLife | null = null;
  lesson: LessonGroup | null = null;
  private lessonHud: LessonHud | null = null;
  /** Pause-menu option: let the chair set you down at the top. Off (default): stand up on the ramp with Space. */
  autoUnloadSetting = false;
  private gates: MissedUnloadGates | null = null;
  private pops = new ComicPops();
  private yardSale = new YardSale();
  private flingDir = { x: 0, z: 1 };
  private yardFrom: { x: number; z: number } | null = null;
  private operatorLines = 0;
  /** Following the Snowriders' Club lesson to learn the route. */
  tagging = false;
  private lessonNear = Infinity;
  board: ConditionsBoard | null = null;
  /** Your skis standing in a lodge rack while you are inside, if you left them there. */
  private rackedSkis: THREE.Group | null = null;
  private rackedAt: Poi | null = null;
  /** The current wave or point: remaining seconds and its pose. */
  private gestureState: { kind: 'wave' | 'point'; t: number; yaw: number } | null = null;
  skiLog: SkiLog | null = null;
  skiLogPanel: SkiLogPanel | null = null;
  private boardTimer = 0;
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
  private tmpV3 = new THREE.Vector3();
  probe!: TerrainProbe;
  onFrame: ((dt: number) => void)[] = [];
  ready = false;

  constructor(private container: HTMLElement) {
    document.body.classList.toggle('iphone', this.droneOnly);
    if (this.droneOnly && window.visualViewport) {
      const resize = () => document.body.style.setProperty('--visual-height', `${window.visualViewport!.height}px`);
      window.visualViewport.addEventListener('resize',resize); resize();
    }
  }

  setLoading(frac: number, text: string) {
    const b = document.getElementById('load-bar');
    const t = document.getElementById('load-text');
    if (b) b.style.width = `${Math.round(frac * 100)}%`;
    if (t) t.textContent = text;
  }

  async start() {
    this.setLoading(0.05, 'Starting renderer');
    const graphics = await detectGraphics(this.params.get('webgl') === '1');
    this.quality = this.droneOnly ? { ...PRESETS.low, pixelRatio: 1.25, targetMP: .7, treeNear: 75, antialias: true } : PRESETS[graphics.quality];
    const Q = this.quality;
    this.renderer = await initializeRenderer(Q.antialias, graphics.forceWebGL);
    // Khronos PBR Neutral keeps the deep high-altitude sky blue and snow white without ACES hue shifts.
    this.renderer.toneMapping = THREE.NeutralToneMapping;
    this.renderer.toneMappingExposure = 0.74;
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
      surface: (x, z) => {
        const s = this.surface ? this.surface.at(x, z) : { groomed: 1, piste: 1, moguls: 0 };
        // what the snow remembers: traffic-polished main lines and new snow on top
        if (this.snowState) { s.worn = this.snowState.wornAt(x, z, this.skiedHours); s.fresh = this.snowState.freshCover; }
        return s;
      },
    };

    this.terrainMat = createTerrainMaterial();
    this.terrain = new TerrainRenderer(this.hf, this.terrainMat.material, this.resort.runs);
    this.terrain.splitFactor = Q.terrainSplit;
    this.scene.add(this.terrain.group);
    this.env = new Environment(this.scene, this.renderer, this.camera, { shadows: Q.shadows, shadowMapSize: Q.shadowMapSize, cascades: Q.cascades, shadowFar: Q.shadowFar });
    this.terrainMat.sunDir.value.copy(this.env.sunDir.value);
    // mountain shadows need the 128 m terrain around the resort; it arrives in the background
    void this.env.mountains.init(this.hf).catch((e) => console.warn('mountain shadows unavailable', e));
    { const c = this.params.get('clouds'); if (c !== null) this.skyOverride = { cover: Number(c) }; }

    // personal ski log, kept in this browser
    if (!this.droneOnly && this.params.get('log') !== '0') {
      this.skiLog = new SkiLog(this.resort.runs);
      this.skiLogPanel = new SkiLogPanel(this.skiLog, this.resort, WORLD_BASE);
      this.skiLog.onDescent = (d, completed) => this.announceDescent(d, completed);
      const flush = () => this.skiLog?.save();
      window.addEventListener('pagehide', flush);
      document.addEventListener('visibilitychange', () => { if (document.hidden) flush(); });
    }
    this.runs = new RunSystem(this.resort);
    await this.runs.load(WORLD_BASE).catch((e) => console.warn('runs raster failed', e));
    this.runLookup = (x, z) => this.runs.runAt(x, z);
    this.lifts = new LiftSystem(this.resort.lifts);
    this.scene.add(this.lifts.group);
    for (const c of this.lifts.colliders) this.colliders.add(c);

    const spawn = LODGE_SKI_START;
    this.setLoading(0.25, 'Loading terrain near the base');
    await this.hf.ensureArea(0, spawn.x, -spawn.z, 300);
    await Promise.all(this.resort.lifts.flatMap((l) => [this.hf.ensureArea(0, l.bottom[0], -l.bottom[2], 40), this.hf.ensureArea(0, l.top[0], -l.top[2], 40)]));
    this.lifts.settle((x, z) => this.hf.heightAt(x, z));
    this.probe = this.lifts.buildStationSurfaces(this.probe);
    this.mountainGuest = new MountainGuestView(this.lifts, this.probe);
    this.scene.add(this.mountainGuest.group);
    this.dressStationSnow();
    this.gates = new MissedUnloadGates(this.lifts.paths, (x, z) => this.probe.height(x, z));
    this.scene.add(this.gates.group, this.yardSale.group);
    this.setLoading(0.35, 'Loading trees');
    this.trees = new TreeSystem(WORLD_BASE, this.colliders, Q.treeNear, Q.treeFar, [...this.resort.buildings, ...lodgeSiteFootprints()], Q.antialias);
    this.scene.add(this.trees.group);
    await this.trees.init(spawn).catch((e) => console.warn('trees failed', e));
    this.player = new Player(new THREE.Vector3(spawn.x, this.probe.height(spawn.x, spawn.z), spawn.z), spawn.heading, this.probe, this.colliders, this.lifts);
    this.scene.add(this.player.model.root);
    { const p = this.params.get('autounload'); this.autoUnloadSetting = p === '1' ? true : p === '0' ? false : savedAutoUnload(); }
    this.player.onMissed = (event, lift) => this.missedUnload(event, lift);
    this.player.seatOccupied = (lift, chair, seat) => {
      const ride = this.mountainGuest.ride;
      return ride?.lift === lift && ride.chair === chair && ride.seat === seat;
    };
    this.onFoot = new OnFoot(this.scene, (x, z) => walkable.snowHeight(x, z, this.probe.height(x, z)), this.colliders, this.camera, this.renderer.domElement, new THREE.Color('#d33a2c'));
    this.runs.buildSigns((x, z) => this.hf.heightAt(x, z), this.colliders);
    this.runs.buildBoundary((x, z) => this.hf.heightAt(x, z));
    this.scene.add(this.runs.group);
    this.trailMap = new TrailMap(this.resort, WORLD_BASE);
    this.trailMap.onTeleport = (name) => { if (this.options.visible && this.trailMap.travelEnabled) void this.pauseTravel(() => this.teleportToRun(name)); };
    this.trailMap.onJoinPlayer = (name) => { if (this.options.visible && this.trailMap.travelEnabled) void this.pauseTravel(() => this.joinFriend(name)); };
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
    mergeStatic(staticGroup);
    this.scene.add(staticGroup);
    this.terrainMat.setCutouts(walkable.cutouts);
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
    }, this.camera,this.renderer.domElement,this.scene,this.droneOnly);
    this.drone.hud.onToggle = () => this.toggleDrone();
    this.drone.hud.onCamera = () => this.drone.cycleCamera();
    this.playerMarker = new PlayerMarker();
    this.drone.hud.onMarker = () => { this.playerMarker.toggle(); this.drone.hud.marker(this.playerMarker.enabled); };
    this.drone.hud.marker(this.playerMarker.enabled);
    this.liftControls = new LiftRideControls(); this.liftControls.onSpeed = speed => this.setLiftSpeed(speed);
    this.liftControls.onStandUp = () => { if (this.input.enabled) this.standUp(); };
    const stopFast = () => this.stopLiftSpeed();
    window.addEventListener('blur', stopFast);
    document.addEventListener('visibilitychange', () => { if (document.hidden) stopFast(); });
    if (this.droneOnly) {
      this.drone.fpv = true;
      this.drone.enter(this.player.st.pos, this.player.st.heading);
      this.player.model.root.visible = false;
      this.camRig.enabled = false;
      this.drone.update(0, this.input.drone());
      this.touch = new TouchControls(this.renderer.domElement, {
        hold: () => this.holdDrone(),
        allowed: () => this.ready && !this.chat?.open && !this.options?.visible && !this.trailMap.visible && !this.launchingDrone && (!this.net || this.net.connected),
      });
    }

    this.flyMode = !this.droneOnly && this.params.get('fly') === '1';
    const cam = this.droneOnly ? null : this.params.get('cam');
    if (cam) {
      const [x, y, z] = cam.split(',').map(Number);
      this.camera.position.set(x, y, z);
      this.flyMode = true;
      await this.hf.ensureArea(0, x, -z, 300);
    } else if (!this.droneOnly) this.camera.position.copy(this.player.position).add(new THREE.Vector3(0, 3, 6));
    if (this.params.get('yaw')) this.fly.yaw = Number(this.params.get('yaw')) * Math.PI / 180;
    if (this.params.get('pitch')) this.fly.pitch = Number(this.params.get('pitch')) * Math.PI / 180;
    if (this.params.get('hour')) this.env.setHour(Number(this.params.get('hour')));
    this.scene.add(this.snowfall.mesh);
    this.scene.add(this.tracks.mesh);
    this.scene.add(this.crowdTracks.mesh);
    this.snowState = new SnowState(this.resort.runs, this.resort.lifts);
    this.terrainMat.setSnowState(this.snowState.texture, this.snowState.x0, this.snowState.n0, this.snowState.sizeX, this.snowState.sizeN);
    if (this.params.get('snowmemory') !== '0') {
      this.snowMemory = new SnowMemory(this.snowState, this.tracks, this.crowdTracks, this.surface);
      this.snowNote = this.snowMemory.load(resortClock.now());
      const flush = () => this.snowMemory?.save(resortClock.now());
      window.addEventListener('pagehide', flush);
      document.addEventListener('visibilitychange', () => { if (document.hidden) flush(); });
    }
    if (this.params.get('ambient') !== '0') {
      this.ambient = new AmbientSkiers(this.resort.runs, this.probe, { low: 4, medium: 8, high: 12, ultra: 16 }[this.quality.name] ?? 8, this.lifts);
      // people around the base area, lodge and lift lines
      await loadCrowdHumanAsset((import.meta.env.BASE_URL || '/').replace(/\/$/, '')).catch((e) => console.warn('crowd mesh unavailable; using the full human', e));
      const q = this.quality.name;
      const budget = q === 'low' ? { seated: 8, walkers: 5, groups: 2, queueRows: 2 } : q === 'medium' ? { seated: 16, walkers: 9, groups: 3, queueRows: 3 } : { seated: 26, walkers: 14, groups: 4, queueRows: 4 };
      this.baseLife = new BaseLife(this.lifts, (x, z) => walkable.snowHeight(x, z, this.probe.height(x, z)), this.colliders, budget);
      this.scene.add(this.baseLife.group);
      this.scene.add(this.ambient.group);
      // skiers finishing a run at the base ski over and line up again as the same people
      this.ambient.onFinish = (guest, st) => this.baseLife?.arrive(guest, st.pos.x, st.pos.z) ?? false;
    }
    if (this.params.get('lesson') === '1' || (this.params.get('lesson') !== '0' && this.params.get('ambient') !== '0')) {
      // the Snowriders' Club: one recognizable lesson group on the shared resort clock
      this.lesson = new LessonGroup(this.lifts, this.probe, this.resort.runs, this.colliders);
      this.lesson.router = (a, b) => this.baseLife?.route(a, b) ?? null;
      this.scene.add(this.lesson.group);
      this.lessonHud = new LessonHud();
    }
    // groomers work the runs after last chair, restoring corduroy behind the tiller
    this.snowcats = new Snowcats(this.resort.runs, this.probe);
    this.snowcats.onGroom = (x, z, half) => {
      this.snowState?.groom(x, z, half);
      this.tracks.clearNear(x, z, half + 0.3); this.crowdTracks.clearNear(x, z, half + 0.3);
    };
    this.scene.add(this.snowcats.group);
    // ski patrol sweeps the mountain at closing and ropes off the runs
    this.patrol = new Patrol(this.resort.runs, this.probe, this.runs.runTops(), this.resort.lifts);
    this.scene.add(this.patrol.group);
    // mountain status board at the Lesson Line-Up Area, facing skiers leaving the lodge racks
    this.board = new ConditionsBoard(LINEUP.x - 6, LINEUP.z + 8, 0.67, (x, z) => this.probe.height(x, z), this.colliders);
    this.scene.add(this.board.group);
    // tests start clear unless they ask for weather; players get the changing sky they last chose
    const wq = this.params.get('weather');
    this.weatherMode = wq === 'changing' || wq === 'clear' || wq === 'snow' ? wq : this.params.get('autostart') === '1' ? 'clear' : savedWeather();
    this.scene.add(this.weather.group);
    if (this.params.get('snow') === '1') this.setSnow(true);
    this.options = new OptionsPanel({
      hour: this.env.hour, snow: this.env.snowing, volume: this.audio.volume,
      setHour: (h) => { if (this.clockMode === 'explore') this.env.setHour(h); }, setSnow: (on) => this.setSnow(on), setVolume: (v) => { this.audio.volume = v; },
      weather: this.droneOnly ? undefined : { mode: this.weatherMode, setMode: (m) => { this.weatherMode = m; saveWeather(m); this.weatherTimer = 0; this.hud.toast(m === 'changing' ? 'Changing weather: watch for squalls drifting in from the west' : m === 'snow' ? 'Light snow' : 'Clear skies'); } },
      clock: this.droneOnly ? undefined : { mode: this.clockMode, setMode: (m) => this.setClockMode(m) },
      autoUnload: this.droneOnly ? undefined : { on: this.autoUnloadSetting, set: (on) => {
        this.autoUnloadSetting = on; saveAutoUnload(on);
        this.hud.toast(on ? 'Auto disembark on: the chair sets you down at the top' : 'Manual disembark: press Space on the unload ramp to stand up', 4);
      } },
      resume: () => this.options.toggle(false),
      base: () => { if (this.options.visible) { this.respawn(); this.options.toggle(false); } },
      travel: () => { if (this.options.visible) this.trailMap.toggle(true, true); },
      recall: () => { if (this.options.visible) { this.recallDrone(); this.options.toggle(false); } },
      log: this.skiLogPanel ? () => { if (this.options.visible) this.skiLogPanel?.show('overview'); } : undefined,
      phone: this.droneOnly ? {
        map: () => { this.options.toggle(false); this.trailMap.toggle(true); },
        view: () => { this.drone.cycleCamera(); this.options.toggle(false); },
        chat: () => { if (this.net?.connected) { this.options.toggle(false); this.chat.openInput(); } },
        share: () => { void this.shareInvite?.(); },
      } : undefined,
    });
    this.options.santaSighting(this.mountainGuest.discovery.foundAt);
    this.options.onChange = () => {
      this.input.clear(); this.stopLiftSpeed();
      if (this.options.visible) { this.input.enabled = false; this.touch?.reset(); this.holdDrone(); }
    };
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
    // Compile carrier/character/terrain materials before play. A cold shader stall
    // must not consume the first approaching chair after the UI reports readiness.
    this.setLoading(.98, 'Preparing mountain graphics');
    // Async pipeline completion can stall across browser contexts on either
    // backend. A real warm frame compiles and uploads behind the loading overlay,
    // without making multiplayer startup depend on a never-settling driver promise.
    this.renderer.render(this.scene, this.camera);
    this.setLoading(1, 'Ready');
    document.getElementById('loading')?.classList.add('done');
    this.chat = new ChatUI();
    const startAudio = () => { if (this.params.get('mute') !== '1') this.audio.start(); };
    window.addEventListener('keydown', startAudio);
    window.addEventListener('pointerdown', startAudio);
    const firstFrame = new Promise<void>(resolve => {
      const once = () => { this.onFrame.splice(this.onFrame.indexOf(once), 1); resolve(); };
      this.onFrame.push(once);
    });
    this.renderer.setAnimationLoop(() => this.frame());
    await firstFrame;
    // start menu (skipped by ?autostart=1 for tests: name/color/room come from the URL)
    let choice: { name: string; color: string; room: string | null };
    if (this.params.get('autostart') === '1') {
      choice = { name: this.params.get('name') ?? 'Skier', color: '#' + (this.params.get('color') ?? 'd33a2c'), room: this.params.get('room') };
    } else {
      this.input.enabled = false;
      const r = await showMenu({ quality: this.quality.name, droneOnly: this.droneOnly });
      this.input.enabled = true;
      if (r.quality !== 'auto' && r.quality !== this.quality.name) { location.reload(); return; }
      choice = r;
    }
    this.playerName = choice.name; this.playerColor = choice.color;
    this.player.model.setJacket(choice.color);
    this.onFoot.setJacket(choice.color);
    if (!this.droneOnly && this.params.get('onfoot') === '1') this.startOnFoot();
    if (choice.room) await this.joinRoom(choice.room);
    if (!this.mountainGuest.remote && this.resort.boundary) {
      this.mountainGuest.startLocal(WORLD_BASE, { ...this.resort, boundary: this.resort.boundary });
    }
    this.ready = true;
    if (this.snowNote) { const note = this.snowNote; setTimeout(() => this.hud.toast(note, 7), 2500); }
  }

  /** Step out of the bindings (stopped, on snow, not on a lift) or click back in (on open snow). */
  toggleSkis() {
    if (this.droneOnly || this.drone.active) return;
    if (this.onFoot.active) {
      // at a lodge rack: leave your skis there, or pick them back up
      const rack = this.nearPoi('rack', 3.2);
      if (rack && this.onFoot.carrying && !this.onFoot.seat) { this.rackSkis(rack); return; }
      if (!this.onFoot.carrying) {
        if (this.rackedAt && Math.hypot(this.rackedAt.x - this.onFoot.st.pos.x, this.rackedAt.z - this.onFoot.st.pos.z) < 3.5) { this.unrackSkis(); return; }
        this.hud.toast('Your skis are in the rack by the deck. Walk back and press K to pick them up', 4); return;
      }
      if (!this.onFoot.canClickIn()) { this.hud.toast('Find open snow outside to click into your skis'); return; }
      const w = this.onFoot.st;
      this.onFoot.exit();
      this.player.teleport(w.pos.x, w.pos.z, w.heading);
      this.player.model.root.visible = true;
      this.camRig.enabled = true; this.camRig.reset();
      this.net?.markTeleport();
      this.hud.toast('Clicked in');
      return;
    }
    const st = this.player.st;
    if (this.player.ride || !st.grounded || st.speed > 1.0 || st.mode === 'air') { this.hud.toast('Stop first to step out of your skis'); return; }
    this.onFoot.enter(st.pos.x, st.pos.y, st.pos.z, st.heading);
    this.player.model.root.visible = false;
    this.camRig.enabled = false;
    this.hud.toast('Skis off. Shift to jog, K to click back in');
  }

  /** The nearest point of interest of a kind within `radius` of the walker. */
  private nearPoi(kind: Poi['kind'], radius: number) {
    const w = this.onFoot.st.pos;
    let best: Poi | null = null, bd = radius;
    for (const p of walkable.pois) {
      if (p.kind !== kind || Math.abs(p.y - w.y) > 1.6) continue;
      const d = Math.hypot(p.x - w.x, p.z - w.z);
      if (d < bd) { bd = d; best = p; }
    }
    return best;
  }

  private rackSkis(rack: Poi) {
    if (!this.rackedSkis) {
      const g = new THREE.Group(); g.name = 'your-racked-skis';
      for (let i = 0; i < 2; i++) { const s = skiWithBindings(); s.position.set(i * 0.09 - 0.045, 0.85, 0); s.rotation.set(Math.PI / 2 - 0.08, 0, 0); g.add(s); }
      for (let i = 0; i < 2; i++) { const p = skiPole(); p.position.set(0.18 + i * 0.05, 0.6, 0.06); p.rotation.set(-0.12, 0, 0.05); g.add(p); }
      g.traverse((o) => { o.castShadow = true; });
      this.scene.add(g);
      this.rackedSkis = g;
    }
    // at the rack's free end, leaning tails-down against the bar like everyone else's
    const off = 0.6;
    this.rackedSkis.position.set(rack.x + Math.sin(rack.heading) * 0.35 + Math.cos(rack.heading) * off, rack.y, rack.z + Math.cos(rack.heading) * 0.35 - Math.sin(rack.heading) * off);
    this.rackedSkis.rotation.set(0, rack.heading + Math.PI, 0);
    this.rackedSkis.visible = true;
    this.rackedAt = rack;
    this.onFoot.carrying = false;
    this.hud.toast('Skis racked. Head in for a coffee or sit on the deck; press K here to pick them up', 4.5);
  }

  private unrackSkis() {
    if (this.rackedSkis) this.rackedSkis.visible = false;
    this.rackedAt = null;
    this.onFoot.carrying = true;
    this.hud.toast('Skis on your shoulder. K on open snow to click in');
  }

  /** E: sit at a free table or bench nearby, or stand up. */
  private toggleSeat() {
    if (!this.onFoot.active) return;
    if (this.onFoot.seat) { this.onFoot.stand(); return; }
    const w = this.onFoot.st.pos;
    const taken = (p: Poi) => !!this.baseLife?.seatTaken(p.x, p.z) ||
      [...(this.net?.remotes.values() ?? [])].some((r) => r.last?.mode === 'sitting' && Math.hypot(r.model.root.position.x - p.x, r.model.root.position.z - p.z) < 0.35);
    let best: Poi | null = null, bd = 1.5;
    for (const p of walkable.pois) {
      if (p.kind !== 'seat' || Math.abs(p.y - w.y) > 1.2 || taken(p)) continue;
      const d = Math.hypot(p.x - w.x, p.z - w.z);
      if (d < bd) { bd = d; best = p; }
    }
    if (!best) { this.hud.toast('No free seat right here. Try another table'); return; }
    this.onFoot.sit(best);
  }

  /** 1 waves, 2 points downhill (or where you look on the flat). Friends see both. */
  private startGesture(kind: 'wave' | 'point') {
    if (this.player.ride || this.drone.active || this.player.tumble) return;
    const heading = this.onFoot.active ? (this.onFoot.seat?.poi.heading ?? this.onFoot.st.heading) : this.player.st.heading;
    const pos = this.onFoot.active ? this.onFoot.st.pos : this.player.st.pos;
    let yaw = 0;
    if (kind === 'point') {
      const n = this.hf.normalAt(pos.x, pos.z, 4), slope = Math.hypot(n.x, n.z);
      let world: number;
      if (slope > 0.07) world = Math.atan2(-n.x, -n.z);
      else { const d = this.camera.getWorldDirection(this.tmpV2); world = Math.atan2(-d.x, -d.z); }
      yaw = Math.atan2(Math.sin(world - heading), Math.cos(world - heading));
      const run = this.runDownHeading(pos.x, pos.z, world);
      this.hud.toast(run ? `You point down ${run}` : 'You point downhill');
    }
    this.gestureState = { kind, t: kind === 'wave' ? 2.6 : 3.2, yaw };
  }

  /** The first named run along a direction from a point (what a point downhill shows a friend). */
  private runDownHeading(x: number, z: number, heading: number) {
    const dx = -Math.sin(heading), dz = -Math.cos(heading);
    for (let d = 25; d <= 160; d += 15) { const r = this.runAt(x + dx * d, z + dz * d); if (r) return r.name; }
    return null;
  }

  private updateGesture(dt: number) {
    const g = this.gestureState;
    let pose: { kind: 'wave' | 'point'; amount: number; yaw?: number } | null = null;
    if (g) {
      g.t -= dt;
      const total = g.kind === 'wave' ? 2.6 : 3.2, elapsed = total - g.t;
      pose = { kind: g.kind, amount: Math.max(0, Math.min(1, elapsed / 0.3, g.t / 0.4)), yaw: g.yaw };
      if (g.t <= 0) { this.gestureState = null; pose = null; }
    }
    this.player.gesture = pose;
    this.onFoot.gesture = pose;
  }

  /** A friend waves or points: tell the player, naming the run they point down. */
  private friendGesture(r: RemoteSkier, act: 'wave' | 'point') {
    const p = r.model.root.position, me = this.player.st.pos;
    if (Math.hypot(p.x - me.x, p.z - me.z) > 450) return;
    if (act === 'wave') { this.hud.toast(`${r.name} waves`); return; }
    const run = this.runDownHeading(p.x, p.z, r.heading + (r.last?.actYaw ?? 0));
    this.hud.toast(run ? `${r.name} points down ${run}` : `${r.name} points downhill`, 3.5);
  }

  private leaveOnFoot() {
    if (!this.onFoot?.active) return;
    // teleporting away takes your skis with you
    if (this.rackedAt) { if (this.rackedSkis) this.rackedSkis.visible = false; this.rackedAt = null; this.onFoot.carrying = true; }
    this.onFoot.exit(); this.player.model.root.visible = true; this.camRig.enabled = true; this.camRig.reset();
  }

  /** Keep the (hidden) skier state on the walker so map, network and streaming follow them. */
  private parkSkierAtWalker() {
    const w = this.onFoot.st, p = this.player.st;
    p.pos.x = w.pos.x; p.pos.y = w.pos.y; p.pos.z = w.pos.z;
    p.vel.x = w.vel.x; p.vel.y = 0; p.vel.z = w.vel.z; p.speed = 0;
    p.heading = w.heading; p.mode = 'standing'; p.grounded = true;
    this.player.model.root.visible = false;
  }

  /** Test hook: registered points of interest (doors, seats, counters). */
  walkablePois() { return walkable.pois; }

  /** Station snow pads use the terrain's snow (scanned texture, crystal glints, corduroy along the lift line)
   * so maintained ramps blend into the surrounding snow instead of reading as flat white slabs. */
  private dressStationSnow() {
    const group = this.lifts.group.getObjectByName('station-snow');
    group?.traverse((o) => {
      const mesh = o as THREE.Mesh;
      if (!mesh.isMesh) return;
      const path = this.lifts.paths.find((p) => mesh.name.startsWith(`${p.def.name}-`));
      if (!path) return;
      const pos = mesh.geometry.getAttribute('position'), groom = new Float32Array(pos.count * 2);
      const b = path.def.bottom;
      for (let i = 0; i < pos.count; i++) {
        const dx = pos.getX(i) - b[0], dz = pos.getZ(i) - b[2];
        groom[i * 2] = dx * path.rx + dz * path.rz - GAUGE / 2;
        groom[i * 2 + 1] = dx * path.ax + dz * path.az;
      }
      mesh.geometry.setAttribute('grooming', new THREE.BufferAttribute(groom, 2));
      mesh.material = this.terrainMat.material;
      mesh.receiveShadow = true;
    });
  }

  /** Start of the day: on foot outside the lodge's rental-level door, facing the lifts. */
  startOnFoot() {
    if (this.droneOnly) return;
    const door = walkable.pois.find((p) => p.tag === 'lower-door');
    if (!door) return;
    const seg = this.lifts.paths.find((p) => p.def.name === 'Segundo') ?? this.lifts.paths[0];
    const lp = seg.loadPoint();
    const heading = Math.atan2(-(lp.x - door.x), -(lp.z - door.z));
    this.player.teleport(door.x, door.z, heading);
    this.onFoot.enter(door.x, door.y, door.z, heading);
    this.player.model.root.visible = false;
    this.camRig.enabled = false;
    this.hud.toast('Welcome to Sunlight. Walk to the lifts, then press K to click in');
  }

  respawn() {
    if (this.droneOnly) { this.recallDrone(); return; }
    if (this.drone?.active) this.toggleDrone();
    this.leaveOnFoot();
    const { x, z, heading } = LODGE_SKI_START;
    this.player.teleport(x, z, heading);
    this.camRig.reset();
    this.net?.markTeleport();
    this.hud.toast('Back at the lodge ski racks');
  }

  private async pauseTravel(action: () => Promise<void>) {
    this.stopLiftSpeed();
    try { await action(); this.options.toggle(false); }
    catch { this.hud.toast('Travel failed. Please try again.'); }
  }

  toggleLiftSpeed() {
    const ride = this.player.ride;
    if (!ride) return;
    const rate = this.lifts.clocks[ride.lift].rate;
    const index = isLiftSpeed(rate) ? LIFT_SPEEDS.indexOf(rate) : 0;
    this.setLiftSpeed(LIFT_SPEEDS[(index + 1) % LIFT_SPEEDS.length]);
  }

  setLiftSpeed(rate: LiftSpeed) {
    const ride = this.player.ride;
    if (!isLiftSpeed(rate) || !ride || !this.ready || this.options.visible || this.trailMap.visible || this.chat?.open) return;
    if (this.net && (!this.net.connected || !this.net.supportsLiftSpeed)) return;
    this.fastLift = rate > 1 ? ride.lift : null;
    if (this.net) this.net.setLiftSpeed(rate);
    else this.lifts.clocks[ride.lift].setRate(rate, ride.unloadAt - UNLOAD_SLOWDOWN - this.lifts.clockOffset);
  }

  private stopLiftSpeed() {
    if (this.fastLift === null) return;
    if (this.net?.connected) this.net.cancelLiftSpeed();
    else this.lifts.clocks[this.fastLift].setRate(1);
    this.fastLift = null;
  }

  async toggleDrone() {
    if (this.droneOnly) return;
    if (!this.ready || this.chat?.open || this.launchingDrone) return;
    if (!this.drone.active && this.player.tumble) return;
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
      this.leaveOnFoot();
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
    this.input.clear(); this.touch?.reset(); this.audioScene = new AudioScene();
    this.hud.toast(this.droneOnly ? 'Back at your launch point' : 'Drone recalled above your skier');
  }

  holdDrone() { this.drone.hold(); this.input.clear(); }

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
    if (this.onFoot?.active) return;
    const st = this.player.st;
    if (this.player.missed && this.player.ride) { this.missedCamera(dt); return; }
    if (this.missedCam) { this.missedCam = false; this.camRig.reset(); }
    this.tmpV.set(st.vel.x, st.vel.y, st.vel.z);
    this.camRig.update(dt, this.cameraTarget(), st.heading, this.tmpV, this.player.fallLine(this.tmpV2), !!this.player.ride,
      { pitch: this.player.ride ? this.player.rideSwing.pitch : this.player.tumble?.pitch ?? 0,
        roll: this.player.ride ? this.player.rideSwing.roll : this.player.tumble?.roll ?? 0,
        airborne: !!this.player.tumble, fallen: st.mode === 'fallen' && st.grounded, impact: st.lastImpact });
  }

  /** Space on the chair: stand up on the ramp, or a friendly nudge if the ramp is not here yet. */
  standUp() {
    const ride = this.player.ride;
    if (!ride) return;
    // Jumping off needs a server that accepts it; older servers keep the rider seated.
    const result = this.player.standUp(!this.net || this.net.supportsManualUnload);
    if (result === 'early') {
      const st = this.player.st, ft = Math.max(1, Math.round((st.pos.y - this.probe.height(st.pos.x, st.pos.z) + 0.9) * 3.28084));
      const s = Math.ceil(this.lifts.paths[ride.lift].readyIn(ride.chair, this.lifts.now(ride.lift)) / this.lifts.clocks[ride.lift].rate);
      this.hud.toast(`Too early! You are ${ft} ft up and the ramp is ${s < 90 ? `${s} s` : 'a long way'} off. Press Space again and you will jump.`, 4.5);
    } else if (result === 'jumped') {
      this.pops.pop('WHOOPS!', this.player.position, { life: 1.4, color: '#ffffff', follow: () => this.player.position });
      this.audio.effect('whoosh', 0.35);
    }
  }

  private cameraTarget() { return this.player.position; }

  /** While the chair whirls round the bull wheel, watch from the open side of the top station. */
  private missedCam = false;
  private missedCamera(dt: number) {
    const ride = this.player.ride!, path = this.lifts.paths[ride.lift];
    const grip = path.loopPoint(path.chairU(ride.chair, this.lifts.now(ride.lift))).p, top = path.def.top;
    const look = this.tmpV3.set(grip.x, grip.y - 2.0, grip.z);
    const want = this.tmpV2.set(top[0] - path.ax * 7 + path.rx * 10, top[1] + 1.5, top[2] - path.az * 7 + path.rz * 10);
    want.y = Math.max(want.y, this.probe.height(want.x, want.z) + 1.6);
    if (!this.missedCam) { this.missedCam = true; this.camera.position.lerp(want, 0.6); }
    else this.camera.position.lerp(want, Math.min(1, dt * 3));
    this.camera.lookAt(look);
  }

  private operator(text: string) {
    if (this.lessonHud) this.lessonHud.say(`operator/${++this.operatorLines}`, 'Lift operator', text);
    else this.hud.toast(`Lift operator: ${text}`, 3.5);
  }

  /** The comic missed-unload gag: BONK, a whirl around the bull wheel, a launch and a yard sale. */
  private missedUnload(event: 'gate' | 'loops' | 'flung' | 'landed', lift: number) {
    const path = this.lifts.paths[lift], me = () => this.player.position;
    if (event === 'gate') {
      this.stopLiftSpeed();
      this.gates?.trigger(lift);
      this.audio.effect('boing', 0.65);
      const at = this.gates?.position(lift); if (at) this.pops.pop('BONK!', at);
      setTimeout(() => this.audio.effect('whistle', 0.3, 0.4), 250);
      this.operator('Hey! HEY! The ramp was back there!');
    } else if (event === 'loops') {
      this.audio.effect('whoosh', 0.6);
      this.pops.pop('WHEEEE!', me(), { life: 2.4, follow: () => this.player.ride ? me() : null });
      this.operator('Oh no. Hold on, you are going around the bull wheel!');
    } else if (event === 'flung') {
      const v = this.player.st.vel; this.flingDir = Math.hypot(v.x, v.z) > 0.3 ? { x: v.x, z: v.z } : (() => { const f = flingVelocity(path); return { x: f.x, z: f.z }; })();
      if (this.player.gag === 'missed') this.pops.pop('WHOOOA!', me(), { life: 1.3, color: '#ffffff', follow: me });
    } else {
      const st = this.player.st;
      this.audio.effect('thud', 0.75);
      this.yardFrom = { x: st.pos.x, z: st.pos.z };
      this.pops.pop('YARD SALE!', me(), { life: 2.8 });
      if (this.player.gag === 'missed') {
        this.operator('Yard sale! You okay out there? Go grab your skis.');
        if (!this.autoUnloadSetting) setTimeout(() => this.hud.toast('Tip: press Space on the unload ramp to stand up. Auto disembark is in the pause menu.', 6), 2600);
      } else setTimeout(() => this.hud.toast('Ouch. Next time wait for the unload ramp at the top, then press Space.', 5), 2200);
    }
  }

  runAt(x: number, z: number): RunInfo | null {
    return this.runLookup ? this.runLookup(x, z) : null;
  }
  runLookup: ((x: number, z: number) => RunInfo | null) | null = null;

  private frame() {
    this.timer.update();
    this.lifts.beginFrame();
    const t0 = performance.now();
    const dt = Math.min(this.timer.getDelta(), 0.1);
    this.fps = this.fps * 0.95 + (dt > 0 ? 1 / dt : 60) * 0.05;
    const controlsEnabled = this.ready && !this.chat?.open && !this.trailMap?.visible && !this.options?.visible && !this.skiLogPanel?.visible && !this.launchingDrone && (!this.droneOnly || !this.net || this.net.connected);
    if (this.input.enabled && !controlsEnabled) { this.input.clear(); if (this.drone) this.holdDrone(); }
    this.input.enabled = controlsEnabled;
    this.touch?.update(controlsEnabled);
    const actions = this.input.actions();
    if (actions.drone && this.ready && !this.chat?.open && !this.trailMap.visible && !this.options.visible) this.toggleDrone();
    if (actions.chat && this.net?.connected) this.chat.openInput();
    if (!this.flyMode) {
      if (this.drone.active) {
        if (actions.camera && this.input.enabled) this.drone.cycleCamera();
        this.drone.controlsEnabled = this.input.enabled;
        let input = this.input.drone();
        if (this.touch) {
          const look = this.touch.consumeLook(dt);
          this.drone.look(look.x, look.y);
          const touchInput = this.touch.input(this.drone.state!.pitch);
          input.forward += touchInput.forward;
          input.up += touchInput.up;
        }
        this.drone.update(dt,input);
        if (!this.droneOnly) this.player.update(dt,{steer:0,tuck:false,plow:0,push:false,stop:true},true);
        else { this.player.model.root.visible = false; this.player.st.mode = 'standing'; this.player.st.speed = 0; this.player.st.vel = {x:0,y:0,z:0}; }
      } else if (this.onFoot.active) {
        if (actions.skis && this.input.enabled) this.toggleSkis();
        if (actions.sit && this.input.enabled) this.toggleSeat();
        if (actions.camera && this.input.enabled) { this.onFoot.firstPerson = !this.onFoot.firstPerson; this.hud.toast(this.onFoot.firstPerson ? 'Camera: first person' : 'Camera: behind'); }
        if (this.onFoot.active) { if (!this.options.visible) this.onFoot.update(dt, this.input.walk()); this.parkSkierAtWalker(); }
      } else {
      if (actions.skis && this.input.enabled) this.toggleSkis();
      const inp = this.input.ski(dt);
      if (actions.getUp && this.input.enabled) this.player.getUp();
      if (actions.standUp && this.input.enabled && this.player.ride) this.standUp();
      this.player.autoUnload = this.autoUnloadSetting || (!!this.net && !this.net.supportsManualUnload);
      if (actions.camera && this.input.enabled) this.hud.toast(`Camera: ${{ chase: 'chase', first: 'first person', side: 'side profile' }[this.camRig.cycle()]}`);
      this.player.update(dt, inp, !this.ready || this.options.visible || this.trailMap.visible);
      if (this.baseLife && !this.player.ride) this.baseLife.collidePlayer(this.player.st);
      }
      if (this.net) {
        if (!this.drone.active && this.net.collideLocal()) { this.player.st.mode = 'fallen'; this.player.st.modeTime = 0; }
        this.net.update(dt);
      }
    }
    if (actions.help) { if (this.drone.active) this.drone.hud.help(); else this.hud.toggleHelp(); }
    if (this.input.enabled && !this.droneOnly && (actions.wave || actions.point)) this.startGesture(actions.wave ? 'wave' : 'point');
    this.updateGesture(dt);
    if (actions.mute) { this.audio.enabled = !this.audio.enabled; this.hud.toast(this.audio.enabled ? 'Sound on' : 'Sound off'); }
    if (actions.map) this.trailMap.toggle();
    if (actions.minimap) this.minimap.toggle();
    if (actions.options) { if (this.trailMap.visible) this.trailMap.toggle(false); else this.options.toggle(); }
    if (actions.fastLift && this.input.enabled) this.toggleLiftSpeed();
    if (this.fastLift !== null && (!this.player.ride || this.player.ride.lift !== this.fastLift || this.options.visible || this.trailMap.visible || this.chat?.open || (this.net && !this.net.connected))) this.stopLiftSpeed();
    if (this.trailMap.visible) {
      const st2 = this.drone.state ? {pos:this.drone.state.pos,heading:this.drone.state.yaw} : this.player.st;
      this.trailMap.players = [{ name: this.drone.active ? 'Your drone' : this.playerName, color: this.playerColor, x: st2.pos.x, z: st2.pos.z, heading: st2.heading, self: true },
        ...this.remoteMapPlayers(), ...(this.drone.active && !this.droneOnly ? [{name:'Your skier',color:this.playerColor,x:this.player.st.pos.x,z:this.player.st.pos.z,heading:this.player.st.heading}] : [])];
      const L = this.lesson;
      this.trailMap.overlays = L?.ready ? [
        ...(this.tagging ? [{ color: 'rgba(255,122,26,.9)', width: 5, dash: [10, 7], lines: L.routeLines() }] : []),
        { color: '#ff7a1a', points: [{ x: L.poses[0].x, z: L.poses[0].z, label: `${LESSON_NAME} lesson` }] }] : [];
      if (Math.random() < 0.2) this.trailMap.draw();
    }
    if (actions.slope) {
      this.slopeOverlay = !this.slopeOverlay;
      this.terrainMat.slopeOverlay.value = this.slopeOverlay ? 1 : 0;
      this.hud.toast(this.slopeOverlay ? 'Slope overlay on: green < 15, blue 15-25, black 25-35, orange 35-45, red > 45 deg' : 'Slope overlay off', 4);
    }
    this.mountainGuest.tickLocal(dt, this.player.ride);
    const guestRide = this.mountainGuest.ride;
    this.lifts.update([
      ...(guestRide ? [guestRide] : []),
      ...(this.player.ride ? [this.player.ride] : []),
      ...[...(this.net?.remotes.values() ?? [])].flatMap(r => r.ride ? [r.ride] : []),
    ], this.camera.position);
    this.ambient?.update(dt, this.player.position, this.camera.position);
    this.baseLife?.update(dt, this.camera.position, this.onFoot.active ? -1 : this.player.inLoadZone);
    this.updateLesson(dt, actions.lesson && this.input.enabled);
    this.updateResortDay(dt);
    this.updateWeather(dt);
    this.updateBoard(dt);
    this.recordSkiing(dt);
    if (this.patrol) {
      this.patrol.update(dt, resortClock.now(), this.clockMode, this.env.hour, this.camera.position);
      const me = this.player.st.pos, pat = this.patrol.nearby(me.x, me.z);
      if (pat && !this.drone.active) this.lessonHud?.say(`patrol/${Math.floor(resortClock.now() / 90)}`, 'Ski patrol', PATROL_CALL);
    }
    if (this.snowcats) {
      this.snowcats.update(dt, resortClock.now(), this.env.hour, this.env.night.value, this.camera.position);
      // a groomer is a big, slow machine: skiing into one stops you
      if (!this.player.ride && !this.onFoot.active) for (const c of this.snowcats.cats) {
        if (c.active && Math.abs(c.x - this.player.st.pos.x) < 4 && Math.abs(c.z - this.player.st.pos.z) < 4) collideCylinder(this.player.st, c.x, c.z, 2.6);
      }
    }
    this.updateCamera(dt);
    this.mountainGuest.update(dt, this.camera, resortClock.now());
    if (this.mountainGuest.observe(dt, this.camera, this.input.enabled && !this.flyMode && !document.hidden, this.colliders)) {
      this.options.santaSighting(this.mountainGuest.discovery.foundAt);
      this.hud.toast(`Achievement unlocked · ${SANTA_ACHIEVEMENT}`, 7);
    }
    for (const remote of this.net?.remotes.values() ?? []) {
      fitPlayerLabel(remote.label, this.camera, this.renderer.domElement.clientHeight);
      if (remote.drone && remote.flight) remote.drone.root.visible = remote.flightPos.distanceToSquared(this.camera.position) > .64;
    }
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
    this.env.updateSky(dt, this.skyOverride?.now ?? resortClock.now(), this.weatherMode, this.camera.position);
    if (this.skyOverride?.cover !== undefined) this.env.clouds.cover.value = this.skyOverride.cover;
    if (this.skyOverride?.cirrus !== undefined) this.env.clouds.cirrus.value = this.skyOverride.cirrus;
    this.env.adapt(dt, this.camera, (x, z) => this.hf.normalAt(x, z, 2), !!walkable.surfaces.indoor(this.camera.position.x, this.camera.position.y, this.camera.position.z));
    this.renderer.toneMappingExposure = this.env.exposure;

    const st = this.player.st;
    const mapPos = this.drone.state?.pos ?? st.pos;
    const run = this.player.ride && !this.drone.active ? null : (this.runAt(mapPos.x, mapPos.z) as (RunInfo & { stats?: { avgDeg: number; maxDeg: number } }) | null);
    this.minimap.update(dt, {
      self: { name: this.drone.active ? 'Your drone' : this.playerName, color: this.playerColor, x: mapPos.x, z: mapPos.z, heading: this.drone.state?.yaw ?? st.heading, self: true },
      others: [...this.remoteMapPlayers(), ...(this.drone.active && !this.droneOnly ? [{name:'Your skier',color:this.playerColor,x:st.pos.x,z:st.pos.z,heading:st.heading}] : [])], run,
      lift: this.drone.active ? null : this.player.ride ? this.lifts.paths[this.player.ride.lift].def.name : null,
      active: !this.droneOnly && this.ready && !this.trailMap.visible, drone: this.drone.active,
    });
    this.hud.update(dt, this.onFoot.active ? this.onFoot.st.speed : st.speed, this.player.ride ? 0 : st.slopeDeg, st.pos.y, this.modeLabel(), run);
    this.drone.hud.update(dt,this.drone.state,this.drone.fpv,Math.hypot(mapPos.x-st.pos.x,mapPos.z-st.pos.z),
      this.drone.area.nearest(mapPos.x,mapPos.z).remaining,this.ready,this.trailMap.visible || this.options.visible,!this.input.enabled);
    const ride = this.player.ride, lift = ride ? this.lifts.paths[ride.lift] : null;
    const overlaysClear = this.ready && !this.options.visible && !this.trailMap.visible && !this.chat?.open;
    const phoneRoom = this.droneOnly && this.options.visible ? {
      label: this.net ? (this.net.connected ? `Room ${this.net.room} · ${this.net.remotes.size + 1} online` : 'Reconnecting to your room…') : 'Solo flight',
      connected: !!this.net?.connected,
      share: !!this.shareInvite,
    } : undefined;
    this.options.update(this.ready, this.drone.active, this.trailMap.visible || (this.droneOnly && !!this.chat?.open), phoneRoom);
    this.liftControls.update(lift?.def.name ?? null, ride ? ride.unloadAt - this.lifts.now(ride.lift) : 0,
      ride ? this.lifts.clocks[ride.lift].rate : 1, overlaysClear,
      !this.net || (this.net.connected && this.net.supportsLiftSpeed), !!this.net,
      { manual: !!ride && !this.player.autoUnload, phase: this.player.unloadPhase(),
        soon: ride ? this.lifts.paths[ride.lift].readyIn(ride.chair, this.lifts.now(ride.lift)) / this.lifts.clocks[ride.lift].rate : Infinity });
    this.playerMarker.update(this.camera, st.pos, this.drone.active && !this.droneOnly && overlaysClear, lift?.def.name);
    this.updateHints();
    this.gates?.update(dt);
    this.pops.update(dt, this.camera);
    if (this.yardSale.active && !this.player.yardSale) this.yardSale.clear();
    // once the slide stops, the gear lies strewn up the slope behind the skier
    if (this.yardFrom && (!this.player.yardSale || (this.player.st.grounded && this.player.st.speed < 0.7))) {
      if (this.player.yardSale) this.yardSale.strew(this.yardFrom, this.player.st.pos, this.flingDir, (x, z) => this.probe.height(x, z));
      this.yardFrom = null;
    }
    this.updateLiftArrow();
    this.updateAudio(dt);
    this.updateTracks(dt);
    this.renderer.render(this.scene, this.camera);
    this.lifts.endFrame();
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
    this.net?.disconnect();
    if (this.net) this.scene.remove(this.net.group);
    this.net = new NetClient(this.player, this.lifts, this.droneOnly);
    this.net.localDrone = () => {
      const s=this.drone.state;
      return s ? {x:s.pos.x,y:s.pos.y,z:s.pos.z,yaw:s.yaw,pitch:s.pitch,bank:s.bank,tilt:s.tilt,rpm:s.rpm} : null;
    };
    this.scene.add(this.net.group);
    this.net.onChat = (n, t) => this.chat.add(n, t);
    this.net.onGesture = (r, act) => this.friendGesture(r, act);
    this.net.onMountainGuest = (pose, at) => this.mountainGuest.receiveRemote(pose, at);
    this.net.localExtras = () => {
      const x: Record<string, unknown> = {};
      if (this.onFoot.active) {
        const s = this.onFoot.seat;
        x.mode = s ? 'sitting' : 'walking';
        x.foot = { carry: this.onFoot.carrying, seat: s?.seatH, table: s?.tableH };
        if (s) { x.heading = s.poi.heading; x.y = s.floor; }
      }
      const g = this.gestureState;
      if (g) { x.act = g.kind; x.actYaw = g.yaw; }
      return x;
    };
    this.net.onStatus = (t) => this.hud.toast(t, 3);
    this.chat.onSend = (t) => this.net?.chat(t);
    this.remoteMapPlayers = () => this.net?.mapPlayers() ?? [];
    const ok = await this.net.connect(NetClient.defaultUrl(), room, this.playerName, this.playerColor);
    this.shareInvite = showRoomBox(room);
    if (!ok) this.hud.toast('Connection interrupted. Reconnecting to your room.', 5);
    return ok;
  }

  setSnow(on: boolean) {
    this.weatherMode = on ? 'snow' : 'clear';
    this.snowAmount = on ? 1 : 0;
    this.snowfall.amount.value = 1;
    this.env.setSnowing(on);
    this.snowfall.mesh.visible = on;
  }

  playerName = 'You';
  playerColor = '#d33a2c';
  remoteMapPlayers: () => { name: string; color: string; x: number; z: number; heading: number }[] = () => [];

  /** Test hook: put a free camera at (x, y, z) looking along yaw/pitch (degrees). y < 0 = meters above ground. */
  async setView(x: number, y: number, z: number, yawDeg: number, pitchDeg: number) {
    if (this.droneOnly) return;
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
    this.leaveOnFoot();
    const r = this.net ? [...this.net.remotes.values()].find((x) => x.id === name || x.name === name) : null;
    if (!r) return;
    if (this.droneOnly) {
      const p = r.flight ? r.flightPos : r.model.root.position;
      await this.travelDrone(p.x + 3, p.z, r.flight ? r.flightYaw : r.heading, r.flight ? p.y : undefined);
      this.hud.toast(`Flying near ${r.name}`); return;
    }
    if (this.drone.active) this.toggleDrone();
    let x: number, z: number, heading: number;
    if (r.ride && !r.flight) {
      const up = this.lifts.paths[r.ride.lift].unloadPoint();
      x = up.x; z = up.z; heading = up.heading;
    } else {
      const p = r.flight ? r.flightPos : r.model.root.position;
      heading = r.flight ? r.flightYaw : r.heading;
      x = p.x + Math.cos(heading) * 2.5; z = p.z - Math.sin(heading) * 2.5; // 2.5 m to their right
    }
    await this.hf.ensureArea(0, x, -z, 200);
    this.player.teleport(x, z, heading);
    this.net?.markTeleport();
    this.hud.toast(r.ride && !r.flight ? `Waiting for ${r.name} at the top of the lift` : `Joined ${r.name}`);
  }

  async teleportToRun(name: string) {
    this.leaveOnFoot();
    const top = this.runs.runTops().get(name);
    if (!top) return;
    if (this.droneOnly) {
      await this.travelDrone(top.x, top.z, Math.atan2(-top.dx, -top.dz));
      this.hud.toast(`Flying above ${name}`); return;
    }
    if (this.drone.active) this.toggleDrone();
    // start a few meters down the run, facing down it
    const x = top.x + top.dx * 4, z = top.z + top.dz * 4;
    await this.hf.ensureArea(0, x, -z, 200);
    this.player.teleport(x, z, Math.atan2(-top.dx, -top.dz));
    this.net?.markTeleport();
    this.hud.toast(`Top of ${name}`);
  }

  /** Phone map travel moves the aircraft and its launch anchor without ever enabling a skier. */
  private async travelDrone(x: number, z: number, heading: number, altitude?: number) {
    if (this.launchingDrone) return;
    this.launchingDrone = true; this.touch?.reset(); this.holdDrone();
    const destination = {x, y:0, z}; this.drone.area.constrain(destination);
    try {
      await this.hf.ensureArea(0, destination.x, -destination.z, 200);
      const level = this.hf.bestLevel(destination.x, -destination.z);
      if (level < 0 || level > 1) { this.hud.toast('Terrain is still loading. Try that location again.'); return; }
      this.player.teleport(destination.x, destination.z, heading);
      this.player.model.root.visible = false;
      this.drone.recall({...this.player.st.pos, y: altitude === undefined ? this.player.st.pos.y : altitude - this.drone.launchHeight}, heading);
      this.net?.markTeleport(); this.audioScene = new AudioScene();
    } finally { this.launchingDrone = false; }
  }

  /** Squalls drift through on the shared clock; under one the light flattens and it snows. */
  private updateWeather(dt: number) {
    if ((this.weatherTimer -= dt) > 0) return;
    this.weatherTimer = 0.2;
    const changing = this.weatherMode === 'changing';
    this.weather.group.visible = changing;
    const light = Math.max(0.12, 1 - 0.88 * this.env.night.value);
    const here = changing ? this.weather.update(resortClock.now(), this.camera.position, light, (x, z) => this.hf.heightAt(x, z)) : 0;
    const amount = this.weatherMode === 'snow' ? 1 : changing ? here : 0;
    // ease in and out as a cell's edge arrives
    this.snowAmount += (amount - this.snowAmount) * Math.min(1, 0.2 * 1.5);
    if (Math.abs(this.snowAmount - amount) < 0.01) this.snowAmount = amount;
    this.env.setWeather(this.snowAmount);
    this.snowfall.mesh.visible = this.snowAmount > 0.06;
    this.snowfall.amount.value = Math.min(1, this.snowAmount * 1.3);
  }

  /** Test hook: the shared resort clock. */
  get resortClock() { return resortClock; }

  setClockMode(mode: ClockMode) {
    this.clockMode = mode; saveClockMode(mode); this.dayTimer = 0;
    this.hud.toast(mode === 'day' ? 'Resort day: the clock runs (an hour every six minutes) and the lifts open 9 AM to 4 PM' : 'Free explore: set any time, the lifts run at every hour', 4);
  }

  /** Resort Day runs the shared clock; either way the hour decides lifts, crowds, the lesson and the patrol. */
  private updateResortDay(dt: number) {
    if ((this.dayTimer -= dt) > 0) return;
    this.dayTimer = 0.5;
    const day = this.clockMode === 'day';
    if (day) {
      const h = resortDayHour(resortClock.now());
      if (Math.abs(h - this.env.hour) > 0.05) this.env.setHour(h);
    }
    const hour = this.env.hour, open = liftsOpen(this.clockMode, hour), level = crowdLevel(this.clockMode, hour);
    this.lifts.closed = !open;
    this.baseLife?.setOperating(open, level);
    if (this.ambient) this.ambient.level = level;
    if (this.lesson) {
      this.lesson.out = !day || (hour >= HOURS.open + 0.25 && hour < HOURS.lastChair - 0.25);
      if (!this.lesson.out && this.tagging) { this.tagging = false; this.hud.toast('The Snowriders\' Club is done for the day'); }
    }
    this.options?.showClock(this.env.hour, day);
  }

  /** Feed the ski log with real (unscaled) frame time. */
  private recordSkiing(dt: number) {
    const log = this.skiLog;
    if (!log || !this.ready || this.flyMode) return;
    const st = this.player.st;
    const onSkis = !this.onFoot.active && !this.drone.active && !this.player.ride;
    log.update(dt, { x: st.pos.x, y: st.pos.y, z: st.pos.z, speed: onSkis ? st.speed : 0,
      skiing: onSkis, riding: !!this.player.ride && !this.drone.active, fallen: st.mode === 'fallen' || !!this.player.tumble,
      run: onSkis ? this.runAt(st.pos.x, st.pos.z)?.name ?? null : null });
  }

  private announceDescent(d: Descent, completed: string[]) {
    if (!this.skiLog) return;
    const cov = this.skiLog.coverage(), done = cov.filter((c) => c.status === 'completed').length;
    const first = completed.filter((n) => cov.find((c) => c.trail.name === n)?.laps === 1);
    const main = d.runs.find((r) => r.done) ?? d.runs[0];
    const name = main ? this.skiLog.trailByKey(main.key)?.name : null;
    const what = `${name ? `${name}: ` : ''}${fmtDist(d.dist)}, ${formatFeet(d.vert)} vertical`;
    this.hud.toast(first.length ? `First lap of ${first.join(' and ')}! ${done} of ${cov.length} trails skied. (${what})` : `Descent logged. ${what}`, first.length ? 6 : 3.5);
  }

  private updateBoard(dt: number) {
    if (!this.board || (this.boardTimer -= dt) > 0) return;
    this.boardTimer = 1;
    const now = resortClock.now();
    let lesson = 'Snowriders\' Club (ages 7 to 12) meets here at 9:30 AM and 12:30 PM';
    if (this.lesson?.ready && this.lesson.out) {
      const T = this.lesson.timeline!, { tau, lunchT } = this.lesson.clock(now), left = T.period - tau;
      const mmss = (s: number) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`;
      lesson = lunchT !== null ? `${LESSON_NAME} is at lunch inside, on the lower level. Back out in about ${Math.max(1, Math.ceil((7 * 60 - lunchT) / 60))} min`
        : tau < T.lineup ? `${LESSON_NAME} lining up now with ${INSTRUCTOR_NAME}. Leaves for Segundo in ${mmss(T.lineup - tau)}`
        : tau < T.lineup + T.toLift + T.lift ? `${LESSON_NAME} is riding Segundo. Back here in about ${Math.ceil(left / 60)} min`
        : `${LESSON_NAME} is skiing Ute. Back here in about ${Math.ceil(left / 60)} min`;
    }
    const showersNearby = this.weatherMode === 'changing' && this.weather.squalls.some((s) => s.strength > 0.3 && Math.hypot(s.x - this.camera.position.x, s.z - this.camera.position.z) < 14000);
    this.board.update(conditionsFor({ now, hour: this.env.hour, snowing: this.snowAmount > 0.15, runs: this.resort.runs, liftNames: ['Primo', 'Segundo', 'Tercero'], lesson, resortDay: this.clockMode === 'day', showersNearby }));
  }

  /** The lesson group: move them on the shared clock, tag along with L, captions and the panel. */
  private updateLesson(dt: number, toggle: boolean) {
    const L = this.lesson, hud = this.lessonHud;
    if (!L?.ready || !hud) return;
    const now = resortClock.now();
    L.update(dt, now, this.camera.position);
    const st = L.status(now);
    const me = this.onFoot.active ? this.onFoot.st.pos : this.player.st.pos;
    let near = Infinity;
    for (const p of L.positions()) near = Math.min(near, Math.hypot(p.x - me.x, p.z - me.z));
    this.lessonNear = this.drone.active ? Infinity : near;
    const toInstructor = Math.hypot(st.instructor.x - me.x, st.instructor.z - me.z);
    if (toggle && !this.drone.active) {
      if (this.tagging) { this.tagging = false; this.hud.toast(`You left the ${LESSON_NAME} lesson`); }
      else if (near < 45) { this.tagging = true; this.hud.toast(`Tagging along with ${INSTRUCTOR_NAME}'s ${LESSON_NAME} lesson`, 3.5); }
      else this.hud.toast(`${LESSON_NAME}: ${st.label}. Find them to tag along.`, 4);
    }
    // Solo, the group waits at its stops for a tag-along who fell behind. In a room the shared schedule keeps going.
    const waiting = this.tagging && !this.net && L.waitFor(now, dt, toInstructor > 35);
    // captions are speech: only heard standing near the group, never from the drone
    if (!this.drone.active && near < 30) hud.say(st.sayKey, INSTRUCTOR_NAME, st.say);
    else if (this.drone.active) hud.hush();
    hud.update(dt, { tagging: this.tagging, title: `${LESSON_NAME} with ${INSTRUCTOR_NAME}`, now: st.label, next: st.next, distance: toInstructor, waiting });
    const head = L.members[0].model.root.position;
    hud.placeTag(this.camera, (this.tagging || near < 25) && !this.options?.visible && !this.trailMap?.visible ? this.tmpV.set(head.x, head.y + 2.15, head.z) : null, `${INSTRUCTOR_NAME} · ${LESSON_NAME}`);
    // skiing into the kids gives them a nudge, not a pass-through
    if (!this.player.ride && !this.onFoot.active) for (const m of L.members) {
      const p = m.model.root.position;
      if (Math.abs(p.x - this.player.st.pos.x) < 1.2 && Math.abs(p.z - this.player.st.pos.z) < 1.2 && Math.abs(p.y - this.player.st.pos.y) < 1.5) collideCylinder(this.player.st, p.x, p.z, 0.3 * m.scale);
    }
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
      // chords lengthen with speed (about a meter at 25 mph) so the buffer holds several laps
      this.tracks.add(l, rr, d, 0.1 + 0.25 * st.skid, 0.6 + 0.6 * (1 - surf.groomed) + 0.4 * st.skid, 0, Math.max(0.3, st.speed * 0.09));
    }
    if (!this.drone.active && !this.player.ride && st.grounded && st.speed > 0.5 && !this.onFoot.active) this.snowState?.deposit(st.pos.x, st.pos.z, 0.01 * st.speed * dt);
    this.updateCrowdTracks(dt);
    this.trackFade += dt;
    this.tracks.update(dt);
    if (this.trackFade > 10) { this.tracks.fade(this.trackFade); this.crowdTracks.fade(this.trackFade); this.trackFade = 0; }
    if (this.snowState) {
      this.snowMemory?.update(dt, this.snowAmount, resortClock.now());
      if (!this.snowMemory) this.snowState.update(dt);
      this.terrainMat.skiedHours.value = this.skiedHours;
      this.terrainMat.freshCover.value = this.snowState.freshCover;
    }
  }

  /** Everyone else on the snow leaves tracks near you and wears the snow wherever they ski. */
  private updateCrowdTracks(dt: number) {
    const cam = this.camera.position, T = this.crowdTracks;
    const d = new THREE.Vector3(), r = new THREE.Vector3(), l = new THREE.Vector3(), rr = new THREE.Vector3();
    const write = (id: number, x: number, z: number, heading: number, speed: number, plow: number, skid: number, onSnow: boolean) => {
      if (onSnow && speed > 0.5) this.snowState?.deposit(x, z, 0.01 * speed * dt);
      if (!onSnow || speed < 1.2 || Math.hypot(x - cam.x, z - cam.z) > 220) { T.break(id); return; }
      d.set(-Math.sin(heading), 0, -Math.cos(heading)); r.set(-d.z, 0, d.x);
      const w = 0.14 + 0.2 * plow;
      l.set(x - r.x * w, 0, z - r.z * w); rr.set(x + r.x * w, 0, z + r.z * w);
      l.y = this.probe.height(l.x, l.z); rr.y = this.probe.height(rr.x, rr.z);
      const groomed = this.surface ? this.surface.at(x, z).groomed : 1;
      T.add(l, rr, d, 0.1 + 0.25 * skid, 0.45 + 0.5 * (1 - groomed) + 0.3 * skid, id, Math.max(0.6, speed * 0.12));
    };
    for (const a of this.ambient?.skiers() ?? []) {
      const st = a.st;
      write(a.id, st.pos.x, st.pos.z, st.heading, st.speed, st.plow, st.skid, st.grounded && st.mode !== 'fallen' && st.mode !== 'air');
    }
    const guest = this.mountainGuest.pose;
    if (guest) write(900000, guest.x, guest.z, guest.heading, guest.speed, guest.plow, guest.skid,
      !guest.ride && !guest.airborne && guest.fallen < .1 && guest.touring < .25);
    const L = this.lesson;
    if (L?.ready && L.out) L.poses.forEach((p, i) => write(900001 + i, p.x, p.z, p.heading, p.speed, p.plow, 0.15, !p.ride && p.sit === 0 && !p.skate && !p.foot));
    for (const rem of this.net?.remotes.values() ?? []) {
      const s = rem.last, pos = rem.model.root.position;
      let id = 1_000_000; for (const ch of rem.id) id = (id * 31 + ch.charCodeAt(0)) % 2_000_000_000;
      const speed = s ? Math.hypot(s.vx, s.vz) : 0;
      write(id, pos.x, pos.z, rem.heading, speed, s?.plow ?? 0, 0, !!s && !rem.ride && !rem.flight && !s.tumble && s.mode !== 'air' && s.mode !== 'riding' && !s.fallen);
    }
    T.update(dt);
  }

  /** Where the listener is, for the sound of the place: smoothed through doorways and between groves. */
  private soundPlace = { indoor: 0, shelter: 0, exposure: 0, chatter: 0, timer: 0, target: { shelter: 0, exposure: 0, chatter: 0 }, stride: 0 };
  private placeSound(dt: number) {
    const P = this.soundPlace, walking = this.onFoot.active;
    const pos = walking ? this.onFoot.st.pos : this.drone.state ? this.camera.position : this.player.st.pos;
    P.indoor += ((walking && this.onFoot.st.indoor ? 1 : 0) - P.indoor) * Math.min(1, dt * 2.2);
    if ((P.timer -= dt) <= 0 && this.surface) {
      P.timer = 0.3;
      const s = this.surface;
      // tree cover around you, nearest trees counting most
      let cover = s.canopy(pos.x, pos.z) * 2, w = 2;
      for (const [r, k] of [[10, 1], [22, .6]] as const) for (let i = 0; i < 8; i++) {
        const a = i * Math.PI / 4; cover += s.canopy(pos.x + Math.cos(a) * r, pos.z + Math.sin(a) * r) * k; w += k;
      }
      const shelter = Math.min(1, (cover / w) * 1.6);
      // open high ground standing above its surroundings: ridges, the summit, a chair high over the snow
      const h0 = this.hf.heightAt(pos.x, pos.z);
      let ring = 0;
      for (let i = 0; i < 8; i++) { const a = i * Math.PI / 4; ring += this.hf.heightAt(pos.x + Math.cos(a) * 70, pos.z + Math.sin(a) * 70); }
      const prominence = h0 - ring / 8, high = Math.max(0, Math.min(1, (h0 - 2550) / 450));
      const aloft = this.player.ride && !this.drone.active ? Math.min(1, (this.player.st.pos.y - h0) / 12) * 0.4 : 0;
      const exposure = Math.min(1, Math.max(0, prominence / 14) * (0.4 + 0.6 * high) + aloft) * (1 - shelter);
      // people talking nearby, and the kids of the lesson group
      let talkers = this.baseLife?.talkersNear(pos.x, pos.y, pos.z, 16) ?? 0;
      if (this.lesson?.out) for (const p of this.lesson.positions()) if (p.distanceTo(new THREE.Vector3(pos.x, pos.y, pos.z)) < 14) talkers += 0.6;
      P.target = { shelter, exposure, chatter: Math.min(1, talkers / 6) };
    }
    for (const k of ['shelter', 'exposure', 'chatter'] as const) P[k] += (P.target[k] - P[k]) * Math.min(1, dt * 0.9);
    // boots on the lodge floor, the deck or the snow
    let step: 'wood' | 'snow' | undefined;
    if (walking && !this.onFoot.seat) {
      const stride = this.onFoot.st.stride;
      if (Math.floor(stride) !== Math.floor(P.stride) && this.onFoot.st.speed > 0.2) step = this.onFoot.st.onSnow ? 'snow' : 'wood';
      P.stride = stride;
    }
    return { env: { indoor: P.indoor, shelter: P.shelter, exposure: P.exposure, chatter: P.chatter }, step };
  }

  private updateAudio(dt: number) {
    const flight = this.drone.state;
    const st = flight ? { ...this.player.st, pos:{x:this.camera.position.x,y:this.camera.position.y-1.6,z:this.camera.position.z},
      vel:flight.vel,speed:flight.speed,mode:'air' as const,grounded:false,edge:0,skid:0,plow:0,tuck:0,lastImpact:0 } : this.player.st;
    const surface = this.surface ? this.surface.at(st.pos.x, st.pos.z) : { groomed: 1, piste: 1, moguls: 0 };
    const forward = this.camera.getWorldDirection(this.tmpV2);
    const neighbors = this.ambient?.soundSources() ?? [];
    const guest = this.mountainGuest.pose;
    if (guest && !guest.ride && !guest.airborne && guest.fallen < .1 && guest.touring < .25) {
      neighbors.push({ pos: guest, speed: guest.speed, skid: guest.skid,
        groomed: this.surface?.at(guest.x, guest.z).groomed ?? 1, active: true });
    }
    for (const r of this.net?.remotes.values() ?? []) {
      if (!r.last) continue;
      const pos = r.model.root.position, state = r.last;
      neighbors.push({ pos, speed: Math.hypot(state.vx, state.vy, state.vz), skid: state.plow,
        groomed: this.surface?.at(pos.x, pos.z).groomed ?? 1,
        active: !r.ride && !state.tumble && state.mode !== 'air' && state.mode !== 'riding' });
    }
    const sound = this.audioScene.sample(dt, st, flight ? null : this.player.ride,
      this.lifts.paths, surface, forward, this.env.snowing, neighbors);
    const place = this.placeSound(dt);
    sound.env = place.env; sound.step = place.step;
    // working groomers rumble like the lift machinery, a little lower and rougher
    const listener = this.camera.position;
    for (const c of this.snowcats?.cats ?? []) {
      if (!c.active) continue;
      const d = Math.hypot(c.x - listener.x, c.root.position.y - listener.y, c.z - listener.z);
      if (d > 160) continue;
      const fx = forward.x, fz = forward.z, dx = c.x - listener.x, dz = c.z - listener.z, n = Math.hypot(dx, dz) * Math.hypot(fx, fz) || 1;
      sound.terminals = [...(sound.terminals ?? []), { id: `cat:${c.name}`, distance: d * 0.8, pan: Math.max(-1, Math.min(1, (-fz * dx + fx * dz) / n)) * 0.9, speed: 0.4, variant: 2.6 }];
    }
    if (this.player.ride && !flight) {
      const s = this.player.rideSwing;
      sound.rocking = { angle: Math.hypot(s.roll, s.pitch), velocity: Math.hypot(s.rollV, s.pitchV), slip: s.slip, pan: Math.sin(s.roll) };
    }
    this.audio.update(dt, sound);
    this.drone.audio.update(this.audio.ctx,flight,this.audio.volume,this.audio.enabled,this.drone.fpv);
  }

  private modeLabel() {
    if (this.onFoot?.active) return this.onFoot.st.indoor ?? 'On foot';
    const st = this.player.st;
    if (this.player.ride) return `Riding ${this.lifts.paths[this.player.ride.lift].def.name}`;
    if (this.player.tumble) return 'Falling';
    return { skiing: '', standing: '', air: 'Airborne', fallen: 'Fallen: press R', gettingUp: 'Getting up', riding: '' }[st.mode] ?? '';
  }

  private updateHints() {
    if (this.drone.active) { this.hud.hint(null); return; }
    if (this.onFoot.active) {
      const f = this.onFoot;
      if (f.seat) this.hud.hint('Sitting. <b>E</b> or walk to stand up. <b>1</b> wave, <b>2</b> point.');
      else if (f.carrying && this.nearPoi('rack', 3.2)) this.hud.hint('Ski rack. Press <b>K</b> to leave your skis here.');
      else if (!f.carrying && this.rackedAt && Math.hypot(this.rackedAt.x - f.st.pos.x, this.rackedAt.z - f.st.pos.z) < 3.5) this.hud.hint('Your skis. Press <b>K</b> to pick them up.');
      else if (this.nearPoi('seat', 1.5)) this.hud.hint('Press <b>E</b> to sit down.');
      else this.hud.hint(f.canClickIn() && f.carrying ? 'On foot in ski boots. Press <b>K</b> to click into your skis.' : null);
      return;
    }
    const pl = this.player;
    if (pl.ride) {
      // the stand-up button in the lift bar carries the ramp prompts
      this.hud.hint(null);
    } else if (pl.yardSale && pl.st.mode === 'fallen' && pl.st.grounded) {
      this.hud.hint('Yard sale! Press <b>R</b> to get up and gather your gear.');
    } else if (pl.inLoadZone >= 0 && this.lifts.closed) {
      this.hud.hint(`${this.lifts.paths[pl.inLoadZone].def.name} is closed. In Resort Day the lifts run 9 AM to 4 PM; choose Free explore in the pause menu to ride at any hour.`);
    } else if (pl.inLoadZone >= 0) {
      const path = this.lifts.paths[pl.inLoadZone], t = this.lifts.now(pl.inLoadZone);
      const along = (pl.st.pos.x - path.def.bottom[0]) * path.ax + (pl.st.pos.z - path.def.bottom[2]) * path.az;
      const wait = Math.ceil(path.nextChairAt(path.sAtH(Math.max(0, along)), t).arrive - t);
      this.hud.hint(`${path.def.name}: face uphill and let the chair scoop you up. Next chair in ${wait} s.`);
    } else if (pl.st.mode === 'fallen' && pl.st.grounded && pl.st.speed < 1) {
      this.hud.hint('You fell. Press <b>R</b> to get up');
    } else if (!this.tagging && this.lessonNear < 30) {
      this.hud.hint(`${LESSON_NAME} ski lesson with ${INSTRUCTOR_NAME}. Press <b>L</b> to tag along and learn the route.`);
    } else this.hud.hint(null);
  }
}
