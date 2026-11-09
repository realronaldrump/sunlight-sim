// Keyboard + gamepad input mapped to ski controls and actions.
import type { SkiInput } from '../../../shared/skiPhysics';
import { NO_DRONE_INPUT, type DroneInput } from '../../../shared/dronePhysics';

export interface Actions {
  getUp: boolean; camera: boolean; map: boolean; slope: boolean; fastLift: boolean; help: boolean;
  chat: boolean; mute: boolean; options: boolean; minimap: boolean; drone: boolean;
  skis: boolean;
}

export class InputManager {
  keys = new Set<string>();
  private pressed = new Set<string>();
  private padPrev: boolean[] = [];
  enabled = true;
  private focused = true;
  steerSmoothed = 0;

  constructor() {
    window.addEventListener('keydown', (e) => {
      const target = e.target as HTMLElement;
      if (target?.matches('input, textarea, select, [contenteditable="true"]')) return;
      if (['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Space'].includes(e.code)) e.preventDefault();
      if (!this.keys.has(e.code)) this.pressed.add(e.code);
      this.keys.add(e.code);
    });
    window.addEventListener('keyup', (e) => this.keys.delete(e.code));
    window.addEventListener('blur', () => { this.focused = false; this.clear(); });
    window.addEventListener('focus', () => { this.focused = true; });
    document.addEventListener('visibilitychange', () => { if (document.hidden) this.clear(); });
  }

  clear() { this.keys.clear(); this.pressed.clear(); this.steerSmoothed = 0; }

  private pad(): Gamepad | null {
    const pads = navigator.getGamepads ? navigator.getGamepads() : [];
    for (const p of pads) if (p && p.connected) return p;
    return null;
  }

  ski(dt: number): SkiInput {
    if (!this.enabled || !this.focused) return { steer: 0, tuck: false, push: false, plow: 0, stop: true };
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

  /** On foot: camera-relative walking. Shift (or the right bumper) jogs. */
  walk() {
    if (!this.enabled || !this.focused) return { forward: 0, right: 0, run: false };
    const k = this.keys, p = this.pad();
    let forward = Number(k.has('KeyW') || k.has('ArrowUp')) - Number(k.has('KeyS') || k.has('ArrowDown'));
    let right = Number(k.has('KeyD') || k.has('ArrowRight')) - Number(k.has('KeyA') || k.has('ArrowLeft'));
    if (p) {
      const ax = p.axes[0] ?? 0, ay = p.axes[1] ?? 0;
      if (Math.abs(ax) > 0.14) right = ax;
      if (Math.abs(ay) > 0.14) forward = -ay;
    }
    return { forward, right, run: k.has('ShiftLeft') || k.has('ShiftRight') || !!p?.buttons[5]?.pressed };
  }

  drone(): DroneInput {
    if (!this.enabled || !this.focused || document.hidden) return { ...NO_DRONE_INPUT, brake: true };
    const k = this.keys, p = this.pad();
    const dead = (v = 0) => Math.abs(v) < .14 ? 0 : Math.sign(v)*(Math.abs(v)-.14)/.86;
    const key = (code: string) => Number(k.has(code));
    return {
      forward: key('KeyW')-key('KeyS')-dead(p?.axes[1]), right: key('KeyD')-key('KeyA')+dead(p?.axes[0]),
      up: key('KeyE')-key('KeyQ')+(p?.buttons[7]?.value ?? 0)-(p?.buttons[6]?.value ?? 0),
      yaw: key('ArrowLeft')-key('ArrowRight')-dead(p?.axes[2]),
      pitch: key('ArrowUp')-key('ArrowDown')-dead(p?.axes[3]),
      fast: k.has('ShiftLeft') || k.has('ShiftRight') || !!p?.buttons[5]?.pressed,
      precision: k.has('ControlLeft') || k.has('ControlRight') || !!p?.buttons[4]?.pressed,
      brake: k.has('Space') || !!p?.buttons[0]?.pressed,
    };
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
      minimap: pr.has('KeyV'),
      slope: pr.has('KeyO') || btn(2),
      fastLift: pr.has('KeyF'),
      help: pr.has('KeyH') || pr.has('Slash'),
      chat: pr.has('Enter') || pr.has('KeyT'),
      mute: pr.has('KeyN'),
      options: pr.has('KeyP') || pr.has('Escape') || btn(9),
      drone: pr.has('KeyG') || btn(10),
      skis: pr.has('KeyK') || btn(11),
    };
    pr.clear();
    return a;
  }
}
