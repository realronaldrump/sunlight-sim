// Multiplayer client: sends the local skier at 15 Hz, interpolates remote skiers ~120 ms in the past,
// asks the server for chair seats, syncs the lift clock, and relays chat.
import * as THREE from 'three/webgpu';
import { PedestrianModel } from '../world/pedestrian';
import { resortClock } from '../world/resortClock';
import type { ClientMsg, ServerMsg, PlayerInfo, NetSkier, NetDrone } from '../../../shared/protocol';
import { TICK_HZ } from '../../../shared/protocol';
import type { GuestPose } from '../../../shared/mountainGuest';
import type { SantaTraces } from '../../../shared/santaFestivities';
import type { SnowballEvent, SnowballShot } from '../../../shared/snowballs';
import type { SlopeSkier } from '../../../shared/slopeSkiers';
import type { LiftSpeed } from '../../../shared/liftClock';
import { SkierModel } from '../skier/skierModel';
import { orientSkier } from '../skier/orientation';
import type { Player } from '../skier/player';
import type { LiftSystem } from '../lifts/liftSystem';
import type { SkierState } from '../../../shared/skiPhysics';
import { DroneModel } from '../drone/droneModel';
import { carriedSwing, createChairSwing, swingingRiderPoint } from '../../../shared/chairSwing';
import type { ChairSwing } from '../../../shared/chairSwing';
import type { SharedRoute } from '../../../shared/skiNavigation';

interface Sample { t: number; s: NetSkier }

export class RemoteSkier {
  droneOnly = false;
  model: SkierModel;
  samples: Sample[] = [];
  ride: PlayerInfo['ride'] = null;
  label: THREE.Sprite;
  fallen = 0; sit = 0; time = 0;
  heading = 0;
  pickupOffset: THREE.Vector3 | null = null;
  pickupHeading = 0;
  drone: DroneModel | null = null;
  flight: NetDrone | null = null;
  flightPos = new THREE.Vector3();
  flightYaw = 0;
  /** On foot or seated: the same person in ski boots, created when first needed. */
  walker: PedestrianModel | null = null;
  stride = 0;
  act = 0;
  lastAct: string | undefined;
  constructor(public id: string, public name: string, public color: string) {
    this.model = new SkierModel(new THREE.Color(color));
    const cv = document.createElement('canvas'); cv.width = 256; cv.height = 64;
    const g = cv.getContext('2d')!;
    g.font = 'bold 30px -apple-system, Helvetica, sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle';
    g.lineWidth = 6; g.strokeStyle = 'rgba(0,0,0,.65)'; g.strokeText(name, 128, 32);
    g.fillStyle = '#fff'; g.fillText(name, 128, 32);
    const tex = new THREE.CanvasTexture(cv); tex.colorSpace = THREE.SRGBColorSpace;
    this.label = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, depthTest: true, transparent: true }));
    this.label.scale.set(2.4, 0.6, 1);
    this.label.position.y = 2.35;
    this.model.root.add(this.label);
  }
  get last() { return this.samples[this.samples.length - 1]?.s; }
}

