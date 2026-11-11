import * as THREE from 'three/webgpu';
import { SNOWBALL, SnowballWorld, aimSnowball, makeSnowball, snowballPosition,
  type SnowballActor, type SnowballEvent, type SnowballHit, type SnowballShot } from '../../../shared/snowballs';
import { coversPoint } from '../../../shared/mountainGuestNavigation';
import type { Game } from '../game';
import { SnowSpray } from '../skier/snowSpray';
import { ComicPops } from '../ui/comicPops';
import { YardSale } from './yardSale';
import type { SkierModel } from '../skier/skierModel';

const css = `
#snowball-hud { position:fixed; left:50%; bottom:76px; transform:translateX(-50%); z-index:10; pointer-events:none;
  padding:8px 15px; border:1px solid #d3eaff55; border-radius:24px; background:#102236c9; color:#f5fbff; font-size:13px; backdrop-filter:blur(6px); }
#snowball-hud kbd { font:600 12px inherit; border:1px solid #d3eaff66; padding:1px 5px; border-radius:4px; margin-right:6px; }
#snowball-aim { position:fixed; z-index:10; width:32px; height:32px; border:2px solid #d5f4ff; box-shadow:0 0 0 1px #17374b88;
  border-radius:50%; transform:translate(-50%,-50%); pointer-events:none; }
#snowball-aim::after { content:''; position:absolute; width:4px; height:4px; top:12px; left:12px; border-radius:50%; background:#fff; }
#snowball-flash { position:fixed; inset:0; z-index:9; pointer-events:none; box-shadow:inset 0 0 90px 30px #e8f7ff; opacity:0; transition:opacity .35s; }
@media(prefers-reduced-motion:reduce) { #snowball-flash { display:none; } }
`;

/** Input, predictive flight, feedback and detached equipment. Hits come only from the current authority. */
export class SnowballFights {
  readonly group = new THREE.Group();
  readonly world: SnowballWorld;
  readonly shots = new Map<string, SnowballShot>();
  readonly gear = new Map<string, { sale: YardSale; at: number; elapsed: number }>();
  lastHit: SnowballHit | null = null;
  private ball: THREE.InstancedMesh;
  private powder = new SnowSpray();
  private pops = new ComicPops();
  private dummy = new THREE.Object3D();
  private hud = document.createElement('div');
  private aim = document.createElement('div');
  private flash = document.createElement('div');
  private seen = new Map<string, number>();
  private throwAt = -Infinity;
  private sequence = 0;
  private flashFor = 0;
  private aimAt = -Infinity;
  private targetId: string | undefined;
  private hudLabel = '';

  constructor(private game: Game) {
    const g = game;
    this.group.name = 'snowball-fights';
    this.world = new SnowballWorld((x, z) => g.probe.height(x, z), g.colliders);
    this.world.onHit = hit => { if (hit.target === this.myId) g.player.knockBySnowball(hit); else g.ambient?.knockDown(hit); };
    this.ball = new THREE.InstancedMesh(new THREE.IcosahedronGeometry(.12, 2), new THREE.MeshStandardNodeMaterial({ color: 0xf5faff, roughness: .93 }), SNOWBALL.max * 4);
    this.ball.instanceMatrix.setUsage(THREE.DynamicDrawUsage); this.ball.count = 0;
    this.ball.frustumCulled = false; this.ball.castShadow = this.ball.receiveShadow = true; this.ball.name = 'flying-snowballs';
    this.group.add(this.ball, this.powder.mesh);
    const style = document.createElement('style'); style.textContent = css; document.head.append(style);
    this.hud.id = 'snowball-hud'; this.aim.id = 'snowball-aim'; this.flash.id = 'snowball-flash';
    this.hud.hidden = this.aim.hidden = true; document.body.append(this.hud, this.aim, this.flash);
    g.renderer.domElement.addEventListener('contextmenu', e => { if (!g.drone.active && !g.droneOnly) e.preventDefault(); });
    g.renderer.domElement.addEventListener('pointerdown', e => { if (e.button === 2 && g.input.enabled) this.throw(); });
  }
  get myId() { return this.game.net?.id ?? 'you'; }
  get now() { return this.game.net?.serverNow() ?? Date.now() / 1000; }

