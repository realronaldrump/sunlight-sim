import * as THREE from 'three/webgpu';
import type { Collider, ColliderGrid } from '../../../shared/collision';
import type { GuestCheckpoint, GuestPose } from '../../../shared/mountainGuest';
import type { TerrainProbe, Vec3 } from '../../../shared/skiPhysics';
import { SANTA_STAR_RELEASE } from '../../../shared/santaFestivities';
import { createChairSwing, swingingRiderPoint } from '../../../shared/chairSwing';
import type { LiftSystem } from '../lifts/liftSystem';
import { orientSkier } from '../skier/orientation';
import { SnowSpray } from '../skier/snowSpray';
import type { GuestResort } from './mountainGuestWorld';
import type { GuestWorkerRequest, GuestWorkerResponse } from './mountainGuestWorker';
import { makeSantaSkier } from './santaOutfit';
import { makeSantaOrnament } from './santaOrnament';
import { SantaDiscovery, SIGHTING_RANGE, sightLine } from './santaDiscovery';

const STATE = 'sunlight.mountain-guest.v1';
const clamp = THREE.MathUtils.clamp;
const ease = (x: number) => { const t = clamp(x, 0, 1); return t * t * (3 - 2 * t); };
const lerp = THREE.MathUtils.lerp;
const neutralSwing = createChairSwing();
type Sample = { at: number; pose: GuestPose };

function storage() { try { return localStorage; } catch { return null; } }

export class MountainGuestView {
  readonly group = new THREE.Group();
  readonly discovery = new SantaDiscovery(storage());
  pose: GuestPose | null = null;
  remote = false;
  private samples: Sample[] = [];
  private rig: ReturnType<typeof makeSantaSkier> | null = null;
  private spray = new SnowSpray();
  private sparks = new SnowSpray(true);
  private firStar: ReturnType<typeof makeSantaOrnament> | null = null;
  private sparksIn = 0;
  private actionAnchor = new THREE.Vector3();
  private inverseBody = new THREE.Quaternion();
  private local: Worker | null = null;
  private saved: GuestCheckpoint | null = null;
  private localReady = false;
  private localTick = 0;
  private saveIn = 0;
  private sprayTimer = 0;
  private pickup = new THREE.Vector3();
  private oldRide: GuestPose['ride'] = null;
  private sight = new THREE.Vector3();
  private clip = new THREE.Vector3();
  private colliders: Collider[] = [];
  private normal = { x: 0, y: 1, z: 0 };
  private forward = new THREE.Vector3();
  private contactPoint = new THREE.Vector3();
  private contact = [{ offset: 0, pitch: 0 }, { offset: 0, pitch: 0 }];
  private left = new THREE.Vector3();
  private right = new THREE.Vector3();
  private readonly flush = () => {
    if (this.saved) try { storage()?.setItem(STATE, JSON.stringify(this.saved)); } catch { /* storage blocked */ }
  };

  constructor(private lifts: LiftSystem, private probe: TerrainProbe) {
    this.group.name = 'mountain-guest-system';
    this.group.add(this.spray.mesh, this.sparks.mesh);
    window.addEventListener('pagehide', this.flush);
    document.addEventListener('visibilitychange', () => { if (document.hidden) this.flush(); });
  }

  startLocal(base: string, resort: GuestResort) {
    if (this.local) return;
    let saved: unknown;
    try { saved = JSON.parse(storage()?.getItem(STATE) ?? 'null'); } catch { /* unreadable storage */ }
    this.local = new Worker(new URL('./mountainGuestWorker.ts', import.meta.url), { type: 'module' });
    this.local.onmessage = ({ data }: MessageEvent<GuestWorkerResponse>) => {
      if (data.type === 'error') { console.warn('Mountain guest world:', data.reason); return; }
      this.receive(data.pose, data.at);
      if (data.saved) this.saved = data.saved;
      if (data.type === 'ready') {
        const ride = data.saved.ride;
        if (ride) {
          const at = Date.now() / 1000;
          this.lifts.clocks[ride.lift].sync({ time: data.saved.liftTimes[ride.lift], at, rate: 1 }, at);
        }
        this.localReady = true;
      }
    };
    this.post({ type: 'start', base, resort, saved, seed: crypto.getRandomValues(new Uint32Array(1))[0] });
  }

  private post(m: GuestWorkerRequest) { this.local?.postMessage(m); }

  receiveRemote(pose: GuestPose, at: number) {
    this.remote = true;
    if (this.local) {
      this.flush();
      this.local.terminate();
      this.local = null;
      this.localReady = false;
      this.samples = [];
    }
    this.receive(pose, at);
  }

  private receive(pose: GuestPose, at: number) {
    if (at <= (this.samples.at(-1)?.at ?? -Infinity)) return;
    this.samples.push({ at, pose });
    if (this.samples.length > 9) this.samples.shift();
  }