export class NetClient {
  ws: WebSocket | null = null;
  id: string | null = null;
  room: string | null = null;
  connected = false;
  supportsLiftSpeed = false;
  /** The server lets riders get off by themselves (older servers unload everyone at the ramp). */
  supportsManualUnload = false;
  supportsSnowballs = false;
  supportsRoutes = false;
  readonly routes = new Map<string, SharedRoute>();
  private localRoute: SharedRoute | null = null;
  private routeTimer: ReturnType<typeof setTimeout> | undefined;
  onSnowballs?: (events: SnowballEvent[]) => void;
  onSnowballReset?: (shots: SnowballShot[]) => void;
  onSlopeSkiers?: (skiers: SlopeSkier[], at: number) => void;
  localDrone: (() => NetDrone | null) | null = null;
  remotes = new Map<string, RemoteSkier>();
  readonly group = new THREE.Group();
  private sendTimer = 0;
  private clockOffset = 0; // serverTime - localTime
  private rttBest = Infinity;
  onChat?: (name: string, text: string) => void;
  onStatus?: (text: string) => void;
  onMountainGuest?: (pose: GuestPose, at: number, reset?: boolean) => void;
  onSantaTraces?: (traces: SantaTraces | undefined, reset?: boolean) => void;
  private teleportPending = false;
  private pendingBoard: { lift: number; chair: number; seat: number; at: number; saved: SkierState } | null = null;
  private reconnectTimer: ReturnType<typeof setTimeout> | undefined;
  private pingTimer: ReturnType<typeof setInterval> | undefined;
  private retry = 0;
  private stopped = false;
  private lastMessage = 0;
  private session: {url:string;room:string;name:string;color:string} | null = null;
  private resume = () => {
    if (!document.hidden && this.connected && Date.now()-this.lastMessage > 15000) this.ws?.close();
    if (!document.hidden && !this.connected && this.session && !this.stopped && this.ws?.readyState !== WebSocket.CONNECTING) {
      clearTimeout(this.reconnectTimer); void this.open();
    }
  };

  constructor(private player: Player, private lifts: LiftSystem, readonly droneOnly = false) {
    this.group.name = 'remote-players';
    window.addEventListener('online',this.resume);
    document.addEventListener('visibilitychange',this.resume);
  }

  static defaultUrl() {
    const p = new URLSearchParams(location.search).get('server');
    if (p) return p;
    const env = (import.meta.env.VITE_SERVER_URL as string | undefined);
    if (env) return env;
    const proto = location.protocol === 'https:' ? 'wss' : 'ws';
    return `${proto}://${location.hostname}:8787`;
  }

  connect(url: string, room: string, name: string, color: string): Promise<boolean> {
    this.session = {url,room,name,color}; this.room=room; this.stopped=false;
    return this.open();
  }

  private open(): Promise<boolean> {
    const session = this.session!;
    clearTimeout(this.reconnectTimer);
    return new Promise((resolve) => {
      let settled = false;
      const done = (ok: boolean) => { if (!settled) { settled = true; resolve(ok); } };
      try { this.ws = new WebSocket(session.url); } catch { done(false); this.scheduleReconnect(); return; }
      const ws = this.ws;
      const timer = setTimeout(() => { done(false); ws.close(); }, 6000);
      ws.onopen = () => this.send({ type: 'join', room:session.room, name:session.name, color:session.color, controlMode:this.droneOnly ? 'drone' : 'skier' });
      ws.onerror = () => { clearTimeout(timer); done(false); };
      ws.onclose = () => {
        clearTimeout(timer);
        if (this.ws !== ws) return;
        this.connected = false;
        clearInterval(this.pingTimer);
        if (!this.stopped) this.onStatus?.('Connection interrupted. Reconnecting…');
        this.clearRemotes();
        this.player.requestBoard = undefined;
        this.pendingBoard = null;
        this.player.onUnload = undefined;
        this.player.onLiftFall = undefined;
        this.player.onJump = undefined;
        done(false);
        this.scheduleReconnect();
      };
      ws.onmessage = (ev) => {
        this.lastMessage=Date.now();
        let m: ServerMsg;
        try { m = JSON.parse(ev.data); } catch { return; }
        if (this.ws !== ws) return;
        if (m.type === 'welcome') { clearTimeout(timer); this.retry=0; this.onWelcome(m); done(true); }
        else if (m.type === 'error') { clearTimeout(timer); this.onStatus?.(m.reason); done(false); ws.close(); }
        else this.onMessage(m);
      };
    });
  }

  private scheduleReconnect() {
    if (this.stopped || !this.session) return;
    clearTimeout(this.reconnectTimer);
    this.reconnectTimer=setTimeout(() => { void this.open(); },Math.min(10000,750*2**Math.min(4,this.retry++)));
  }