  actors(): SnowballActor[] {
    const g = this.game, st = g.player.st;
    const mine: SnowballActor = { id: this.myId, name: g.playerName, kind: 'player', pos: st.pos, vel: st.vel, heading: st.heading,
      active: !g.droneOnly && !g.drone.active && !g.onFoot.active && !g.player.ride && !g.player.tumble && st.grounded && ['skiing', 'standing'].includes(st.mode) };
    return [mine, ...[...(g.net?.remotes.values() ?? [])].flatMap<SnowballActor>(r => {
      const s = r.last; return s ? [{ id: r.id, name: r.name, kind: 'player', pos: r.model.root.position,
        vel: { x: s.vx, y: s.vy, z: s.vz }, heading: r.heading,
        active: !r.droneOnly && !r.flight && !r.ride && ['skiing', 'standing'].includes(s.mode) && s.fallen < .1 }] : [];
    }), ...(g.ambient?.snowballActors() ?? [])];
  }

  private model(id: string): SkierModel | undefined {
    const g = this.game;
    return id === this.myId ? g.player.model : id.startsWith('npc/') ? g.ambient?.snowballModel(id) : g.net?.remotes.get(id)?.model;
  }

  target(actors = this.actors()) {
    const me = actors[0], g = this.game, dir = g.camera.getWorldDirection(new THREE.Vector3());
    let target: SnowballActor | null = null, best = Infinity;
    for (const a of actors) {
      if (!a.active || a.id === me.id) continue;
      const dx = a.pos.x - me.pos.x, dz = a.pos.z - me.pos.z, d = Math.hypot(dx, dz);
      if (d < 1 || d > SNOWBALL.range || (dx * dir.x + dz * dir.z) / d < .90) continue;
      const p = new THREE.Vector3(a.pos.x, a.pos.y + 1, a.pos.z).project(g.camera);
      if (p.z > 1 || Math.abs(p.x) > .55 || Math.abs(p.y) > .65) continue;
      // Never offer assisted aiming through a wall, trunk or bank of snow.
      let clear = true;
      for (let k = .5; k < d; k += .5) {
        const t = k / d, x = me.pos.x + dx * t, z = me.pos.z + dz * t, y = me.pos.y + 1.3 + (a.pos.y - me.pos.y - .3) * t;
        if (g.probe.height(x, z) > y || g.colliders.query(x, z).some(c => y < c.top && (c.bottom === undefined || y > c.bottom) && coversPoint(c, x, z, .1))) { clear = false; break; }
      }
      const cost = Math.hypot(p.x, p.y) + d / 200;
      if (clear && cost < best) { target = a; best = cost; }
    }
    return target;
  }

  throw() {
    const g = this.game, at = this.now, actors = this.actors(), me = actors[0];
    if (!g.ready || !g.input.enabled || document.hidden || g.chat?.open || g.trailMap.visible || g.options.visible || g.skiLogPanel?.visible ||
        g.flyMode || !me.active || at - this.throwAt < SNOWBALL.cooldown) return false;
    if (g.net && (!g.net.connected || !g.net.supportsSnowballs)) { g.hud.toast(g.net.connected ? 'This room is updating. Rejoin to throw snowballs.' : 'Reconnecting to your room…'); return false; }
    const target = this.target(actors), dir = g.camera.getWorldDirection(new THREE.Vector3());
    const aim = target ? aimSnowball(me, target) : { yaw: Math.atan2(-dir.x, -dir.z), pitch: THREE.MathUtils.clamp(.18 + Math.asin(dir.y) * .6, -.55, .65) };
    const token = (++this.sequence).toString(36);
    this.throwAt = at;
    if (g.net) {
      // Flight starts immediately. The accepted server shot replaces this prediction by ID.
      this.receive([{ type: 'throw', shot: makeSnowball(me, aim.yaw, aim.pitch, at, `${me.id}/${token}`) }]);
      g.net.throwSnowball(aim.yaw, aim.pitch, token, target?.id);
    } else {
      this.world.throw(me, aim.yaw, aim.pitch, at, token); this.receive(this.world.drain());
    }
    return true;
  }

