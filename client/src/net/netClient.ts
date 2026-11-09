// Multiplayer client: sends the local skier at 15 Hz, interpolates remote skiers ~120 ms in the past,
// asks the server for chair seats, syncs the lift clock, and relays chat.
import * as THREE from 'three/webgpu';
import type { ClientMsg, ServerMsg, PlayerInfo, NetSkier } from '../../../shared/protocol';
import { TICK_HZ } from '../../../shared/protocol';
import { SkierModel } from '../skier/skierModel';
import { orientSkier } from '../skier/orientation';
import type { Player } from '../skier/player';
import type { LiftSystem } from '../lifts/liftSystem';

interface Sample { t: number; s: NetSkier }

export class RemoteSkier {
  model: SkierModel;
  samples: Sample[] = [];
  ride: PlayerInfo['ride'] = null;
  label: THREE.Sprite;
  fallen = 0; sit = 0; time = 0;
  heading = 0;
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
  remotes = new Map<string, RemoteSkier>();
  readonly group = new THREE.Group();
  private sendTimer = 0;
  private clockOffset = 0; // serverTime - localTime
  private rttBest = Infinity;
  onChat?: (name: string, text: string) => void;
  onStatus?: (text: string) => void;
  private teleportPending = false;
  private pendingBoard: { lift: number; chair: number; seat: number; at: number } | null = null;

  constructor(private player: Player, private lifts: LiftSystem) {
    this.group.name = 'remote-players';
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
    return new Promise((resolve) => {
      let settled = false;
      const done = (ok: boolean) => { if (!settled) { settled = true; resolve(ok); } };
      try { this.ws = new WebSocket(url); } catch { done(false); return; }
      const ws = this.ws;
      const timer = setTimeout(() => { done(false); ws.close(); }, 6000);
      ws.onopen = () => this.send({ type: 'join', room, name, color });
      ws.onerror = () => { clearTimeout(timer); done(false); };
      ws.onclose = () => {
        this.connected = false;
        this.onStatus?.('Disconnected from multiplayer server');
        for (const r of this.remotes.values()) this.group.remove(r.model.root);
        this.remotes.clear();
        this.player.requestBoard = undefined;
        this.pendingBoard = null;
        done(false);
      };
      ws.onmessage = (ev) => {
        let m: ServerMsg;
        try { m = JSON.parse(ev.data); } catch { return; }
        if (m.type === 'welcome') { clearTimeout(timer); this.onWelcome(m); done(true); }
        else if (m.type === 'error') { clearTimeout(timer); this.onStatus?.(m.reason); done(false); }
        else this.onMessage(m);
      };
    });
  }

  private send(m: ClientMsg) { if (this.ws?.readyState === WebSocket.OPEN) this.ws.send(JSON.stringify(m)); }

  private onWelcome(m: Extract<ServerMsg, { type: 'welcome' }>) {
    this.id = m.id; this.room = m.room; this.connected = true;
    this.clockOffset = m.serverTime - Date.now() / 1000;
    this.lifts.clockOffset = this.clockOffset;
    for (const p of m.players) this.addRemote(p);
    for (let i = 0; i < 5; i++) setTimeout(() => this.send({ type: 'ping', t: Date.now() / 1000 }), 200 * i);
    setInterval(() => this.send({ type: 'ping', t: Date.now() / 1000 }), 10000);
    // the server assigns chair seats
    this.player.requestBoard = (lift, chair, seat) => {
      if (this.pendingBoard && performance.now() - this.pendingBoard.at < 1500) return;
      this.pendingBoard = { lift, chair, seat, at: performance.now() };
      // Validate the current load-line position before requesting a seat. Wait for acceptance
      // so a full chair/rejection cannot leave a player suspended in midair.
      this.sendState();
      this.send({ type: 'board', lift, chair, seat });
    };
    this.player.onUnload = (_lift, teleport) => {
      this.pendingBoard = null;
      this.send({ type: 'unload' });
      if (teleport) this.markTeleport();
    };
    this.onStatus?.(`Joined room ${m.room}`);
  }

  private addRemote(p: PlayerInfo) {
    if (p.id === this.id || this.remotes.has(p.id)) return;
    const r = new RemoteSkier(p.id, p.name, p.color);
    r.samples.push({ t: p.t, s: p.s });
    r.ride = p.ride;
    this.remotes.set(p.id, r);
    this.group.add(r.model.root);
  }

