// Options panel (P): time of day, snowfall, sound volume, graphics quality.
import { QualityName, savedQuality, saveQuality } from '../quality';
import { IPHONE } from '../platform';

export interface OptionsHandlers {
  setHour(h: number): void; setSnow(on: boolean): void; setVolume(v: number): void;
  hour: number; snow: boolean; volume: number;
  resume(): void; base(): void; travel(): void; recall(): void; log?(): void;
  phone?: { map(): void; view(): void; chat(): void; share(): void };
}

const css = `
#opts { position: fixed; right: 16px; top: 16px; z-index: 25; width: 280px; background: rgba(10,20,35,.85); backdrop-filter: blur(6px); border-radius: 10px; padding: 14px 16px; font-size: 13px; display: none; }
#opts.show { display: block; }
#opts h3 { margin: 0 0 10px; font-size: 15px; }
#opts label { display: block; margin: 10px 0 4px; opacity: .85; }
#opts input[type=range] { width: 100%; }
#opts select { width: 100%; padding: 5px; background: rgba(255,255,255,.1); color: #fff; border: 1px solid rgba(255,255,255,.25); border-radius: 6px; }
#opts .row { display: flex; justify-content: space-between; align-items: center; }
#opts { max-height:calc(100vh - 64px); overflow:auto; }
#opts button { width:100%; margin:5px 0; padding:9px 12px; color:#fff; background:#244759; border:1px solid #97c5cf70; border-radius:7px; cursor:pointer; text-align:left; }
#opts button:focus-visible { outline:2px solid #80e9ff; }
#opts hr { border:0; border-top:1px solid #ffffff30; margin:12px 0; }
#pause-toggle { position:fixed; top:16px; right:340px; z-index:12; padding:8px 12px; color:#fff; background:rgba(10,20,35,.85); border:1px solid #97c5cf70; border-radius:8px; cursor:pointer; }
#pause-toggle[hidden] { display:none; }
body.pause-menu-open #help { display:none; }
`;

function fmtHour(h: number) {
  const hh = Math.floor(h), mm = Math.round((h - hh) * 60);
  const ap = hh >= 12 ? 'PM' : 'AM';
  return `${((hh + 11) % 12) + 1}:${String(mm).padStart(2, '0')} ${ap}`;
}