  private removeRemote(r: RemoteSkier) {
    this.group.remove(r.model.root);
    if (r.walker) this.group.remove(r.walker.root);
    if (r.drone) { this.group.remove(r.drone.root); r.drone.dispose(); }
    (r.label.material as THREE.SpriteMaterial).map?.dispose(); r.label.material.dispose();
  }
  private clearRemotes() { for(const r of this.remotes.values())this.removeRemote(r); this.remotes.clear(); this.routes.clear(); }
  disconnect() {
    clearTimeout(this.routeTimer);
    this.stopped=true; clearTimeout(this.reconnectTimer); clearInterval(this.pingTimer);
    this.ws?.close(); this.connected=false; this.clearRemotes();
    window.removeEventListener('online',this.resume); document.removeEventListener('visibilitychange',this.resume);
    this.player.requestBoard=undefined; this.player.onUnload=undefined; this.player.onLiftFall=undefined; this.player.onJump=undefined;
  }

  private send(m: ClientMsg) { if (this.ws?.readyState === WebSocket.OPEN) this.ws.send(JSON.stringify(m)); }

  shareRoute(route: SharedRoute | null) {
    this.localRoute = route;
    clearTimeout(this.routeTimer);
    // Coalesce a pin followed by its finished route; guarantee the latest update
    // reaches the room even when planning completes inside its rate limit.
    if (!route) { if (this.supportsRoutes) this.send({ type: 'route', route: null }); return; }
    this.routeTimer = setTimeout(() => {
      if (this.connected && this.supportsRoutes) this.send({ type: 'route', route: this.localRoute });
    }, 350);
  }

  private onWelcome(m: Extract<ServerMsg, { type: 'welcome' }>) {
    this.id = m.id; this.room = m.room; this.connected = true;
    this.clockOffset = m.serverTime - Date.now() / 1000; resortClock.offset = this.clockOffset;
    this.supportsLiftSpeed = !!m.liftPlayback;
    this.supportsManualUnload = !!m.manualUnload;
    this.supportsSnowballs = Array.isArray(m.snowballs);
    this.supportsRoutes = Array.isArray(m.routes);
    this.routes.clear();
    for (const r of m.routes ?? []) this.routes.set(r.id, r.route);
    this.shareRoute(this.localRoute);
    this.onSnowballReset?.(m.snowballs ?? []);
    if (m.slopeSkiers) this.onSlopeSkiers?.(m.slopeSkiers, m.serverTime);
    this.lifts.clockOffset = 0;
    this.lifts.clocks.forEach((clock, i) => clock.sync(m.liftPlayback?.[i] ?? {time:m.serverTime,at:m.serverTime,rate:1}, m.serverTime));
    this.rttBest=Infinity;
    this.onSantaTraces?.(m.santaTraces, true);
    if (m.mountainGuest) this.onMountainGuest?.(m.mountainGuest, m.serverTime, true);
    for (const p of m.players) this.addRemote(p);
    this.send({ type: 'ping', t: Date.now() / 1000 });
    clearInterval(this.pingTimer);
    this.pingTimer=setInterval(() => {
      if (Date.now()-this.lastMessage > 20000) { this.ws?.close(); return; }
      this.send({ type: 'ping', t: Date.now() / 1000 });
    }, 10000);
    this.markTeleport(); this.sendState();
    // the server assigns chair seats
    this.player.requestBoard = (lift, chair, seat) => {
      if (this.droneOnly) return;
      if (this.pendingBoard && performance.now() - this.pendingBoard.at < 1500) return;
      this.pendingBoard = { lift, chair, seat, at: performance.now(), saved: structuredClone(this.player.st) };
      // Start the physical pickup at contact, without waiting for a round trip.
      // Keep the last snow contact so rejection can restore it safely.
      this.sendState();
      this.send({ type: 'board', lift, chair, seat });
      this.player.board(lift, chair, seat);
    };
    this.player.onUnload = (_lift, teleport) => {
      this.pendingBoard = null;
      this.send({ type: 'unload' });
      if (teleport) this.markTeleport();
    };
    this.player.onLiftFall = (_ride, swing) => {
      this.pendingBoard = null;
      this.sendState(swing);
      this.send({ type: 'liftFall', swing });
      this.sendState();
    };
    this.player.onJump = (_ride, swing) => {
      this.pendingBoard = null;
      this.send({ type: 'liftFall', swing, jump: true });
      this.markTeleport();
      this.sendState();
    };
    this.onStatus?.(`Joined room ${m.room}`);
  }

