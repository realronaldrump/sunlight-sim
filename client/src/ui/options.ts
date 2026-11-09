// Options panel (P): time of day, snowfall, sound volume, graphics quality.
import { QualityName, savedQuality, saveQuality } from '../quality';
import { IPHONE } from '../platform';

export interface OptionsHandlers {
  setHour(h: number): void; setSnow(on: boolean): void; setVolume(v: number): void;
  hour: number; snow: boolean; volume: number;
  resume(): void; base(): void; travel(): void; recall(): void;
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
body.iphone #pause-toggle { display:none; }
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
  onChange?: () => void;
  constructor(h: OptionsHandlers) {
    const style = document.createElement('style'); style.textContent = css; document.head.appendChild(style);
    this.el = document.createElement('div'); this.el.id = 'opts';
    this.el.setAttribute('role', 'dialog'); this.el.setAttribute('aria-label', 'Pause menu');
    this.el.innerHTML = `<h3>Pause menu</h3><button id="pause-resume" type="button">Resume</button>
      <hr><button id="pause-base" type="button" ${IPHONE ? 'hidden' : ''}>Teleport to base</button>
      <button id="pause-travel" type="button">Teleport to a run or friend…</button>
      <button id="pause-recall" type="button" hidden>Recall drone to ${IPHONE ? 'launch point' : 'skier'}</button><hr>
      <label class="row"><span>Time of day (mid January)</span><b id="o-hl">${fmtHour(h.hour)}</b></label>
      <input type="range" id="o-hour" min="7.5" max="17" step="0.25" value="${h.hour}">
      <label class="row"><span>Light snowfall</span><input type="checkbox" id="o-snow" ${h.snow ? 'checked' : ''}></label>
      <label>Sound volume</label><input type="range" id="o-vol" min="0" max="1" step="0.05" value="${h.volume}">
      <div ${IPHONE ? 'hidden' : ''}><label>Graphics quality (reloads)</label>
      <select id="o-q"><option value="auto">Auto</option><option value="low">Low</option><option value="medium">Medium</option><option value="high">High</option><option value="ultra">Ultra</option></select>
      </div><p style="opacity:.7;margin:10px 0 0">${IPHONE ? 'Graphics optimized for iPhone.' : 'Esc or P to resume. Lifts keep moving.'}</p>`;
    document.body.appendChild(this.el);
    this.button.type = 'button'; this.button.id = 'pause-toggle'; this.button.textContent = 'Pause · Esc'; this.button.hidden = true;
    this.button.onclick = () => this.toggle(); document.body.append(this.button);
    this.el.querySelector('#pause-resume')?.addEventListener('click', h.resume);
    this.el.querySelector('#pause-base')?.addEventListener('click', h.base);
    this.el.querySelector('#pause-travel')?.addEventListener('click', h.travel);
    this.el.querySelector('#pause-recall')?.addEventListener('click', h.recall);
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
  update(ready: boolean, drone: boolean, map: boolean) {
    this.button.hidden = !ready || map || this.visible;
    (this.el.querySelector('#pause-recall') as HTMLElement).hidden = !drone;
  }
  get visible() { return this.el.classList.contains('show'); }
}