  tickLocal(dt: number, occupied: { lift: number; chair: number; seat: number } | null, visitor?: Vec3) {
    if (!this.localReady) return;
    const at = Date.now() / 1000;
    if (at - this.localTick >= 1 / 16) {
      this.localTick = at;
      this.post({ type: 'step', at, occupied, times: this.lifts.paths.map((_, i) => this.lifts.now(i)), open: !this.lifts.closed,
        visitor: visitor && { x: visitor.x, y: visitor.y, z: visitor.z } });
    }
    if ((this.saveIn -= dt) <= 0) { this.saveIn = 5; this.flush(); }
  }

  get ride() { return this.samples.at(-1)?.pose.ride ?? null; }

  private sample(at: number) {
    const first = this.samples[0], last = this.samples.at(-1);
    if (!first || !last) return null;
    const i = this.samples.findIndex(s => s.at >= at);
    if (i <= 0) return (i === 0 ? first : last).pose;
    const a = this.samples[i - 1], b = this.samples[i], f = (at - a.at) / (b.at - a.at);
    const p = a.pose, q = b.pose;
    if (!!p.ride !== !!q.ride || Math.hypot(p.x - q.x, p.y - q.y, p.z - q.z) > 8) return p;
    const turn = Math.atan2(Math.sin(q.heading - p.heading), Math.cos(q.heading - p.heading));
    return {
      ...(f < .5 ? p : q), x: lerp(p.x, q.x, f), y: lerp(p.y, q.y, f), z: lerp(p.z, q.z, f),
      heading: p.heading + turn * f, speed: lerp(p.speed, q.speed, f),
      edge: lerp(p.edge, q.edge, f), skid: lerp(p.skid, q.skid, f), plow: lerp(p.plow, q.plow, f),
      tuck: lerp(p.tuck, q.tuck, f), fallen: lerp(p.fallen, q.fallen, f),
      touring: lerp(p.touring, q.touring, f), stride: lerp(p.stride, q.stride, f),
      action: p.action && q.action && p.action.kind === q.action.kind
        ? { ...p.action, progress: lerp(p.action.progress, q.action.progress, f) }
        : (f < .5 ? p.action : q.action),
      star: p.star && q.star ? { ...p.star, remaining: lerp(p.star.remaining, q.star.remaining, f) }
        : (f < .5 ? p.star : q.star),
    };
  }