  reset(shots: SnowballShot[]) {
    this.shots.clear(); this.seen.clear(); this.throwAt = -Infinity;
    for (const g of this.gear.values()) { g.sale.clear(); this.group.remove(g.sale.group); } this.gear.clear();
    for (const shot of shots) this.shots.set(shot.id, shot);
  }

  receive(events: SnowballEvent[]) {
    const g = this.game;
    for (const event of events) {
      if (event.type === 'throw') {
        const s = event.shot, predicted = this.shots.has(s.id); this.shots.set(s.id, s);
        if (!predicted) {
          const heading = this.actors().find(a => a.id === s.owner)?.heading ?? 0;
          this.model(s.owner)?.throwSnowball(Math.atan2(-s.vel.x, -s.vel.z) - heading);
          this.sound('snowToss', s.pos, .38);
        }
      } else {
        this.shots.delete(event.id); this.lastHit = event;
        this.powder.burst(event.pos, event.seed); this.sound('snowHit', event.pos, event.target ? .8 : .35);
        if (!event.target) continue;
        if (event.target === this.myId && g.net) g.player.knockBySnowball(event);
        this.fallVisual(event);
        if (event.target === this.myId) {
          this.flashFor = .55;
          g.hud.toast(`${event.name} got you! Press R once you stop to gather your skis.`, 4);
        } else if (event.owner === this.myId) g.hud.toast(`${event.seed % 3 === 0 ? 'Boop! ' : ''}${event.targetName ?? 'Skier'}: yard sale!`, 2.5);
        const p = new THREE.Vector3(event.pos.x, event.pos.y, event.pos.z);
        if (p.distanceTo(g.camera.position) < 70) this.pops.pop(['BOOP!', 'PLOMP!', 'POOF!', 'BOOP!', 'SPLOSH!'][event.seed % 5], p, { life: 1.2, color: '#e9f8ff' });
      }
    }
  }

  private fallVisual(hit: SnowballHit) {
    if (!hit.target || this.seen.get(hit.target) === hit.at) return;
    this.seen.set(hit.target, hit.at); this.model(hit.target)?.hitBySnowball(hit.seed);
    let entry = this.gear.get(hit.target);
    if (!entry) {
      if (this.gear.size >= 20) { const first = this.gear.keys().next().value!; this.group.remove(this.gear.get(first)!.sale.group); this.gear.delete(first); }
      entry = { sale: new YardSale(), at: hit.at, elapsed: 0 }; this.gear.set(hit.target, entry); this.group.add(entry.sale.group);
    }
    entry.at = hit.at;
    entry.elapsed = 0;
    entry.sale.launch(hit.targetPos ?? hit.pos, hit.velocity ?? { x: 0, y: 0, z: 0 }, hit.seed);
  }

  private sound(kind: 'snowHit' | 'snowToss', pos: { x: number; y: number; z: number }, gain: number) {
    const g = this.game, p = new THREE.Vector3(pos.x, pos.y, pos.z), dist = p.distanceTo(g.camera.position);
    if (dist > 55) return;
    const local = p.applyMatrix4(g.camera.matrixWorldInverse);
    g.audio.effect(kind, gain / (1 + dist * .1), THREE.MathUtils.clamp(local.x / Math.max(5, dist), -1, 1));
  }

