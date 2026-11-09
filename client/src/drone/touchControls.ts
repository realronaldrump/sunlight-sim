import { directFlightInput } from '../../../shared/droneTouch';

interface TouchActions {
  hold(): void;
  allowed(): boolean;
}

interface Contact {
  id: number;
  x: number;
  y: number;
  startedAt: number;
  travel: number;
}

const CHORD_MS = 120;
const AIM_DISTANCE = 6;

export class TouchControls {
  private enabled = false;
  private focused = true;
  private aim: Contact | null = null;
  private throttle: (Contact & { direction: -1 | 1 }) | null = null;
  private look = { x: 0, y: 0 };

  constructor(private canvas: HTMLElement, private actions: TouchActions) {
    canvas.addEventListener('pointerdown', event => {
      if (event.pointerType !== 'touch' || !this.allowed || this.throttle || this.contact(event.pointerId)) return;
      event.preventDefault();
      const contact = { id: event.pointerId, x: event.clientX, y: event.clientY, startedAt: event.timeStamp, travel: 0 };
      if (this.aim) {
        const together = contact.startedAt - this.aim.startedAt <= CHORD_MS && this.aim.travel < AIM_DISTANCE;
        this.throttle = { ...contact, direction: together ? -1 : 1 };
      } else this.aim = contact;
      try { canvas.setPointerCapture(contact.id); } catch { /* Pointer already ended. */ }
    });
    canvas.addEventListener('contextmenu', event => event.preventDefault());
    window.addEventListener('pointermove', event => {
      const contact = this.contact(event.pointerId);
      if (!contact || !this.allowed) return;
      event.preventDefault();
      if (contact === this.aim) {
        const dx = event.clientX - contact.x;
        const dy = event.clientY - contact.y;
        contact.travel += Math.hypot(dx, dy);
        this.look.x += dx;
        this.look.y += dy;
      }
      contact.x = event.clientX;
      contact.y = event.clientY;
    }, { passive: false });
    window.addEventListener('pointerup', event => {
      const contact = this.contact(event.pointerId);
      if (!contact) return;
      // One finger always aims. Promote the remaining contact without a jump.
      if (contact === this.aim) this.aim = this.throttle;
      if (this.aim) this.aim.travel = Math.max(this.aim.travel, AIM_DISTANCE);
      this.throttle = null;
    });
    const cancelContact = (event: PointerEvent) => {
      if (this.contact(event.pointerId)) this.stop();
    };
    window.addEventListener('pointercancel', cancelContact);
    canvas.addEventListener('lostpointercapture', cancelContact);
    window.addEventListener('blur', () => { this.focused = false; this.stop(); });
    window.addEventListener('focus', () => { this.focused = true; });
    window.addEventListener('pagehide', () => this.stop());
    document.addEventListener('visibilitychange', () => this.stop());
    window.addEventListener('resize', () => this.stop());
    window.visualViewport?.addEventListener('resize', () => this.stop());
  }

  private contact(id: number) {
    if (this.aim?.id === id) return this.aim;
    if (this.throttle?.id === id) return this.throttle;
    return null;
  }

  private get allowed() {
    return this.focused && !document.hidden && this.actions.allowed();
  }

  reset() {
    const contacts = [this.aim, this.throttle];
    this.aim = this.throttle = null;
    this.look = { x: 0, y: 0 };
    for (const contact of contacts) {
      if (contact && this.canvas.hasPointerCapture(contact.id)) this.canvas.releasePointerCapture(contact.id);
    }
  }

  private stop() {
    this.reset();
    this.actions.hold();
  }

  update(enabled: boolean) {
    if (this.enabled && !enabled) this.stop();
    this.enabled = enabled;
  }

  get direction() {
    return this.allowed ? this.throttle?.direction ?? 0 : 0;
  }

  input(pitch: number) {
    return directFlightInput(this.direction, pitch);
  }

  consumeLook(dt: number) {
    const amount = 1 - Math.exp(-Math.min(.1, dt) / .045);
    const delta = { x: this.look.x * amount, y: this.look.y * amount };
    this.look.x -= delta.x;
    this.look.y -= delta.y;
    return delta;
  }
}
