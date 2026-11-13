import * as THREE from 'three/webgpu';
import type { Game } from '../game';
import { WORLD_BASE } from '../game';
import { nearestRoutePosition, routeDistance, type MapRoute, type SharedRoute, type SkiRoute } from '../../../shared/skiNavigation';
import type { Point } from '../../../shared/mountainGuestNavigation';
import type { RouteRequest, RouteResponse } from './routeWorker';
import { liftsOpen } from '../world/resortDay';
import { formatDistance } from '../ui/units';
import { ROUTE_COLORS } from '../ui/routeDrawing';
import { DIFF_LABEL } from '../ui/hud';

const css = `
#route-guide { position:fixed; top:65px; left:50%; transform:translateX(-50%); width:320px; box-sizing:border-box; z-index:11; background:rgba(8,25,39,.93); border:1px solid #477080; border-radius:12px; padding:12px 14px; box-shadow:0 4px 20px #0003; }
#route-guide[hidden], #tmap .route-panel [hidden] { display:none; }
#route-guide strong { display:block; font-size:15px; margin-bottom:5px; }
#route-guide small { display:block; color:#c5dbe4; font-size:12px; line-height:1.5; }
#route-guide button, #tmap .route-panel button { color:#fff; font:600 12px -apple-system,sans-serif; background:#234354; border:1px solid #4f7483; border-radius:6px; padding:7px 9px; cursor:pointer; }
#route-guide .route-tools { display:flex; gap:8px; margin-top:9px; }
#tmap .route-panel { position:absolute; left:16px; top:110px; width:278px; max-height:calc(100vh - 145px); overflow:auto; box-sizing:border-box; background:rgba(8,25,39,.95); border:1px solid #477080; border-radius:12px; padding:14px; font-size:12px; line-height:1.5; }
#tmap .route-panel h3 { margin:0 0 7px; font-size:16px; }
#tmap .route-panel p { margin:7px 0; color:#c5dbe4; }
#tmap .route-panel ol { padding-left:22px; margin:10px 0; max-height:30vh; overflow:auto; }
#tmap .route-panel li { padding:3px 0; }
#tmap .route-panel .route-key { font-size:11px; }
#tmap .route-panel .friend-pins { display:flex; flex-wrap:wrap; gap:6px; margin-top:8px; }
@media(max-width:700px) {
 #route-guide { top:70px; width:260px; }
 #tmap .route-panel { top:auto; bottom:12px; left:12px; width:calc(100% - 24px); max-height:34vh; }
 #tmap .route-panel ol { max-height:12vh; }
 #tmap .legend { display:none; }
 #tmap .title span { display:none; }
 #tmap .title { top:55px; left:54px; font-size:15px; }
}
`;

/** One pin per participant. Planning stays in a worker, independent of render LOD. */
export class NavigationGuide {
  destination: Point | null = null;
  route: SkiRoute | null = null;
  status = '';
  planning = false;
  arrived = false;
  legIndex = 0;
  readonly group = new THREE.Group();
  private worker?: Worker;
  private requestId = 0;
  private elapsed = 0;
  private lastPlan = -Infinity;
  private previousRide: number | undefined;
  private previousOpen = true;
  private panel = document.createElement('section');
  private hud = document.createElement('section');
  private summary: HTMLElement;
  private directions: HTMLOListElement;
  private friends: HTMLElement;
  private hudTitle: HTMLElement;
  private hudDetail: HTMLElement;
  private friendSignature = '';
  private material = new THREE.MeshBasicMaterial({ vertexColors: true, transparent: true, opacity: .85, depthWrite: false, side: THREE.DoubleSide });
  private geometry = new THREE.BufferGeometry();
  private positions = new Float32Array(18000 * 3);
  private colors = new Float32Array(18000 * 3);
  private ribbon = new THREE.Mesh(this.geometry, this.material);
  private pins = new Map<string, THREE.Sprite>();

