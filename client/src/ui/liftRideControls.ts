export class LiftRideControls {
  private root = document.createElement('section');
  private label: HTMLElement;
  private button: HTMLButtonElement;
  onToggle?: () => void;
  constructor() {
    const style = document.createElement('style');
    style.textContent = `#lift-ride-controls { position:fixed; bottom:156px; left:50%; transform:translateX(-50%); z-index:12; display:flex; align-items:center; gap:14px; padding:10px 14px; border:1px solid #97c5cf70; border-radius:10px; background:rgba(8,23,36,.9); font-size:13px; white-space:nowrap; } #lift-ride-controls[hidden] { display:none; } #lift-ride-controls button { color:#fff; background:#244759; border:1px solid #97c5cf; border-radius:7px; padding:9px 12px; cursor:pointer; } #lift-ride-controls button:focus-visible { outline:2px solid #80e9ff; outline-offset:3px; } #lift-ride-controls button[aria-pressed=true] { background:#286960; } @media(max-width:600px) { #lift-ride-controls { max-width:calc(100vw - 50px); white-space:normal; bottom:152px; } }`;
    document.head.append(style);
    this.root.id = 'lift-ride-controls'; this.root.hidden = true;
    this.root.setAttribute('aria-label', 'Lift ride controls');
    this.label = document.createElement('span'); this.label.id = 'lift-countdown';
    this.button = document.createElement('button'); this.button.type = 'button'; this.button.id = 'lift-fast-forward';
    this.button.onclick = () => this.onToggle?.();
    this.root.append(this.label, this.button); document.body.append(this.root);
  }
  update(name: string | null, seconds: number, rate: number, requested: boolean, visible: boolean, available: boolean, room: boolean) {
    this.root.hidden = !name || !visible;
    if (!name) return;
    const remaining = Math.ceil(Math.max(0, seconds) / rate);
    const label = `${name} · ${Math.floor(remaining / 60)}:${String(remaining % 60).padStart(2, '0')} to top · ${rate}×`;
    if (this.label.textContent !== label) this.label.textContent = label;
    const text = requested ? 'Lift speed: 1× · F' : 'Lift speed: 8× · F';
    if (this.button.textContent !== text) this.button.textContent = text;
    this.button.setAttribute('aria-pressed', String(requested)); this.button.disabled = !available;
    this.button.title = !available ? 'Waiting for lift connection' : room ? 'Changes this lift for everyone riding it. The world stays at normal speed.' : 'Only this lift speeds up';
  }
}