export class OptionsPanel {
  private el: HTMLDivElement;
  private button = document.createElement('button');
  private roomStatus: HTMLElement | null;
  private chatButton: HTMLButtonElement | null;
  private shareButton: HTMLButtonElement | null;
  onChange?: () => void;
  constructor(h: OptionsHandlers) {
    const style = document.createElement('style'); style.textContent = css; document.head.appendChild(style);
    this.el = document.createElement('div'); this.el.id = 'opts';
    const title = h.phone ? 'Flight menu' : 'Pause menu';
    this.el.setAttribute('role', 'dialog'); this.el.setAttribute('aria-label', title);
    this.el.innerHTML = `<h3>${title}</h3><button id="pause-resume" type="button">Resume</button>
      ${h.phone ? `<p>Drag one finger to aim. Add a finger to fly forward. Touch with two fingers together to fly backward. Lift either finger to hover.</p>
      <div class="phone-menu-actions">
        <button id="pause-map" type="button">Map</button><button id="pause-view" type="button">Switch view</button>
        <button id="pause-chat" type="button" disabled>Chat</button><button id="pause-share" type="button" disabled>Share invite</button>
      </div><p id="pause-room" role="status"></p>` : ''}
      <hr><button id="pause-base" type="button" ${IPHONE ? 'hidden' : ''}>Teleport to base</button>
      <button id="pause-travel" type="button">Teleport to a run or friend…</button>
      <button id="pause-recall" type="button" hidden>Recall drone to ${IPHONE ? 'launch point' : 'skier'}</button>
      <button id="pause-log" type="button" ${h.log ? '' : 'hidden'}>Ski log and mountain progress</button><hr>
      <label class="row"><span>Time of day (mid January)</span><b id="o-hl">${fmtHour(h.hour)}</b></label>
      <input type="range" id="o-hour" min="7" max="20" step="0.25" value="${h.hour}">
      <label class="row"><span>Light snowfall</span><input type="checkbox" id="o-snow" ${h.snow ? 'checked' : ''}></label>
      <label>Sound volume</label><input type="range" id="o-vol" min="0" max="1" step="0.05" value="${h.volume}">
      <div ${IPHONE ? 'hidden' : ''}><label>Graphics quality (reloads)</label>
      <select id="o-q"><option value="auto">Auto</option><option value="low">Low</option><option value="medium">Medium</option><option value="high">High</option><option value="ultra">Ultra</option></select>
      </div><p style="opacity:.7;margin:10px 0 0">${IPHONE ? 'Graphics optimized for iPhone.' : 'Esc or P to resume. Lifts keep moving.'}</p>`;
    document.body.appendChild(this.el);
    this.button.type = 'button'; this.button.id = 'pause-toggle'; this.button.textContent = h.phone ? '⋯' : 'Pause · Esc'; this.button.hidden = true;
    if (h.phone) this.button.setAttribute('aria-label', 'Flight menu');
    this.button.onclick = () => this.toggle(); document.body.append(this.button);
    this.el.querySelector('#pause-resume')?.addEventListener('click', h.resume);
    this.el.querySelector('#pause-base')?.addEventListener('click', h.base);
    this.el.querySelector('#pause-travel')?.addEventListener('click', h.travel);
    this.el.querySelector('#pause-recall')?.addEventListener('click', h.recall);
    if (h.log) this.el.querySelector('#pause-log')?.addEventListener('click', h.log);
    this.roomStatus = this.el.querySelector('#pause-room');
    this.chatButton = this.el.querySelector('#pause-chat');
    this.shareButton = this.el.querySelector('#pause-share');
    if (h.phone) {
      this.el.querySelector('#pause-map')?.addEventListener('click', h.phone.map);
      this.el.querySelector('#pause-view')?.addEventListener('click', h.phone.view);
      this.chatButton?.addEventListener('click', h.phone.chat);
      this.shareButton?.addEventListener('click', h.phone.share);
    }
    const hour = this.el.querySelector('#o-hour') as HTMLInputElement;
    hour.oninput = () => { (this.el.querySelector('#o-hl') as HTMLElement).textContent = fmtHour(Number(hour.value)); };
    hour.onchange = () => h.setHour(Number(hour.value));
    (this.el.querySelector('#o-snow') as HTMLInputElement).onchange = (e) => h.setSnow((e.target as HTMLInputElement).checked);
    (this.el.querySelector('#o-vol') as HTMLInputElement).oninput = (e) => h.setVolume(Number((e.target as HTMLInputElement).value));
    const q = this.el.querySelector('#o-q') as HTMLSelectElement;
    q.value = savedQuality();
    q.onchange = () => { saveQuality(q.value as QualityName | 'auto'); location.reload(); };
  }
  toggle(force?: boolean) { this.el.classList.toggle('show', force ?? !this.visible); document.body.classList.toggle('pause-menu-open', this.visible); this.onChange?.(); }
  update(ready: boolean, drone: boolean, obscured: boolean, room?: { label: string; connected: boolean; share: boolean }) {
    this.button.hidden = !ready || obscured || this.visible;
    (this.el.querySelector('#pause-recall') as HTMLElement).hidden = !drone;
    if (room && this.roomStatus && this.chatButton && this.shareButton) {
      if (this.roomStatus.textContent !== room.label) this.roomStatus.textContent = room.label;
      this.chatButton.disabled = !room.connected;
      this.shareButton.disabled = !room.share;
    }
  }
  get visible() { return this.el.classList.contains('show'); }
}