  constructor(private game: Game) {
    const style = document.createElement('style'); style.textContent = css; document.head.appendChild(style);
    this.panel.className = 'route-panel'; this.panel.setAttribute('aria-label', 'Route planner');
    this.panel.innerHTML = `<h3>Find your way</h3><button type="button" class="plan-pin">Drop a pin</button>
      <p class="route-summary" role="status">Click the map to plan a ski route. Lifts are included when needed.</p>
      <p class="route-key"><span style="color:#00d6ed">━━ Ski</span> &nbsp; <span style="color:#cc9cff">┄ Lift</span> &nbsp; <span style="color:#ffbc65">·· Walk</span></p>
      <ol aria-label="Route steps"></ol><button type="button" class="clear-route" hidden>Clear pin</button>
      <p>In a room, everyone can see your pin and route.</p><div class="friend-pins"></div>`;
    document.querySelector('#tmap')!.appendChild(this.panel);
    this.summary = this.panel.querySelector('.route-summary')!;
    this.directions = this.panel.querySelector('ol')!;
    this.friends = this.panel.querySelector('.friend-pins')!;
    (this.panel.querySelector('.plan-pin') as HTMLButtonElement).onclick = () => {
      this.game.trailMap.enablePinMode(); this.summary.textContent = 'Click a destination on the map.';
    };
    (this.panel.querySelector('.clear-route') as HTMLButtonElement).onclick = () => this.clear();
    this.hud.id = 'route-guide'; this.hud.hidden = true; this.hud.setAttribute('aria-label', 'Route guidance');
    this.hud.innerHTML = `<strong></strong><small></small><div class="route-tools"><button type="button">View route (M)</button><button type="button">Clear pin</button></div>`;
    document.body.appendChild(this.hud);
    this.hudTitle = this.hud.querySelector('strong')!; this.hudDetail = this.hud.querySelector('small')!;
    this.hud.querySelectorAll('button')[0].onclick = () => this.game.trailMap.toggle(true);
    this.hud.querySelectorAll('button')[1].onclick = () => this.clear();
    for (const el of [this.hud, this.panel]) el.addEventListener('click', e => {
      if (e.detail > 0 && e.target instanceof HTMLElement) e.target.closest('button')?.blur();
    });
    this.geometry.setAttribute('position', new THREE.BufferAttribute(this.positions, 3).setUsage(THREE.DynamicDrawUsage));
    this.geometry.setAttribute('color', new THREE.BufferAttribute(this.colors, 3).setUsage(THREE.DynamicDrawUsage));
    this.geometry.setDrawRange(0, 0); this.ribbon.frustumCulled = false;
    this.group.name = 'route-guidance'; this.group.add(this.ribbon);
    this.game.scene.add(this.group);
    this.game.trailMap.onPin = point => this.setPin(point);
  }

  get shared(): SharedRoute | null { return this.destination ? { destination: this.destination, route: this.route } : null; }
  private get position() { return this.game.droneOnly ? (this.game.drone.state?.pos ?? this.game.player.st.pos) : this.game.player.st.pos; }

  setPin(point: Point) {
    if (![point.x, point.z].every(Number.isFinite)) return;
    // The existing flight boundary uses the actual resort polygon with no apron here.
    if (!this.game.drone.area.contains(point.x, point.z)) { this.summary.textContent = 'Choose a point inside the ski area.'; return; }
    this.destination = { x: point.x, z: point.z }; this.route = null; this.arrived = false; this.legIndex = 0;
    this.publish(); this.plan();
  }

  clear() {
    ++this.requestId; this.destination = null; this.route = null; this.planning = false; this.arrived = false;
    this.status = ''; this.hud.hidden = true; this.publish(); this.refreshPanel();
  }

  private publish() { this.game.net?.shareRoute(this.shared); }

  private plan() {
    if (!this.destination) return;
    this.planning = true; this.status = 'Finding a route over the snow…';
    this.lastPlan = performance.now();
    this.previousRide = this.game.player.ride?.lift;
    this.previousOpen = liftsOpen(this.game.clockMode, this.game.env.hour);
    if (!this.worker) {
      this.worker = new Worker(new URL('./routeWorker.ts', import.meta.url), { type: 'module' });
      this.worker.onmessage = ({ data }: MessageEvent<RouteResponse>) => {
        if (data.id !== this.requestId || !this.destination) return;
        this.planning = false; this.route = data.route; this.legIndex = 0;
        this.status = data.error ? 'Terrain could not load. Drop the pin again to retry.' : data.route ? '' :
          'No passable route to this point. Try open snow nearby.';
        this.publish(); this.refreshPanel();
      };
      this.worker.onerror = () => {
        this.planning = false; this.status = 'Route planning stopped. Drop the pin again to retry.';
        this.worker?.terminate(); this.worker = undefined; this.refreshPanel();
      };
    }
    const message: RouteRequest = { id: ++this.requestId, base: WORLD_BASE, resort: { ...this.game.resort, boundary: this.game.resort.boundary! },
      from: { x: this.position.x, z: this.position.z }, destination: this.destination,
      liftsOpen: this.previousOpen, riding: this.game.droneOnly ? undefined : this.previousRide };
    this.worker.postMessage(message); this.refreshPanel();
  }

