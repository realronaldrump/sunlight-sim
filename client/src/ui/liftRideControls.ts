import { LIFT_SPEEDS, type LiftSpeed } from '../../../shared/liftClock';

export class LiftRideControls {
  private root = document.createElement('section');
  private label: HTMLElement;
  private buttons: HTMLButtonElement[];
  onSpeed?: (speed: LiftSpeed) => void;
  constructor() {
    const style = document.createElement('style');
    style.textContent = `#lift-ride-controls { position:fixed; bottom:156px; left:50%; transform:translateX(-50%); z-index:12; display:flex; flex-wrap:wrap; justify-content:center; align-items:center; gap:10px 16px; padding:11px 14px; border:1px solid #97c5cf70; border-radius:10px; background:rgba(8,23,36,.93); font-size:13px; white-space:nowrap; max-width:calc(100vw - 50px); } #lift-ride-controls[hidden] { display:none; } #lift-speed-options { display:flex; align-items:center; gap:4px; } #lift-speed-options .speed-caption { font-size:11px; color:#b9d2dc; margin-right:4px; } #lift-speed-options button { color:#fff; background:#1b3545; border:1px solid #97c5cf70; border-radius:6px; min-width:38px; padding:8px 9px; cursor:pointer; font:600 12px -apple-system,sans-serif; } #lift-speed-options button:hover { background:#365969; } #lift-speed-options button:focus-visible { outline:2px solid #80e9ff; outline-offset:2px; } #lift-speed-options button[aria-pressed=true] { background:#286960; border-color:#80e9da; } #lift-speed-options kbd { color:#b9d2dc; margin-left:5px; font:11px -apple-system,sans-serif; } @media(max-width:600px) { #lift-ride-controls { bottom:152px; width:max-content; } }`;
    document.head.append(style);
    this.root.id = 'lift-ride-controls'; this.root.hidden = true;
    this.root.setAttribute('aria-label', 'Lift ride controls');
    this.label = document.createElement('span'); this.label.id = 'lift-countdown';
    const group = document.createElement('div'); group.id = 'lift-speed-options';
    group.setAttribute('role', 'group'); group.setAttribute('aria-label', 'Lift speed');
    const caption = document.createElement('span'); caption.className = 'speed-caption'; caption.textContent = 'Lift speed'; group.append(caption);
    this.buttons = LIFT_SPEEDS.map(speed => {
      const button = document.createElement('button'); button.type = 'button'; button.id = `lift-speed-${speed}`;
      button.textContent = `${speed}×`; button.setAttribute('aria-label', `${speed}× lift speed`);
      button.setAttribute('aria-pressed', String(speed === 1));
      button.onclick = () => this.onSpeed?.(speed);
      button.addEventListener('click', event => { if (event.detail > 0) button.blur(); });
      group.append(button); return button;
    });
    const shortcut = document.createElement('kbd'); shortcut.textContent = 'F'; shortcut.title = 'Cycle lift speed'; group.append(shortcut);
    this.root.append(this.label, group); document.body.append(this.root);
  }
  update(name: string | null, seconds: number, rate: number, visible: boolean, available: boolean, room: boolean) {
    this.root.hidden = !name || !visible;
    if (!name) return;
    const remaining = Math.ceil(Math.max(0, seconds) / rate);
    const label = `${name} · ${Math.floor(remaining / 60)}:${String(remaining % 60).padStart(2, '0')} to top`;
    if (this.label.textContent !== label) this.label.textContent = label;
    this.buttons.forEach((button, i) => {
      button.setAttribute('aria-pressed', String(rate === LIFT_SPEEDS[i])); button.disabled = !available;
      button.title = !available ? 'Waiting for lift connection' : room ? 'Changes this lift for everyone riding it. The world stays at normal speed.' : 'Only this lift changes speed';
    });
  }
}