  private addRemote(p: PlayerInfo) {
    if (p.id === this.id || this.remotes.has(p.id)) return;
    const r = new RemoteSkier(p.id, p.name, p.color);
    r.droneOnly=p.controlMode==='drone';
    r.model.root.visible=!r.droneOnly;
    r.samples.push({ t: p.t, s: p.s });
    r.ride = p.ride;
    this.remotes.set(p.id, r);
    this.group.add(r.model.root);
    this.setRemoteDrone(r,p.drone ?? null);
  }

  private setRemoteDrone(r: RemoteSkier,flight: NetDrone | null) {
    if (flight && !r.drone) { r.drone=new DroneModel();this.group.add(r.drone.root); }
    if (flight && !r.flight) { r.flightPos.set(flight.x,flight.y,flight.z);r.flightYaw=flight.yaw; }
    r.flight=flight;
    if(r.drone)r.drone.root.visible=!!flight;
    if (r.droneOnly && r.drone) { r.drone.root.add(r.label); r.label.position.y=.8; r.label.scale.set(2.4,.6,1); }
  }

  private onMessage(m: ServerMsg) {
    switch (m.type) {
      case 'route': if (m.id !== this.id) { if (m.route) this.routes.set(m.id, m.route); else this.routes.delete(m.id); } break;
      case 'joined': this.addRemote(m.player); this.onChat?.('', `${m.player.name} joined`); break;
      case 'left': {
        this.routes.delete(m.id);
        const r = this.remotes.get(m.id);
        if (r) { this.removeRemote(r); this.remotes.delete(m.id); this.onChat?.('', `${r.name} left`); }
        break;
      }
      case 'snapshot':
        if (m.slopeSkiers) this.onSlopeSkiers?.(m.slopeSkiers, m.serverTime);
        if (m.mountainGuest) this.onMountainGuest?.(m.mountainGuest, m.serverTime);
        if (m.liftPlayback) this.lifts.clocks.forEach((clock, i) => { if (m.liftPlayback?.[i]) clock.sync(m.liftPlayback[i], Math.max(m.serverTime, this.serverNow())); });
        for (const p of m.players) {
          if (p.id === this.id) continue;
          let r = this.remotes.get(p.id);
          if (!r) { this.addRemote(p); r = this.remotes.get(p.id)!; }
          r.samples.push({ t: m.serverTime, s: p.s });
          if (r.samples.length > 30) r.samples.shift();
          r.ride = p.ride;
          this.setRemoteDrone(r,p.drone ?? null);
        }
        break;
      case 'santaTraces': this.onSantaTraces?.(m.traces); break;
      case 'snowballs': this.onSnowballs?.(m.events); break;
      case 'boarded':
        if (m.id === this.id) {
          if (this.droneOnly) break;
          const pending = this.pendingBoard;
          this.pendingBoard = null;
          if (pending?.lift === m.lift && pending.chair === m.chair && this.player.ride?.chair === m.chair && this.player.ride.lift === m.lift) this.player.confirmSeat(m.seat);
          else if (!this.player.ride) this.send({ type: 'unload' });
        } else {
          const r = this.remotes.get(m.id);
          if (r) {
            r.ride = { lift: m.lift, chair: m.chair, seat: m.seat, boardedAt: m.boardedAt ?? this.serverNow() };
            const p = this.lifts.paths[m.lift].riderPoint(m.chair, m.seat, r.ride.boardedAt!).p;
            r.pickupOffset = r.model.root.position.clone().sub(new THREE.Vector3(p.x, p.y, p.z));
            r.pickupHeading = r.heading;
          }
        }
        break;
      case 'boardRejected':
        if (this.pendingBoard) this.player.rejectBoard(this.pendingBoard.saved);
        this.pendingBoard = null;
        this.onStatus?.(`Could not board: ${m.reason}`);
        break;
      case 'unloaded': {
        if (m.id === this.id && this.player.ride && !this.player.missed) this.player.unload();
        const r = this.remotes.get(m.id);
        if (r) { r.ride = null; r.pickupOffset = null; }
        break;
      }
      case 'correct':
        this.player.st.pos = { x: m.s.x, y: m.s.y, z: m.s.z };
        break;
      case 'liftFell': {
        const r = this.remotes.get(m.id);
        if (r) {
          r.ride = null; r.pickupOffset = null;
          r.samples.push({ t: this.serverNow(), s: m.s });
        }
        break;
      }
      case 'chat': this.onChat?.(m.name, m.text); break;
      case 'pong': {
        const nowL = Date.now() / 1000;
        const rtt = nowL - m.t;
        if (rtt < this.rttBest) {
          this.rttBest = rtt;
          this.clockOffset = m.serverTime + rtt / 2 - nowL; resortClock.offset = this.clockOffset;
          if (!this.supportsLiftSpeed) this.lifts.clocks.forEach(clock => clock.sync({time:m.serverTime,at:m.serverTime,rate:1},m.serverTime+rtt/2));
        }
        break;
      }
    }
  }