  private onMessage(m: ServerMsg) {
    switch (m.type) {
      case 'joined': this.addRemote(m.player); this.onChat?.('', `${m.player.name} joined`); break;
      case 'left': {
        const r = this.remotes.get(m.id);
        if (r) { this.group.remove(r.model.root); this.remotes.delete(m.id); this.onChat?.('', `${r.name} left`); }
        break;
      }
      case 'snapshot':
        for (const p of m.players) {
          if (p.id === this.id) continue;
          let r = this.remotes.get(p.id);
          if (!r) { this.addRemote(p); r = this.remotes.get(p.id)!; }
          r.samples.push({ t: m.serverTime, s: p.s });
          if (r.samples.length > 30) r.samples.shift();
          r.ride = p.ride;
        }
        break;
      case 'boarded':
        if (m.id === this.id) {
          const pending = this.pendingBoard;
          this.pendingBoard = null;
          const path = this.lifts.paths[m.lift];
          if (pending?.lift === m.lift && pending.chair === m.chair && path?.inLoadZone(this.player.st.pos.x, this.player.st.pos.z)) this.player.board(m.lift, m.chair, m.seat);
          else if (!this.player.ride) this.send({ type: 'unload' });
        } else {
          const r = this.remotes.get(m.id);
          if (r) r.ride = { lift: m.lift, chair: m.chair, seat: m.seat };
        }
        break;
      case 'boardRejected':
        this.pendingBoard = null;
        this.onStatus?.(`Could not board: ${m.reason}`);
        break;
      case 'unloaded': {
        if (m.id === this.id && this.player.ride) this.player.unload();
        const r = this.remotes.get(m.id);
        if (r) r.ride = null;
        break;
      }
      case 'correct':
        this.player.st.pos = { x: m.s.x, y: m.s.y, z: m.s.z };
        break;
      case 'chat': this.onChat?.(m.name, m.text); break;
      case 'pong': {
        const nowL = Date.now() / 1000;
        const rtt = nowL - m.t;
        if (rtt < this.rttBest) {
          this.rttBest = rtt;
          this.clockOffset = m.serverTime + rtt / 2 - nowL;
          this.lifts.clockOffset = this.clockOffset;
        }
        break;
      }
    }
  }

  markTeleport() { this.teleportPending = true; }

  chat(text: string) { this.send({ type: 'chat', text }); }

  serverNow() { return Date.now() / 1000 + this.clockOffset; }

  private sendState() {
    const st = this.player.st;
    this.send({ type: 'state', teleport: this.teleportPending || undefined, s: {
      x: st.pos.x, y: st.pos.y, z: st.pos.z, heading: st.heading, vx: st.vel.x, vy: st.vel.y, vz: st.vel.z,
      mode: this.player.ride ? 'riding' : st.mode, edge: st.edge, plow: st.plow, tuck: st.tuck, fallen: this.player.fallenBlend,
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
    for (const r of this.remotes.values()) {
      r.time += dt;
      let s: NetSkier | undefined;
      let heading = 0;
      if (r.ride) {
        // ride exactly on the shared chair clock
        const info = this.lifts.paths[r.ride.lift].riderPoint(r.ride.chair, r.ride.seat, this.lifts.now());
        r.model.root.position.set(info.p.x, info.p.y, info.p.z);
        heading = info.heading;
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
      const speed = Math.hypot(s.vx, s.vy, s.vz);
      r.sit += ((r.ride ? 1 : 0) - r.sit) * Math.min(1, dt * 4);
      r.model.update({ speed, edge: s.edge, plow: s.plow, tuck: s.tuck, skid: 0, fallen: s.fallen, sitting: r.sit, time: r.time, pushing: false });
    }
  }

  /** Simple player-player collision (cylinders); returns true if the local player hit someone hard. */
  collideLocal() {
    const st = this.player.st;
    if (this.player.ride) return false;
    let hit = false;
    for (const r of this.remotes.values()) {
      if (r.ride) continue;
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
      name: r.name, color: r.color, x: r.model.root.position.x, z: r.model.root.position.z, heading: r.heading,
    }));
  }
}
