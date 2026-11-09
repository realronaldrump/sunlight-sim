import type { FlightPace } from '../../../shared/droneNavigation';

interface TouchActions {
  map(): void; options(): void; chat(): void; camera(): void; home(): void; hold(): void;
  fly(x: number, y: number): void; pace(pace: FlightPace): void;
}

/** Tap a destination; drag the scene to look. No virtual sticks or persistent held movement. */
export class TouchControls {
  readonly root = document.createElement('section');
  private enabled = false;
  private pointer: { id: number; x: number; y: number; startX: number; startY: number; at: number; dragged: boolean } | null = null;
  private look = { x: 0, y: 0 };
  private status: HTMLElement;
  private help: HTMLElement;
  private flightStatus: HTMLElement;
  private marker: HTMLElement;
  private focused = true;

  constructor(private canvas: HTMLElement, private actions: TouchActions) {
    this.root.id = 'touch-flight'; this.root.hidden = true;
    this.root.setAttribute('aria-label', 'Touch drone controls');
    this.root.innerHTML = `<nav class="flight-toolbar" aria-label="Flight tools">
      <button id="touch-map" type="button">Map</button><button id="touch-view" type="button">View</button>
      <button id="touch-chat" type="button">Chat</button><button id="touch-options" type="button">Options</button>
      <button id="touch-help" type="button" aria-label="Flight help" aria-expanded="false">?</button></nav>
      <div class="flight-connection" role="status">Solo flight</div>
      <div class="flight-help" hidden><strong>Tap to fly. Drag to look.</strong><p>Tap the mountain to fly above that spot.<br>Tap the sky to climb toward it.<br>Drag the scenery to look around. Dragging pauses your flight.</p><p>The marker shows your destination.<br>Tap Hold to stop, or Home to return.<br>Use Map to visit a run or a friend.</p><button type="button">Got it</button></div>
      <div id="flight-marker" hidden aria-hidden="true"><span>◎</span><b>DESTINATION</b></div>
      <div class="flight-bottom"><div id="touch-flight-status" role="status">Hovering</div>
        <div class="flight-actions"><select id="touch-speed" aria-label="Flight speed"><option value="gentle">Gentle</option><option value="cruise">Cruise</option><option value="fast">Fast</option></select><button id="touch-hold" type="button">Hold</button><button id="touch-home" type="button">Home</button></div>
        <div class="flight-tip">Tap a destination · Drag to look</div></div>`;
    document.body.append(this.root);
    this.status = this.root.querySelector('.flight-connection')!;
    this.help = this.root.querySelector('.flight-help')!;
    this.flightStatus = this.root.querySelector('#touch-flight-status')!;
    this.marker = this.root.querySelector('#flight-marker')!;
    const bind = (id: string, action: () => void) => {
      this.root.querySelector<HTMLButtonElement>(id)!.onclick = () => { this.reset(); action(); };
    };
    bind('#touch-map', actions.map); bind('#touch-view', actions.camera); bind('#touch-chat', actions.chat);
    bind('#touch-options', actions.options); bind('#touch-home', actions.home); bind('#touch-hold', actions.hold);
    bind('#touch-help', () => {
      this.help.hidden = !this.help.hidden;
      this.root.querySelector('#touch-help')!.setAttribute('aria-expanded', String(!this.help.hidden)); actions.hold();
    });
    this.help.querySelector('button')!.onclick = () => { this.help.hidden = true; this.root.querySelector('#touch-help')!.setAttribute('aria-expanded', 'false'); };
    this.root.querySelector<HTMLSelectElement>('#touch-speed')!.onchange = e => actions.pace((e.target as HTMLSelectElement).value as FlightPace);
    canvas.addEventListener('pointerdown', e => {
      if (!this.enabled || !this.focused || !this.help.hidden || e.button !== 0) return;
      e.preventDefault();
      // A second finger cancels a gesture instead of accidentally setting a destination.
      if (this.pointer) { this.reset(); actions.hold(); return; }
      this.pointer = {id:e.pointerId,x:e.clientX,y:e.clientY,startX:e.clientX,startY:e.clientY,at:performance.now(),dragged:false};
      try { canvas.setPointerCapture(e.pointerId); } catch { /* Synthetic test pointer. */ }
    });
    canvas.addEventListener('contextmenu', e => { e.preventDefault(); this.reset(); actions.hold(); });
    window.addEventListener('pointermove', e => {
      const p = this.pointer; if (!p || p.id !== e.pointerId || !this.enabled) return;
      e.preventDefault();
      if (!p.dragged && Math.hypot(e.clientX-p.startX,e.clientY-p.startY) > 7) { p.dragged = true; actions.hold(); }
      if (p.dragged) { this.look.x += e.clientX-p.x; this.look.y += e.clientY-p.y; }
      p.x=e.clientX; p.y=e.clientY;
    }, {passive:false});
    window.addEventListener('pointerup', e => {
      const p = this.pointer; if (!p || p.id !== e.pointerId) return;
      const tapped = !p.dragged && Math.hypot(e.clientX-p.startX,e.clientY-p.startY) < 8 && performance.now()-p.at < 600;
      this.release();
      if (tapped && this.enabled && this.focused && this.help.hidden) actions.fly(e.clientX,e.clientY);
    });
    for (const event of ['pointercancel','lostpointercapture']) canvas.addEventListener(event, e => {
      if (this.pointer?.id !== (e as PointerEvent).pointerId) return;
      this.reset(); actions.hold();
    });
    window.addEventListener('blur', () => { this.focused = false; this.reset(); actions.hold(); });
    window.addEventListener('focus', () => { this.focused = true; });
    window.addEventListener('pagehide', () => { this.reset(); actions.hold(); });
    document.addEventListener('visibilitychange', () => { this.reset(); actions.hold(); });
    window.addEventListener('resize', () => { this.reset(); actions.hold(); });
    window.visualViewport?.addEventListener('resize', () => { this.reset(); actions.hold(); });
  }

  private release() { const p=this.pointer; this.pointer=null; if(p && this.canvas.hasPointerCapture(p.id)) this.canvas.releasePointerCapture(p.id); }
  reset() { this.release(); this.look = {x:0,y:0}; }
  update(visible: boolean, enabled: boolean, connection: string, canChat: boolean) {
    this.root.hidden = !visible;
    const next = enabled && this.focused && !document.hidden;
    if (this.enabled && !next) { this.reset(); this.actions.hold(); }
    this.enabled = next;
    if (this.status.textContent !== connection) this.status.textContent = connection;
    this.root.querySelector<HTMLButtonElement>('#touch-chat')!.disabled = !canChat;
  }
  get canFly() { return this.enabled && this.help.hidden; }
  showDestination(point: {x:number;y:number} | null, status: string) {
    this.marker.hidden = !point;
    if (point) { this.marker.style.left=`${point.x}px`; this.marker.style.top=`${point.y}px`; }
    if (this.flightStatus.textContent !== status) this.flightStatus.textContent=status;
  }
  consumeLook(dt: number) {
    const k=1-Math.exp(-Math.min(.1,dt)/.045), delta={x:this.look.x*k,y:this.look.y*k};
    this.look.x-=delta.x; this.look.y-=delta.y; return delta;
  }
}