  update(dt: number, camera: THREE.Camera, now: number, night = 0) {
    const p = this.sample((this.local ? Date.now() / 1000 : now) - .12);
    this.pose = p;
    this.updateFirStar(p?.star, camera, now, night);
    if (!p) return;
    let sitting = 0, preparation = 0, footY: number | undefined;
    let x = p.x, y = p.y, z = p.z, heading = p.heading;
    let rockX = 0, rockZ = 0;
    if (p.ride) {
      const r = p.ride, path = this.lifts.paths[r.lift];
      const t = Math.min(this.lifts.now(r.lift), r.unloadAt);
      const swing = this.lifts.chairSwing(r.lift, r.chair) ?? neutralSwing;
      const seat = swingingRiderPoint(path, r.chair, r.seat, t, swing);
      const boardBlend = ease((t - r.boardedAt) / .55);
      sitting = boardBlend * ease((r.unloadAt - t) / .7);
      if (!this.oldRide) this.pickup.set(x - seat.p.x, y - seat.p.y, z - seat.p.z);
      x = seat.p.x + this.pickup.x * (1 - boardBlend);
      y = seat.p.y + this.pickup.y * (1 - boardBlend);
      z = seat.p.z + this.pickup.z * (1 - boardBlend);
      heading = seat.heading;
      rockX = swing.roll; rockZ = swing.pitch;
      if (sitting < .999) footY = Math.min(.06, this.probe.height(x, z) - y);
    } else if (p.waiting) preparation = .46;
    this.oldRide = p.ride;
    this.pose = { ...p, x, y, z, heading };
    const range = Math.hypot(x - camera.position.x, y - camera.position.y, z - camera.position.z);
    if (range > 360) {
      if (this.rig) this.rig.model.root.visible = false;
      if (this.spray.mesh.visible) this.spray.update(dt);
      if (this.sparks.mesh.visible) this.sparks.update(dt);
      return;
    }
    if (!this.rig) { this.rig = makeSantaSkier(); this.group.add(this.rig.model.root); }
    const { model, animateHat } = this.rig;
    model.root.visible = true;
    model.root.position.set(x, y, z);
    orientSkier(model.root, heading, p.ride ? undefined : this.probe.normal(x, z, this.normal));
    if (p.ride) model.root.rotateX(rockZ).rotateZ(rockX);
    let skiContact: typeof this.contact | undefined;
    if (!p.ride && !p.airborne && p.fallen < .1) {
      const foot = .14 + .2 * p.plow;
      for (const [i, lateral] of [-foot, foot].entries()) {
        const residual = (along: number) => {
          const pt = this.contactPoint.set(lateral, 0, along - .03).applyQuaternion(model.root.quaternion).add(model.root.position);
          return this.probe.height(pt.x, pt.z) - pt.y;
        };
        const tip = residual(-.59), boot = residual(0), tail = residual(.6);
        const pitch = clamp(Math.atan2(tip - tail, 1.19), -.24, .24);
        const height = Math.max(boot, tip - .59 * Math.tan(pitch), tail + .6 * Math.tan(pitch));
        this.contact[i].offset = clamp(height + .026, -.10, .24);
        this.contact[i].pitch = pitch;
      }
      skiContact = this.contact;
    }
    const a = p.action;
    const reach = a?.anchor && this.actionAnchor.set(a.anchor.x, a.anchor.y, a.anchor.z)
      .sub(model.root.position).applyQuaternion(this.inverseBody.copy(model.root.quaternion).invert());
    const costumeAction = a && {
      kind: a.kind,
      amount: ease((a.progress - .025) / .32) * (1 - ease((a.progress - .63) / .35)),
      yaw: Math.atan2(Math.sin(a.heading - heading), Math.cos(a.heading - heading)),
      anchor: reach,
      released: a.progress >= SANTA_STAR_RELEASE || !!p.star,
    };
    model.update({ ...p, time: now % 1000, sitting, liftPreparation: preparation, footGroundY: footY, skiContact, rockX, rockZ,
      touring: { amount: p.touring, stride: p.stride }, costumeAction });
    animateHat(dt, p.speed, p.edge, now % 1000, costumeAction?.kind === 'hat-tip' ? costumeAction.amount : 0);

    const onEdges = !p.ride && !p.airborne && p.fallen < .1 && p.speed > 3 && p.touring < .25;
    const spray = range < 90 && onEdges && (this.sprayTimer -= dt) <= 0;
    const spark = range < 36 && onEdges && p.speed > 4 && Math.abs(p.edge) > .21 && (this.sparksIn -= dt) <= 0;
    if (spray || spark) {
      this.forward.set(-Math.sin(heading), 0, -Math.cos(heading));
      const width = .14 + .19 * p.plow;
      this.left.set(x + this.forward.z * width, y, z - this.forward.x * width);
      this.right.set(x - this.forward.z * width, y, z + this.forward.x * width);
      this.left.y = this.probe.height(this.left.x, this.left.z);
      this.right.y = this.probe.height(this.right.x, this.right.z);
      if (spray) {
        this.sprayTimer = .075;
        this.spray.emit(this.left, this.right, this.forward, .10 + .18 * p.skid + .08 * Math.abs(p.edge), .53, p.speed * .63);
      }
      if (spark) {
        this.sparksIn = .14;
        this.sparks.emit(this.left, this.right, this.forward, .105 + .19 * Math.abs(p.edge), .77, p.speed * .62);
      }
    }
    this.spray.update(dt);
    this.sparks.update(dt);
  }

  private updateFirStar(star: GuestPose['star'], camera: THREE.Camera, now: number, night: number) {
    const visible = star && star.remaining > 0 && Math.hypot(star.x - camera.position.x, star.y - camera.position.y, star.z - camera.position.z) < 45;
    if (!visible) { if (this.firStar) this.firStar.group.visible = false; return; }
    if (!this.firStar) { this.firStar = makeSantaOrnament(); this.group.add(this.firStar.group); }
    const { group, glow } = this.firStar;
    const phase = now % 1000 + star.x * .14 + star.z * .082;
    group.visible = true;
    group.position.set(star.x, star.y, star.z);
    group.rotation.set(.06 * Math.sin(phase * 1.8), star.x * .91 + .28 * Math.cos(phase * .85), .13 * Math.sin(phase * 1.43));
    glow(ease(star.remaining / 2.3), night, Math.sin(phase * 3));
  }

  observe(dt: number, camera: THREE.Camera, active: boolean, colliders: ColliderGrid) {
    if (this.discovery.foundAt) return false;
    const p = this.pose;
    let visible = false;
    if (active && p && this.rig?.model.root.visible && Math.hypot(p.x - camera.position.x, p.y - camera.position.y, p.z - camera.position.z) < SIGHTING_RANGE) {
      camera.updateMatrixWorld();
      camera.getWorldDirection(this.forward);
      for (const height of p.ride ? [1.17, .8] : p.fallen > .5 ? [.43] : [1.5 - p.tuck * .5, 1.06]) {
        this.sight.set(p.x, p.y + height, p.z);
        if (this.clip.copy(this.sight).sub(camera.position).dot(this.forward) < .5) continue;
        this.clip.copy(this.sight).project(camera);
        if (Math.abs(this.clip.x) > .91 || Math.abs(this.clip.y) > .91) continue;
        if (sightLine(camera.position, this.sight, this.probe.height, colliders, this.colliders)) { visible = true; break; }
      }
    }
    return this.discovery.update(dt, visible);
  }
}
