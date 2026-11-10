// Options panel (P): time of day, snowfall, sound volume, graphics quality.
import { QualityName, savedQuality, saveQuality } from '../quality';
import { IPHONE } from '../platform';
import { SANTA_ACHIEVEMENT } from '../world/santaDiscovery';

const SANTA_MAP_KEY = 'sunlight.santaMap';

export interface OptionsHandlers {
  setHour(h: number): void; setSnow(on: boolean): void; setVolume(v: number): void;
  weather?: { mode: 'changing' | 'clear' | 'snow'; setMode(mode: 'changing' | 'clear' | 'snow'): void };
  clock?: { mode: 'explore' | 'day'; setMode(mode: 'explore' | 'day'): void };
  autoUnload?: { on: boolean; set(on: boolean): void };
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
#opts .discovery { display:flex; align-items:center; gap:10px; margin:13px 0 0; padding:10px; border:1px solid #e2bc7270; border-radius:9px; background:linear-gradient(135deg,#701c33aa,#4c362daa); }
#opts .discovery[hidden] { display:none; }
#opts .discovery svg { width:32px; height:32px; flex:none; }
#opts .discovery b, #opts .discovery time { display:block; }
#opts .discovery time { opacity:.76; margin-top:2px; }
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
  private santaMap: HTMLInputElement;
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
      <button id="pause-log" type="button" ${h.log ? '' : 'hidden'}>Ski log and mountain progress</button>
      <div id="santa-sighting" class="discovery" hidden>
        <svg aria-hidden="true" viewBox="0 0 36 36"><path d="M18 1.5 32.5 9v17L18 34.5 3.5 26V9Z" fill="#611930" stroke="#e7c481" stroke-width="2"/>
        <path d="M9 23c.7-4.9 3.4-11 8.4-12.3 4.1-1.1 6.2 1.7 7.7 4.3l-6.4 1.3L23 23Z" fill="#de4452"/>
        <path d="M9 23.2h14" stroke="#fff4dd" stroke-width="3.3" stroke-linecap="round"/><circle cx="25.5" cy="15.8" r="2.2" fill="#fff4dd"/></svg>
        <span><b>${SANTA_ACHIEVEMENT}</b><time></time></span>
      </div><hr>
      <label class="row"><span>Time of day (mid January)</span><b id="o-hl">${fmtHour(h.hour)}</b></label>
      <input type="range" id="o-hour" min="7" max="20" step="0.25" value="${h.hour}">
      ${h.clock ? `<label>Clock</label><select id="o-clock"><option value="explore">Free explore: you set the time, lifts run any hour</option><option value="day">Resort day: time passes, lifts 9 AM to 4 PM, shared in a room</option></select>` : ''}
      ${h.weather ? `<label>Weather</label><select id="o-weather"><option value="changing">Changing: snow squalls drift through, shared in a room</option><option value="clear">Clear</option><option value="snow">Light snow all day</option></select>`
        : `<label class="row"><span>Light snowfall</span><input type="checkbox" id="o-snow" ${h.snow ? 'checked' : ''}></label>`}
      ${h.autoUnload ? `<label class="row" title="Off: press Space on the unload ramp at the top to stand up and ski off. Miss it and the lift has opinions."><span>Auto disembark at the top of the lift</span><input type="checkbox" id="o-unload" ${h.autoUnload.on ? 'checked' : ''}></label>
      <p id="o-unload-note" style="opacity:.7;margin:2px 0 0;font-size:12px">${h.autoUnload.on ? 'The chair sets you down on the ramp.' : 'Press Space on the ramp to stand up.'}</p>` : ''}
      <label class="row"><span>Show Trump Santa on map</span><input type="checkbox" id="o-santa-map"></label>
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
    const snowBox = this.el.querySelector('#o-snow') as HTMLInputElement | null;
    if (snowBox) snowBox.onchange = (e) => { h.setSnow((e.target as HTMLInputElement).checked); snowBox.blur(); };
    this.santaMap = this.el.querySelector<HTMLInputElement>('#o-santa-map')!;
    try { this.santaMap.checked = localStorage.getItem(SANTA_MAP_KEY) === '1'; } catch { /* storage blocked */ }
    this.santaMap.onchange = () => {
      try { localStorage.setItem(SANTA_MAP_KEY, this.santaMap.checked ? '1' : '0'); } catch { /* storage blocked */ }
      this.santaMap.blur();
    };
    const weather = this.el.querySelector('#o-weather') as HTMLSelectElement | null;
    if (weather && h.weather) { weather.value = h.weather.mode; weather.onchange = () => h.weather!.setMode(weather.value as 'changing' | 'clear' | 'snow'); }
    (this.el.querySelector('#o-vol') as HTMLInputElement).oninput = (e) => h.setVolume(Number((e.target as HTMLInputElement).value));
    const unload = this.el.querySelector('#o-unload') as HTMLInputElement | null;
    if (unload && h.autoUnload) unload.onchange = () => {
      h.autoUnload!.set(unload.checked);
      unload.blur(); // so Esc closes the menu again
      (this.el.querySelector('#o-unload-note') as HTMLElement).textContent = unload.checked ? 'The chair sets you down on the ramp.' : 'Press Space on the ramp to stand up.';
    };
    const clock = this.el.querySelector('#o-clock') as HTMLSelectElement | null;
    if (clock && h.clock) { clock.value = h.clock.mode; clock.onchange = () => h.clock!.setMode(clock.value as 'explore' | 'day'); }
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
  get showSantaOnMap() { return this.santaMap.checked; }

  santaSighting(foundAt: number | null) {
    if (!foundAt) return;
    const badge = this.el.querySelector<HTMLElement>('#santa-sighting')!;
    const time = badge.querySelector('time')!;
    time.dateTime = new Date(foundAt).toISOString();
    time.textContent = 'Discovered ' + new Date(foundAt).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
    badge.hidden = false;
  }

  /** Show the running Resort Day clock (slider locked) or hand the time back to the player. */
  showClock(hour: number, locked: boolean) {
    const slider = this.el.querySelector('#o-hour') as HTMLInputElement, label = this.el.querySelector('#o-hl') as HTMLElement;
    if (slider.disabled !== locked) slider.disabled = locked;
    if (locked || document.activeElement !== slider) { slider.value = String(hour); label.textContent = fmtHour(hour) + (locked ? ' (resort day)' : ''); }
  }
}