  markTeleport() { this.teleportPending = true; }

  setLiftSpeed(rate: LiftSpeed) { this.send({ type: 'liftSpeed', rate }); }
  cancelLiftSpeed() { this.send({ type: 'liftSpeed', cancel: true }); }

  chat(text: string) { this.send({ type: 'chat', text }); }
  throwSnowball(yaw: number, pitch: number, token: string, target?: string) { this.sendState(); this.send({ type: 'snowball', yaw, pitch, token, target }); }

  serverNow() { return Date.now() / 1000 + this.clockOffset; }

  /** Extra state from the game: walking or sitting on foot, and gestures. */
  localExtras: (() => Partial<NetSkier>) | null = null;
  /** A friend nearby started waving or pointing. */
  onGesture: ((r: RemoteSkier, act: 'wave' | 'point') => void) | null = null;

  private sendState(releaseSwing?: ChairSwing) {
    const st = this.player.st, extras = this.player.ride ? {} : this.localExtras?.() ?? {};
    this.send({ type: 'state', teleport: this.teleportPending || undefined, drone: this.localDrone?.() ?? null, s: {
      x: st.pos.x, y: st.pos.y, z: st.pos.z, heading: st.heading, vx: st.vel.x, vy: st.vel.y, vz: st.vel.z,
      mode: this.droneOnly ? 'drone' : this.player.ride ? 'riding' : st.mode, edge: st.edge, plow: st.plow, tuck: st.tuck, fallen: this.player.fallenBlend,
      swing: releaseSwing ?? (this.player.ride ? { ...this.player.chairSwing } : undefined),
      tumble: this.player.tumble ? { pitch: this.player.tumble.pitch, roll: this.player.tumble.roll } : undefined,
      ...extras,
    } });
    this.teleportPending = false;
  }

