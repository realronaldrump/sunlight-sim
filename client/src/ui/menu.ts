// Start menu: display name, jacket colour, solo or multiplayer room, graphics quality. Plus chat UI.
import { randomRoomCode, sanitizeRoom } from '../../../shared/protocol';
import { QualityName, savedQuality, saveQuality } from '../quality';

export interface MenuResult { name: string; color: string; room: string | null; quality: QualityName | 'auto' }

const COLORS = ['#d33a2c', '#1f6fd1', '#f2b705', '#2e9e44', '#7b3fbf', '#ff6f91', '#111111', '#f5f5f5'];

const css = `
#menu { position: fixed; inset: 0; z-index: 40; display: flex; align-items: center; justify-content: center; background: rgba(10,22,40,.45); backdrop-filter: blur(3px); }
#menu .panel { background: rgba(14,26,44,.92); border-radius: 14px; padding: 22px 26px; width: min(420px, calc(100vw - 32px)); box-shadow: 0 10px 40px rgba(0,0,0,.35); }
#menu h2 { margin: 0 0 4px; font-size: 22px; } #menu p.sub { margin: 0 0 16px; opacity: .75; font-size: 13px; }
#menu label { display: block; font-size: 12px; text-transform: uppercase; letter-spacing: .08em; opacity: .75; margin: 12px 0 6px; }
#menu input[type=text] { width: 100%; padding: 9px 11px; border-radius: 8px; border: 1px solid rgba(255,255,255,.2); background: rgba(255,255,255,.08); color: #fff; font-size: 15px; }
#menu .swatches { display: flex; gap: 8px; flex-wrap: wrap; }
#menu .sw { width: 30px; height: 30px; border-radius: 50%; border: 2px solid transparent; cursor: pointer; }
#menu .sw.sel { border-color: #fff; box-shadow: 0 0 0 2px rgba(255,255,255,.35); }
#menu .row { display: flex; gap: 8px; margin-top: 16px; }
#menu button { flex: 1; padding: 11px; border-radius: 9px; border: 0; font-size: 15px; font-weight: 600; cursor: pointer; background: rgba(255,255,255,.14); color: #fff; }
#menu button.primary { background: #2f74ff; }
#menu select { width: 100%; padding: 8px; border-radius: 8px; background: rgba(255,255,255,.08); color: #fff; border: 1px solid rgba(255,255,255,.2); }
#menu .err { color: #ff8a8a; font-size: 13px; min-height: 18px; margin-top: 8px; }
#roombox { position: fixed; left: 16px; top: 16px; z-index: 12; background: rgba(10,20,35,.6); backdrop-filter: blur(6px); padding: 8px 12px; border-radius: 8px; font-size: 13px; display: none; }
#roombox button { margin-left: 8px; background: rgba(255,255,255,.18); color: #fff; border: 0; border-radius: 5px; padding: 3px 8px; cursor: pointer; }
#chatlog { position: fixed; right: 16px; bottom: 70px; z-index: 12; width: min(320px, calc(100vw - 32px)); font-size: 13px; pointer-events: none; }
#chatlog div { background: rgba(10,20,35,.6); margin-top: 4px; padding: 4px 8px; border-radius: 6px; transition: opacity 1s; }
#chatin { position: fixed; right: 16px; bottom: 36px; z-index: 13; width: min(320px, calc(100vw - 32px)); display: none; padding: 7px 10px; border-radius: 8px; border: 0; background: rgba(10,20,35,.85); color: #fff; font-size: 14px; }
`;

let cssInjected = false;
function injectCss() {
  if (cssInjected) return;
  cssInjected = true;
  const style = document.createElement('style'); style.textContent = css; document.head.appendChild(style);
}

