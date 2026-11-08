// Options panel (P): time of day, snowfall, sound volume, graphics quality.
import { QualityName, savedQuality, saveQuality } from '../quality';

export interface OptionsHandlers {
  setHour(h: number): void; setSnow(on: boolean): void; setVolume(v: number): void;
  hour: number; snow: boolean; volume: number;
}

const css = `
#opts { position: fixed; right: 16px; top: 16px; z-index: 25; width: 280px; background: rgba(10,20,35,.85); backdrop-filter: blur(6px); border-radius: 10px; padding: 14px 16px; font-size: 13px; display: none; }
#opts.show { display: block; }
#opts h3 { margin: 0 0 10px; font-size: 15px; }
#opts label { display: block; margin: 10px 0 4px; opacity: .85; }
#opts input[type=range] { width: 100%; }
#opts select { width: 100%; padding: 5px; background: rgba(255,255,255,.1); color: #fff; border: 1px solid rgba(255,255,255,.25); border-radius: 6px; }
#opts .row { display: flex; justify-content: space-between; align-items: center; }
`;

function fmtHour(h: number) {
  const hh = Math.floor(h), mm = Math.round((h - hh) * 60);
  const ap = hh >= 12 ? 'PM' : 'AM';
  return `${((hh + 11) % 12) + 1}:${String(mm).padStart(2, '0')} ${ap}`;
}

export class OptionsPanel {
  private el: HTMLDivElement;
  constructor(h: OptionsHandlers) {
    const style = document.createElement('style'); style.textContent = css; document.head.appendChild(style);
    this.el = document.createElement('div'); this.el.id = 'opts';
    this.el.innerHTML = `<h3>Options</h3>
      <label class="row"><span>Time of day (mid January)</span><b id="o-hl">${fmtHour(h.hour)}</b></label>
      <input type="range" id="o-hour" min="7.5" max="17" step="0.25" value="${h.hour}">
      <label class="row"><span>Light snowfall</span><input type="checkbox" id="o-snow" ${h.snow ? 'checked' : ''}></label>
      <label>Sound volume</label><input type="range" id="o-vol" min="0" max="1" step="0.05" value="${h.volume}">
      <label>Graphics quality (reloads)</label>
      <select id="o-q"><option value="auto">Auto</option><option value="low">Low</option><option value="medium">Medium</option><option value="high">High</option><option value="ultra">Ultra</option></select>
      <p style="opacity:.7;margin:10px 0 0">Press P to close.</p>`;
    document.body.appendChild(this.el);
    const hour = this.el.querySelector('#o-hour') as HTMLInputElement;
    hour.oninput = () => { (this.el.querySelector('#o-hl') as HTMLElement).textContent = fmtHour(Number(hour.value)); };
    hour.onchange = () => h.setHour(Number(hour.value));
    (this.el.querySelector('#o-snow') as HTMLInputElement).onchange = (e) => h.setSnow((e.target as HTMLInputElement).checked);
    (this.el.querySelector('#o-vol') as HTMLInputElement).oninput = (e) => h.setVolume(Number((e.target as HTMLInputElement).value));
    const q = this.el.querySelector('#o-q') as HTMLSelectElement;
    q.value = savedQuality();
    q.onchange = () => { saveQuality(q.value as QualityName | 'auto'); location.reload(); };
  }
  toggle() { this.el.classList.toggle('show'); }
}