  update(dt: number) {
    if (!this.connected) return;
    this.sendTimer += dt;
    if (this.sendTimer >= 1 / TICK_HZ) {
      this.sendTimer = 0;
      this.sendState();
    }
    const renderT = this.serverNow() - 0.12;
    const tmp = new THREE.Vector3();
    for (const r of this.remotes.values()) if (r.ride && r.last?.swing) this.lifts.setChairSwing(r.ride.lift, r.ride.chair, r.last.swing, r.id);
    for (const r of this.remotes.values()) {
      r.time += dt;
      if(r.flight && r.drone) {
        const f=r.flight,k=1-Math.exp(-12*dt);
        if(r.flightPos.distanceTo(new THREE.Vector3(f.x,f.y,f.z))>12)r.flightPos.set(f.x,f.y,f.z);
        else r.flightPos.lerp(new THREE.Vector3(f.x,f.y,f.z),k);
        r.flightYaw+=Math.atan2(Math.sin(f.yaw-r.flightYaw),Math.cos(f.yaw-r.flightYaw))*k;
        r.drone.update(dt,{pos:r.flightPos,yaw:r.flightYaw,pitch:f.pitch,bank:f.bank,tilt:f.tilt,rpm:f.rpm});
      }
      if (r.droneOnly) continue;
      let s: NetSkier | undefined;
      let heading = 0;
      let loading = false;
      if (r.ride) {
        // ride exactly on the shared chair clock
        const path = this.lifts.paths[r.ride.lift], swing = carriedSwing(r.last?.swing ?? createChairSwing(), this.lifts.chairSwing(r.ride.lift, r.ride.chair));
        const info = swing ? swingingRiderPoint(path, r.ride.chair, r.ride.seat, this.lifts.now(r.ride.lift), swing)
          : path.riderPoint(r.ride.chair, r.ride.seat, this.lifts.now(r.ride.lift));
        r.model.root.position.set(info.p.x, info.p.y, info.p.z);
        heading = info.heading;
        if (r.pickupOffset && r.ride.boardedAt !== undefined) {
          const progress = Math.min(1, Math.max(0, (this.lifts.now(r.ride.lift) - r.ride.boardedAt) / .85));
          const blend = progress * progress * (3 - 2 * progress);
          r.model.root.position.addScaledVector(r.pickupOffset, 1 - blend);
          heading = r.pickupHeading + Math.atan2(Math.sin(heading - r.pickupHeading), Math.cos(heading - r.pickupHeading)) * blend;
          r.sit = blend; loading = true;
          if (progress === 1) r.pickupOffset = null;
        }
        s = r.last;
      } else {
        const S = r.samples;
        let a = S[0], b = S[S.length - 1];
        for (let i = 0; i < S.length - 1; i++) if (S[i].t <= renderT && S[i + 1].t >= renderT) { a = S[i]; b = S[i + 1]; break; }
        if (!a || !b) continue;
        const k = b.t > a.t ? Math.min(1, Math.max(0, (renderT - a.t) / (b.t - a.t))) : 1;
        const lerp = (x: number, y: number) => x + (y - x) * k;
        let dh = b.s.heading - a.s.heading;
        while (dh > Math.PI) dh -= 2 * Math.PI; while (dh < -Math.PI) dh += 2 * Math.PI;
        r.model.root.position.set(lerp(a.s.x, b.s.x), lerp(a.s.y, b.s.y), lerp(a.s.z, b.s.z));
        heading = a.s.heading + dh * k;
        s = k < 0.5 ? a.s : b.s;
      }
      r.heading = heading;
      orientSkier(r.model.root, heading, r.ride ? undefined : this.player.terrainNormal(r.model.root.position.x, r.model.root.position.z));
      if (!s) continue;
      const swing = r.ride ? carriedSwing(s.swing ?? createChairSwing(), this.lifts.chairSwing(r.ride.lift, r.ride.chair)) : undefined, tumble = !r.ride ? s.tumble : undefined;
      if (swing || tumble) r.model.root.rotation.set(swing?.pitch ?? tumble!.pitch, heading, swing?.roll ?? tumble!.roll, 'YXZ');
      const speed = Math.hypot(s.vx, s.vy, s.vz);
      // gestures: blend the arm in and out, and tell the local player when one starts
      r.act += ((s.act ? 1 : 0) - r.act) * Math.min(1, dt * 6);
      if (s.act && s.act !== r.lastAct) this.onGesture?.(r, s.act);
      r.lastAct = s.act;
      // walking or sitting: show the person in ski boots instead of the skier
      const onFoot = !r.ride && (s.mode === 'walking' || s.mode === 'sitting');
      (r.model.root.children[0] as THREE.Object3D).visible = !onFoot;
      if (onFoot && !r.walker) { r.walker = new PedestrianModel({ jacket: new THREE.Color(r.color), hat: 'helmet' }); this.group.add(r.walker.root); }
      if (r.walker) {
        r.walker.root.visible = onFoot;
        if (onFoot) {
          r.stride += speed * dt / 0.6;
          r.walker.root.position.copy(r.model.root.position);
          r.walker.root.rotation.set(0, heading, 0);
          r.model.root.rotation.set(0, heading, 0);
          const sitting = s.mode === 'sitting';
          r.walker.update({ mode: sitting ? 'sit' : speed > 0.15 ? 'walk' : 'stand', stride: r.stride, speed, time: r.time,
            carry: s.foot?.carry ?? true, skis: sitting || !(s.foot?.carry ?? true) ? 'none' : 'shoulder', seat: s.foot?.seat, handsOnTable: s.foot?.table,
            gesture: s.act ? { kind: s.act, amount: r.act, yaw: s.actYaw } : undefined });
          continue;
        }
      }
      if (!loading) r.sit += ((r.ride ? 1 : 0) - r.sit) * Math.min(1, dt * 5);
      const pos = r.model.root.position;
      const footGroundY = r.ride ? this.player.terrainHeight(pos.x - Math.sin(heading) * .2, pos.z - Math.cos(heading) * .2) - pos.y : undefined;
      const n = this.player.terrainNormal(pos.x, pos.z), footGroundPitch = Math.atan2(n.x * Math.sin(heading) + n.z * Math.cos(heading), n.y);
      r.model.update({ speed, edge: s.edge, plow: s.plow, tuck: s.tuck, skid: 0, fallen: s.fallen, sitting: r.sit, footGroundY, footGroundPitch, liftPreparation: r.ride ? 1 : 0, time: r.time, pushing: false,
        terrain: this.player.terrain, airborne: !!tumble || s.mode === 'air', rockX: swing?.leanX, rockZ: swing?.leanZ, slipping: swing?.slip,
        gesture: s.act && !r.ride ? { kind: s.act, amount: r.act, yaw: s.actYaw } : undefined });
    }
  }