  mapRoutes(): MapRoute[] {
    const net = this.game.net, routes: MapRoute[] = [];
    if (net?.connected) for (const [id, route] of net.routes) {
      const friend = net.remotes.get(id);
      if (friend) routes.push({ ...route, id, name: friend.name, color: friend.color });
    }
    if (this.destination) routes.push({ destination: this.destination, route: this.route, id: 'self', name: 'You', color: ROUTE_COLORS.ski, self: true });
    return routes;
  }

  private refreshPanel() {
    (this.panel.querySelector('.clear-route') as HTMLElement).hidden = !this.destination;
    this.summary.textContent = this.status || (this.arrived ? 'You reached your pin.' : this.route ?
      `${formatDistance(this.route.distance)} · ${this.route.legs.filter(l => l.mode === 'lift').length} lifts · ${this.route.walking > 1 ? `${formatDistance(this.route.walking)} on foot where needed` : 'Stay on skis'}` :
      'Click the map to plan a ski route. Lifts are included when needed.');
    this.directions.replaceChildren();
    for (const leg of this.route?.legs ?? []) {
      if (leg.distance < 1 && leg.mode !== 'lift') continue;
      const li = document.createElement('li'); li.style.color = ROUTE_COLORS[leg.mode];
      li.textContent = `${leg.mode === 'lift' ? 'Ride' : leg.mode === 'walk' ? 'Walk' : 'Ski'} ${leg.name}${leg.difficulty ? ` (${DIFF_LABEL[leg.difficulty] ?? leg.difficulty})` : ''} · ${formatDistance(leg.distance)}`;
      this.directions.appendChild(li);
    }
    this.game.trailMap.routes = this.mapRoutes();
    this.game.trailMap.draw();
  }

  update(dt: number) {
    const game = this.game;
    this.hud.hidden = !this.destination || !game.ready || game.trailMap.visible || game.options.visible;
    this.elapsed += dt;
    if (this.elapsed < .25) return;
    this.elapsed = 0;
    const pos = this.position, ride = game.player.ride?.lift, open = liftsOpen(game.clockMode, game.env.hour);
    if (this.destination && !this.arrived && !this.planning) {
      if (ride !== this.previousRide || open !== this.previousOpen) this.plan();
      else if (this.route && !game.player.ride && routeDistance(pos, this.destination) < 7 && Math.abs(pos.y - game.probe.height(this.destination.x, this.destination.z)) < 5) {
        this.arrived = true; this.route = { destination: this.destination, legs: [], distance: 0, walking: 0, seconds: 0 };
        this.publish(); this.refreshPanel();
      } else if (this.route && ride === undefined) {
        const near = nearestRoutePosition(this.route, pos, this.legIndex);
        if (near.distance < 22) this.legIndex = near.leg;
        if (near.distance > 32 && performance.now() - this.lastPlan > 5000) this.plan();
      }
    }
    const leg = this.route?.legs[this.legIndex];
    let title = this.status, detail = 'Your pin is shared with everyone in this room.';
    if (this.arrived) { title = 'You reached your pin'; detail = 'Drop another pin to keep exploring.'; }
    else if (!this.planning && leg) {
      if (ride !== undefined) { title = `Ride ${game.lifts.paths[ride].def.name}`; detail = 'Stay on the chair. Stand up on the unload ramp at the top.'; }
      else if (leg.mode === 'lift') { title = `Board ${leg.name}`; detail = 'Glide to the load line, face uphill and wait for a chair.'; }
      else {
        const near = nearestRoutePosition(this.route!, pos, this.legIndex), next = this.route!.legs[near.leg + 1];
        title = `${leg.mode === 'walk' ? 'Walk' : game.onFoot.active ? 'Click into your skis for' : 'Ski'} ${leg.name}`;
        detail = `${formatDistance(near.remaining)}${next?.mode === 'lift' ? ` to ${next.name} lift` : ' along this section'}. ` +
          (leg.mode === 'walk' ? 'Short uphill or hike connection. K takes your skis off.' : leg.difficulty ? DIFF_LABEL[leg.difficulty] ?? '' : 'Follow the cyan line.');
        if (next?.mode === 'lift' && near.remaining < 12) { title = `Board ${next.name}`; detail = 'Glide to the load line, face uphill and wait for a chair.'; }
      }
    }
    if (game.droneOnly && this.destination && !this.status) detail = 'Ski route from the snow below your drone. Friends can route to your pin.';
    if (!game.net) detail = detail.replace('Your pin is shared with everyone in this room.', 'Lifts and walking sections are marked on the map.');
    this.hudTitle.textContent = title || 'Route to your pin'; this.hudDetail.textContent = detail;
    const routes = this.mapRoutes();
    const signature = routes.filter(r => !r.self).map(r => `${r.id}/${r.destination.x}/${r.destination.z}`).join('|');
    if (signature !== this.friendSignature) {
      this.friendSignature = signature; this.friends.replaceChildren();
      for (const r of routes.filter(r => !r.self)) {
        const button = document.createElement('button'); button.type = 'button'; button.textContent = `Route to ${r.name}’s pin`;
        button.onclick = () => { game.trailMap.enablePinMode(); this.setPin(r.destination); };
        this.friends.appendChild(button);
      }
    }
    this.drawWorld(routes);
  }