  update(dt: number) {
    const g = this.game, at = this.now, actors = this.actors();
    if (!g.net && g.ready && !g.flyMode && !document.hidden) { this.world.advance(at, actors); this.receive(this.world.drain()); }
    // A late visitor or reconnected friend must see an already-fallen skier's missing equipment.
    for (const r of g.net?.remotes.values() ?? []) {
      const s = r.last, fall = s?.snowballFall;
      if (s && fall) this.fallVisual({ type: 'hit', id: '', owner: '', name: '', target: r.id, at: fall.at, seed: fall.seed,
        pos: { x: s.x, y: s.y, z: s.z }, targetPos: { x: s.x, y: s.y, z: s.z }, velocity: { x: s.vx, y: s.vy, z: s.vz } });
    }
    for (const a of g.ambient?.snowballFalls() ?? []) this.fallVisual({ type: 'hit', id: '', owner: '', name: '', target: a.id,
      at: a.fall.at, seed: a.fall.seed, pos: a.st.pos, targetPos: a.st.pos, velocity: a.st.vel });
    for (const [id, e] of this.gear) {
      const actor = actors.find(a => a.id === id);
      if (at - e.at > .9 && (!actor || actor.active)) { e.sale.clear(); this.group.remove(e.sale.group); this.gear.delete(id); }
      else {
        // Render the seeded gear on a fixed clock too, so packet arrival and FPS do not change its path.
        const age = Math.min(8, Math.max(0, at - e.at));
        while (e.elapsed + 1 / 120 <= age) { e.sale.update(1 / 120, (x, z) => g.probe.height(x, z)); e.elapsed += 1 / 120; }
      }
    }
    let n = 0;
    for (const [id, shot] of this.shots) {
      if (at - shot.at > SNOWBALL.life + .2) { this.shots.delete(id); continue; }
      for (let i = 0; i < 4 && n < SNOWBALL.max * 4; i++) {
        const p = snowballPosition(shot, at - i * .014), scale = i === 0 ? 1 : .28 - i * .04;
        this.dummy.position.set(p.x, p.y, p.z); this.dummy.scale.setScalar(scale); this.dummy.updateMatrix(); this.ball.setMatrixAt(n++, this.dummy.matrix);
      }
    }
    this.ball.count = n; if (n) this.ball.instanceMatrix.needsUpdate = true;
    this.powder.update(dt); this.pops.update(dt, g.camera);
    this.flashFor = Math.max(0, this.flashFor - dt); this.flash.style.opacity = String(Math.min(.6, this.flashFor * 2));
    const show = g.ready && g.input.enabled && !g.flyMode && actors[0].active;
    this.hud.hidden = !show; this.aim.hidden = true;
    if (show) {
      if (at - this.aimAt > .1) { this.aimAt = at; this.targetId = this.target(actors)?.id; }
      const target = actors.find(a => a.id === this.targetId && a.active), reload = SNOWBALL.cooldown - (at - this.throwAt);
      const label = reload > 0 ? 'Packing snow…' : target ? `Snowball · ${target.name}` : 'Snowball';
      if (label !== this.hudLabel) {
        this.hudLabel = label; this.hud.replaceChildren();
        const key = document.createElement('kbd'); key.textContent = 'Q';
        const detail = document.createElement('span'); detail.style.opacity = '.6'; detail.textContent = ' · right click / LB';
        this.hud.append(key, document.createTextNode(label), detail);
      }
      if (target) {
        const p = new THREE.Vector3(target.pos.x, target.pos.y + 1, target.pos.z).project(g.camera);
        this.aim.hidden = false; this.aim.style.left = `${(p.x * .5 + .5) * innerWidth}px`; this.aim.style.top = `${(-p.y * .5 + .5) * innerHeight}px`;
        this.aim.style.opacity = reload > 0 ? '.3' : '.9';
      }
    }
    const ids = new Set(actors.map(a => a.id));
    for (const id of this.seen.keys()) if (!ids.has(id)) this.seen.delete(id);
  }
}