  /** Simple player-player collision (cylinders); returns true if the local player hit someone hard. */
  collideLocal() {
    const st = this.player.st;
    if (this.player.ride) return false;
    let hit = false;
    for (const r of this.remotes.values()) {
      if (r.ride || r.droneOnly) continue;
      const p = r.model.root.position;
      const dx = st.pos.x - p.x, dz = st.pos.z - p.z, d = Math.hypot(dx, dz);
      if (d < 0.8 && d > 1e-3 && Math.abs(st.pos.y - p.y) < 1.5) {
        const nx = dx / d, nz = dz / d;
        st.pos.x = p.x + nx * 0.8; st.pos.z = p.z + nz * 0.8;
        const s = r.last;
        const rvx = st.vel.x - (s?.vx ?? 0), rvz = st.vel.z - (s?.vz ?? 0);
        const into = -(rvx * nx + rvz * nz);
        if (into > 0) { st.vel.x += nx * into * 0.8; st.vel.z += nz * into * 0.8; }
        if (into > 4 && st.mode !== 'fallen') hit = true;
      }
    }
    return hit;
  }

  mapPlayers() {
    return [...this.remotes.values()].map((r) => ({
      id: r.id, name: r.name, color: r.color, x: r.flight ? r.flightPos.x : r.model.root.position.x, z: r.flight ? r.flightPos.z : r.model.root.position.z, heading: r.flight ? r.flightYaw : r.heading,
    }));
  }
}