  private drawWorld(routes: MapRoute[]) {
    const camera = this.game.camera.position, height = (x: number, z: number) => this.game.probe.height(x, z) + .16;
    let vertex = 0;
    const color = new THREE.Color();
    for (const route of routes) {
      for (const leg of route.route?.legs ?? []) {
        if (leg.mode === 'lift') continue;
        color.set(route.self ? ROUTE_COLORS[leg.mode] : route.color);
        for (let i = 1; i < leg.points.length; i++) {
          const a = leg.points[i - 1], b = leg.points[i], len = routeDistance(a, b);
          if (Math.min(routeDistance(camera, a), routeDistance(camera, b)) > 160) continue;
          const steps = Math.max(1, Math.ceil(len / 2));
          for (let j = 0; j < steps && vertex + 6 < this.positions.length / 3; j++) {
            if (leg.mode === 'walk' && j % 2) continue;
            const t = j / steps, u = (j + 1) / steps, w = route.self ? .24 : .13;
            const dx = (b.z - a.z) / (len || 1) * w, dz = -(b.x - a.x) / (len || 1) * w;
            const x = a.x + (b.x - a.x) * t, z = a.z + (b.z - a.z) * t;
            const bx = a.x + (b.x - a.x) * u, bz = a.z + (b.z - a.z) * u;
            for (const [px, pz] of [[x - dx, z - dz], [x + dx, z + dz], [bx - dx, bz - dz], [x + dx, z + dz], [bx + dx, bz + dz], [bx - dx, bz - dz]]) {
              this.positions.set([px, height(px, pz), pz], vertex * 3); this.colors.set([color.r, color.g, color.b], vertex * 3); vertex++;
            }
          }
        }
      }
      let pin = this.pins.get(route.id);
      const label = route.self ? 'Your pin' : `${route.name}’s pin`;
      if (!pin || pin.userData.label !== label) {
        if (pin) this.removePin(route.id, pin);
        const canvas = document.createElement('canvas'); canvas.width = 384; canvas.height = 160;
        const g = canvas.getContext('2d')!;
        g.fillStyle = '#102537ee'; g.beginPath(); g.roundRect(4, 4, 376, 70, 18); g.fill();
        g.font = 'bold 28px -apple-system,sans-serif'; g.fillStyle = '#fff'; g.textAlign = 'center'; g.fillText(label, 192, 50, 360);
        g.fillStyle = route.color; g.beginPath(); g.arc(192, 100, 22, 0, Math.PI * 2); g.fill();
        g.beginPath(); g.moveTo(174, 110); g.lineTo(192, 153); g.lineTo(210, 110); g.fill();
        const texture = new THREE.CanvasTexture(canvas); texture.colorSpace = THREE.SRGBColorSpace;
        pin = new THREE.Sprite(new THREE.SpriteMaterial({ map: texture, depthTest: true, depthWrite: false, transparent: true }));
        pin.userData.label = label; this.pins.set(route.id, pin); this.group.add(pin);
      }
      const d = routeDistance(camera, route.destination), size = Math.max(3.5, Math.min(12, d * .045));
      pin.scale.set(size * 2.4, size, 1);
      pin.position.set(route.destination.x, height(route.destination.x, route.destination.z) + size / 2, route.destination.z);
      pin.visible = d < 700;
    }
    for (const [id, pin] of this.pins) if (!routes.some(r => r.id === id)) this.removePin(id, pin);
    this.geometry.setDrawRange(0, vertex);
    this.geometry.attributes.position.needsUpdate = true; this.geometry.attributes.color.needsUpdate = true;
  }
  private removePin(id: string, pin: THREE.Sprite) { this.group.remove(pin); pin.material.map?.dispose(); pin.material.dispose(); this.pins.delete(id); }
}
