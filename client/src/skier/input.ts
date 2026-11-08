// Keyboard + gamepad input mapped to ski controls and actions.
import type { SkiInput } from '../../../shared/skiPhysics';

export interface Actions {
  getUp: boolean; camera: boolean; map: boolean; slope: boolean; skipLift: boolean; help: boolean;
  chat: boolean; respawn: boolean; mute: boolean;
}

export class InputManager {
  keys = new Set<string>();
  private pressed = new Set<string>();
  private padPrev: boolean[] = [];
  enabled = true;
  steerSmoothed = 0;

  constructor() {
    window.addEventListener('keydown', (e) => {
      if (!this.enabled || (e.target as HTMLElement)?.tagName === 'INPUT') return;
      if (['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Space'].includes(e.code)) e.preventDefault();
      if (!this.keys.has(e.code)) this.pressed.add(e.code);
      this.keys.add(e.code);
    });
    window.addEventListener('keyup', (e) => this.keys.delete(e.code));
    window.addEventListener('blur', () => this.keys.clear());
  }

  private pad(): Gamepad | null {
    const pads = navigator.getGamepads ? navigator.getGamepads() : [];
    for (const p of pads) if (p && p.connected) return p;
    return null;
  }

  ski(dt: number): SkiInput {
    const k = this.keys;
    let steer = 0, fwd = 0, back = 0;
    if (k.has('KeyA') || k.has('ArrowLeft')) steer -= 1;
    if (k.has('KeyD') || k.has('ArrowRight')) steer += 1;
    if (k.has('KeyW') || k.has('ArrowUp')) fwd = 1;
    if (k.has('KeyS') || k.has('ArrowDown')) back = 1;
    let stop = k.has('Space');
    const p = this.pad();
    let analog = false;
    if (p) {
      const ax = p.axes[0] ?? 0, ay = p.axes[1] ?? 0;
      if (Math.abs(ax) > 0.12) { steer = ax; analog = true; }
      if (ay < -0.3) fwd = 1;
      if (ay > 0.2) back = Math.min(1, (ay - 0.2) / 0.6);
      if (p.buttons[7]?.value > 0.2) back = Math.max(back, p.buttons[7].value); // RT brake
      if (p.buttons[6]?.value > 0.3) fwd = 1; // LT tuck
      if (p.buttons[0]?.pressed) stop = true;
    }
    // keyboard steering ramps in (weight shift takes time) so taps make small turns
    if (!analog) {
      const target = steer;
      const rate = target === 0 ? 6 : 3.5;
      this.steerSmoothed += (target - this.steerSmoothed) * Math.min(1, dt * rate);
      steer = this.steerSmoothed;
    } else this.steerSmoothed = steer;
    return { steer, tuck: fwd > 0, push: fwd > 0, plow: back, stop };
  }

  /** Edge-triggered actions since the last call. */
  actions(): Actions {
    const pr = this.pressed;
    const p = this.pad();
    const btn = (i: number) => {
      const now = !!p?.buttons[i]?.pressed;
      const was = this.padPrev[i] ?? false;
      this.padPrev[i] = now;
      return now && !was;
    };
    const a: Actions = {
      getUp: pr.has('KeyR') || btn(1),
      camera: pr.has('KeyC') || btn(3),
      map: pr.has('KeyM') || btn(8),
      slope: pr.has('KeyO') || btn(2),
      skipLift: pr.has('KeyF') || btn(5),
      help: pr.has('KeyH') || pr.has('Slash'),
      chat: pr.has('Enter') || pr.has('KeyT'),
      respawn: pr.has('KeyB') || btn(9),
      mute: pr.has('KeyN'),
    };
    pr.clear();
    return a;
  }
}