export function showMenu(defaults: { quality: QualityName }): Promise<MenuResult> {
  injectCss();
  const params = new URLSearchParams(location.search);
  const urlRoom = sanitizeRoom(params.get('room') ?? '');
  let name = '', color = COLORS[0];
  try { name = localStorage.getItem('sunlight.name') ?? ''; color = localStorage.getItem('sunlight.color') ?? COLORS[0]; } catch { /* ignore */ }
  const el = document.createElement('div'); el.id = 'menu';
  el.innerHTML = `<div class="panel">
    <h2>Sunlight Mountain</h2><p class="sub">Glenwood Springs, Colorado. Real terrain, real runs, real lifts.</p>
    <label>Your name</label><input type="text" id="m-name" maxlength="18" placeholder="Skier">
    <label>Jacket colour</label><div class="swatches">${COLORS.map((c) => `<div class="sw" data-c="${c}" style="background:${c}"></div>`).join('')}</div>
    <label>Graphics quality</label><select id="m-q"><option value="auto">Auto (${defaults.quality})</option><option value="low">Low</option><option value="medium">Medium</option><option value="high">High</option><option value="ultra">Ultra</option></select>
    ${urlRoom ? `<label>Room</label><div>Joining room <b>${urlRoom}</b></div>` : `<label>Ski with a friend</label><input type="text" id="m-room" maxlength="8" placeholder="Room code (optional)">`}
    <div class="row">${urlRoom ? `<button class="primary" id="m-join">Join ${urlRoom}</button><button id="m-solo">Ski solo</button>` :
      `<button class="primary" id="m-solo">Ski solo</button><button id="m-create">Create room</button><button id="m-join">Join</button>`}</div>
    <div class="err" id="m-err"></div></div>`;
  document.body.appendChild(el);
  const nameIn = el.querySelector('#m-name') as HTMLInputElement;
  nameIn.value = name;
  const q = el.querySelector('#m-q') as HTMLSelectElement;
  q.value = savedQuality();
  const sws = [...el.querySelectorAll('.sw')] as HTMLDivElement[];
  const sel = () => sws.forEach((s) => s.classList.toggle('sel', s.dataset.c === color));
  sws.forEach((s) => (s.onclick = () => { color = s.dataset.c!; sel(); }));
  sel();
  return new Promise((resolve) => {
    const finish = (room: string | null) => {
      const n = nameIn.value.trim() || 'Skier';
      try { localStorage.setItem('sunlight.name', n); localStorage.setItem('sunlight.color', color); } catch { /* ignore */ }
      const quality = q.value as QualityName | 'auto';
      if (quality !== savedQuality()) saveQuality(quality);
      el.remove();
      resolve({ name: n, color, room, quality });
    };
    (el.querySelector('#m-solo') as HTMLButtonElement).onclick = () => finish(null);
    const create = el.querySelector('#m-create') as HTMLButtonElement | null;
    if (create) create.onclick = () => finish(randomRoomCode());
    (el.querySelector('#m-join') as HTMLButtonElement).onclick = () => {
      const r = urlRoom || sanitizeRoom((el.querySelector('#m-room') as HTMLInputElement).value);
      if (!r) { (el.querySelector('#m-err') as HTMLElement).textContent = 'Enter a room code, or press Create room'; return; }
      finish(r);
    };
    nameIn.addEventListener('keydown', (e) => { if (e.key === 'Enter') (el.querySelector('.primary') as HTMLButtonElement).click(); });
  });
}

export function showRoomBox(room: string) {
  injectCss();
  const box = document.createElement('div'); box.id = 'roombox';
  const url = new URL(location.href);
  url.searchParams.set('room', room);
  history.replaceState(null, '', url.toString());
  box.innerHTML = `Room <b>${room}</b><button id="rb-copy">Copy invite link</button>`;
  document.body.appendChild(box);
  box.style.display = 'block';
  (box.querySelector('#rb-copy') as HTMLButtonElement).onclick = async () => {
    try { await navigator.clipboard.writeText(url.toString()); (box.querySelector('#rb-copy') as HTMLButtonElement).textContent = 'Copied'; }
    catch { prompt('Share this link', url.toString()); }
  };
}

export class ChatUI {
  private log = document.createElement('div');
  readonly input = document.createElement('input');
  onSend?: (text: string) => void;
  constructor() {
    injectCss();
    this.log.id = 'chatlog'; this.input.id = 'chatin'; this.input.maxLength = 200; this.input.placeholder = 'Say something, Enter to send';
    document.body.append(this.log, this.input);
    this.input.addEventListener('keydown', (e) => {
      e.stopPropagation();
      if (e.key === 'Enter') { const t = this.input.value.trim(); if (t) this.onSend?.(t); this.close(); }
      if (e.key === 'Escape') this.close();
    });
  }
  get open() { return this.input.style.display === 'block'; }
  openInput() { this.input.style.display = 'block'; this.input.value = ''; setTimeout(() => this.input.focus(), 0); }
  close() { this.input.style.display = 'none'; this.input.blur(); }
  add(name: string, text: string) {
    const d = document.createElement('div');
    d.textContent = name ? `${name}: ${text}` : text;
    if (!name) d.style.opacity = '0.8';
    this.log.appendChild(d);
    setTimeout(() => { d.style.opacity = '0'; setTimeout(() => d.remove(), 1000); }, 12000);
    while (this.log.children.length > 8) this.log.firstChild?.remove();
  }
}
