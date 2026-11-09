// The ski log, opened from the pause menu: time and distance on the mountain, every descent with its
// line and speed and elevation profile, and a map of unvisited, partly skied and completed trails.
import type { ResortData } from '../game';
import type { SkiLog, Descent, Totals, Trail } from '../log/skiLog';
import { DIFF_COLOR, drawDiffSymbol } from '../runs/runs';
import { diffIcon } from './hud';

const M_PER_MI = 1609.344, M_PER_FT = 0.3048;
const mi = (m: number) => (m / M_PER_MI).toFixed(m < 16093 ? 2 : 1);
const ft = (m: number) => Math.round(m / M_PER_FT).toLocaleString('en-US');
const mph = (v: number) => (v * 3600 / M_PER_MI).toFixed(1);
function dur(s: number) {
  s = Math.round(s);
  const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), sec = s % 60;
  return h ? `${h} h ${String(m).padStart(2, '0')} min` : m ? `${m} min ${String(sec).padStart(2, '0')} s` : `${sec} s`;
}
const when = (t: number) => new Date(t).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
const day = (t: number) => new Date(t).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });

const STATUS = { completed: '#43d17a', partial: '#ffb02e', unvisited: '#9aa3ad' };
/** Line colours run from blue (standing) through yellow (about 17 mph) to red at 34 mph and above. */
const SPEED_SCALE = 15;

const css = `
#skilog { position: fixed; inset: 0; z-index: 31; background: rgba(6,12,22,.86); backdrop-filter: blur(4px); display: none; color: #eef3f7; font-size: 14px; }
#skilog.show { display: flex; justify-content: center; }
#skilog .wrap { width: min(1180px, 100vw); height: 100vh; display: flex; flex-direction: column; padding: 18px 20px; box-sizing: border-box; }
#skilog header { display: flex; align-items: center; gap: 16px; margin-bottom: 12px; }
#skilog h2 { margin: 0; font-size: 22px; }
#skilog .tabs { display: flex; gap: 6px; margin-left: 12px; }
#skilog .tabs button, #skilog .close, #skilog .chip { background: rgba(255,255,255,.1); color: #fff; border: 1px solid rgba(255,255,255,.18); border-radius: 18px; padding: 6px 14px; cursor: pointer; font-size: 13px; }
#skilog .tabs button.on, #skilog .chip.on { background: #e9eef3; color: #0d1825; }
#skilog .close { margin-left: auto; }
#skilog .body { flex: 1; min-height: 0; overflow: auto; }
#skilog .grid3 { display: grid; grid-template-columns: repeat(3, 1fr); gap: 12px; }
#skilog .card { background: rgba(255,255,255,.06); border: 1px solid rgba(255,255,255,.09); border-radius: 12px; padding: 14px 16px; }
#skilog .card h4 { margin: 0 0 10px; font-size: 12px; text-transform: uppercase; letter-spacing: .08em; opacity: .7; font-weight: 600; }
#skilog .kv { display: grid; grid-template-columns: 1fr auto; row-gap: 6px; column-gap: 12px; font-variant-numeric: tabular-nums; }
#skilog .kv span:nth-child(odd) { opacity: .75; }
#skilog .kv b { text-align: right; }
#skilog .big { font-size: 30px; font-weight: 700; }
#skilog .bar { height: 10px; border-radius: 5px; background: rgba(255,255,255,.12); overflow: hidden; display: flex; margin: 10px 0 6px; }
#skilog .bar i { display: block; height: 100%; }
#skilog .diffs { display: flex; gap: 18px; flex-wrap: wrap; margin-top: 10px; font-variant-numeric: tabular-nums; }
#skilog .diffs span { display: inline-flex; align-items: center; gap: 6px; }
#skilog table { width: 100%; border-collapse: collapse; font-variant-numeric: tabular-nums; }
#skilog th { text-align: left; font-size: 11px; text-transform: uppercase; letter-spacing: .07em; opacity: .65; font-weight: 600; padding: 6px 8px; position: sticky; top: 0; background: #0f1a28; }
#skilog td { padding: 8px; border-top: 1px solid rgba(255,255,255,.07); vertical-align: top; }
#skilog tbody tr { cursor: pointer; }
#skilog tbody tr:hover { background: rgba(255,255,255,.06); }
#skilog td.num, #skilog th.num { text-align: right; }
#skilog .runs { display: flex; flex-wrap: wrap; gap: 4px 10px; }
#skilog .runs span { display: inline-flex; align-items: center; gap: 5px; white-space: nowrap; }
#skilog .runs em { font-style: normal; opacity: .6; font-size: 12px; }
#skilog .diff { transform-origin: center; }
#skilog .runs .diff, #skilog .list .diff, #skilog .diffs .diff { width: 12px; height: 12px; }
#skilog .runs .diff.double, #skilog .list .diff.double, #skilog .diffs .diff.double { width: 22px; }
#skilog .runs .diff.double::before, #skilog .runs .diff.double::after, #skilog .list .diff.double::before, #skilog .list .diff.double::after, #skilog .diffs .diff.double::before, #skilog .diffs .diff.double::after { width: 9px; height: 9px; top: 1px; }
#skilog .runs .diff.double::after, #skilog .list .diff.double::after, #skilog .diffs .diff.double::after { left: 11px; }
#skilog .split { display: grid; grid-template-columns: minmax(0, 1.5fr) minmax(280px, 1fr); gap: 14px; height: 100%; min-height: 520px; }
#skilog canvas { width: 100%; display: block; border-radius: 10px; background: #1b2633; }
#skilog .list { overflow: auto; max-height: 100%; }
#skilog .list div.row { display: grid; grid-template-columns: 1fr auto; gap: 2px 10px; padding: 7px 4px; border-top: 1px solid rgba(255,255,255,.07); }
#skilog .list .meta { font-size: 12px; opacity: .7; grid-column: 1 / 3; }
#skilog .dot { display: inline-block; width: 9px; height: 9px; border-radius: 50%; margin-right: 4px; }
#skilog .legend { display: flex; gap: 14px; font-size: 12px; margin: 8px 2px; opacity: .9; }
#skilog .empty { opacity: .7; padding: 30px 6px; }
#skilog .back { background: none; border: 0; color: #9fd4ff; cursor: pointer; padding: 0; font-size: 13px; margin-bottom: 10px; }
#skilog .reset { background: none; border: 0; color: #ff9b9b; cursor: pointer; font-size: 12px; opacity: .8; }
@media (max-width: 820px) { #skilog .grid3, #skilog .split { grid-template-columns: 1fr; } }
`;

type Tab = 'overview' | 'history' | 'mountain';

export class SkiLogPanel {
  private root: HTMLDivElement;
  private body: HTMLDivElement;
  private tab: Tab = 'overview';
  private filter = 'all';
  private detail: Descent | null = null;
  private img = new Image();
  visible = false;
  onClose?: () => void;

  constructor(private log: SkiLog, private resort: ResortData, base: string) {
    const style = document.createElement('style'); style.textContent = css; document.head.appendChild(style);
    this.root = document.createElement('div'); this.root.id = 'skilog';
    this.root.setAttribute('role', 'dialog'); this.root.setAttribute('aria-label', 'Ski log');
    this.root.innerHTML = `<div class="wrap"><header><h2>Ski log</h2><div class="tabs">
      <button data-tab="overview">Overview</button><button data-tab="history">Run history</button><button data-tab="mountain">Mountain map</button></div>
      <button class="close" type="button">Close</button></header><div class="body"></div></div>`;
    document.body.appendChild(this.root);
    this.body = this.root.querySelector('.body')!;
    this.root.querySelectorAll<HTMLButtonElement>('.tabs button').forEach((b) => b.onclick = () => { this.tab = b.dataset.tab as Tab; this.detail = null; this.render(); });
    (this.root.querySelector('.close') as HTMLButtonElement).onclick = () => this.toggle(false);
    window.addEventListener('keydown', (e) => { if (this.visible && (e.code === 'Escape')) { e.stopImmediatePropagation(); e.preventDefault(); this.toggle(false); } }, true);
    this.img.src = `${base}/map.jpg`;
    this.img.onload = () => { if (this.visible) this.render(); };
  }

  toggle(force?: boolean) {
    this.visible = force ?? !this.visible;
    this.root.classList.toggle('show', this.visible);
    if (this.visible) this.render(); else this.onClose?.();
  }

  show(tab: Tab) { this.tab = tab; this.detail = null; this.toggle(true); }

  private render() {
    this.root.querySelectorAll<HTMLButtonElement>('.tabs button').forEach((b) => b.classList.toggle('on', b.dataset.tab === this.tab));
    if (this.detail) this.renderDetail(this.detail);
    else if (this.tab === 'overview') this.renderOverview();
    else if (this.tab === 'history') this.renderHistory();
    else this.renderMountain();
  }

  private statCard(title: string, t: Totals, extra = '') {
    return `<div class="card"><h4>${title}</h4><div class="kv">
      <span>Distance skied</span><b>${mi(t.dist)} mi</b>
      <span>Vertical descended</span><b>${ft(t.vert)} ft</b>
      <span>Descents</span><b>${t.descents}</b>
      <span>Time skiing</span><b>${dur(t.moving)}</b>
      <span>Time on lifts</span><b>${dur(t.lift)}</b>
      <span>Time on the mountain</span><b>${dur(t.elapsed)}</b>
      <span>Average moving speed</span><b>${t.moving > 0 ? mph(t.dist / t.moving) : '0.0'} mph</b>
      <span>Top speed</span><b>${mph(t.top)} mph</b>${extra}</div></div>`;
  }

  private progress(filter = 'all') {
    const cov = this.log.coverage().filter((c) => filter === 'all' || c.trail.difficulty === filter);
    const done = cov.filter((c) => c.status === 'completed').length, part = cov.filter((c) => c.status === 'partial').length;
    return { cov, done, part, total: cov.length };
  }

  private renderOverview() {
    const p = this.progress();
    const pct = p.total ? Math.round((100 * p.done) / p.total) : 0;
    const diffs = ['green', 'blue', 'black', 'double', 'park'].map((d) => {
      const q = this.progress(d); if (!q.total) return '';
      return `<span>${diffIcon(d)} ${q.done} of ${q.total}</span>`;
    }).join('');
    const live = this.log.active();
    const recent = [...(live ? [live] : []), ...this.log.descents.slice(-4).reverse()].slice(0, 4);
    this.body.innerHTML = `<div class="grid3">
      ${this.statCard('This session', this.log.session)}
      ${this.statCard('Today', this.log.today())}
      ${this.statCard('All time', this.log.totals, `<span>Ski days</span><b>${this.log.days.length}</b>`)}</div>
      <div class="card" style="margin-top:12px"><h4>Skiing the whole mountain</h4>
        <div><span class="big">${p.done}</span> of ${p.total} trails completed <span style="opacity:.75">(${pct}%)</span>, ${p.part} partly skied</div>
        <div class="bar"><i style="width:${(100 * p.done) / Math.max(1, p.total)}%;background:${STATUS.completed}"></i><i style="width:${(100 * p.part) / Math.max(1, p.total)}%;background:${STATUS.partial}"></i></div>
        <div class="diffs">${diffs}</div></div>
      <div class="card" style="margin-top:12px"><h4>Recent descents</h4>${recent.length ? this.table(recent) : '<div class="empty">Ski a run and it will appear here. Each descent ends when you board a lift, teleport, step out of your skis or fly the drone.</div>'}</div>
      <div style="margin-top:10px;text-align:right"><button class="reset" type="button">Clear ski log</button></div>`;
    this.bindRows(recent);
    (this.body.querySelector('.reset') as HTMLButtonElement).onclick = () => { if (confirm('Clear your ski log? This removes every descent and your trail progress in this browser.')) { this.log.reset(); this.render(); } };
  }

  private runList(d: Descent) {
    return `<div class="runs">${d.runs.slice(0, 5).map((r) => {
      const t = this.log.trailByKey(r.key); if (!t) return '';
      return `<span>${diffIcon(t.difficulty)}${r.done ? `<b>${t.name}</b>` : `${t.name} <em>${Math.round(r.frac * 100)}%</em>`}</span>`;
    }).join('') || '<span style="opacity:.6">Off the mapped trails</span>'}</div>`;
  }

  private table(list: Descent[]) {
    return `<table><thead><tr><th>When</th><th>Trails</th><th class="num">Distance</th><th class="num">Vertical</th><th class="num">Moving</th><th class="num">Avg</th><th class="num">Top</th></tr></thead><tbody>
      ${list.map((d, i) => `<tr data-i="${i}"><td>${when(d.start)}${this.log.descents.includes(d) ? '' : '<br><em style="font-style:normal;color:#ffb02e;font-size:12px">In progress</em>'}</td><td>${this.runList(d)}</td><td class="num">${mi(d.dist)} mi</td><td class="num">${ft(d.vert)} ft</td>
        <td class="num">${dur(d.moving)}</td><td class="num">${d.moving > 0 ? mph(d.dist / d.moving) : '0.0'} mph</td><td class="num">${mph(d.top)} mph</td></tr>`).join('')}</tbody></table>`;
  }

  private bindRows(list: Descent[]) {
    this.body.querySelectorAll<HTMLTableRowElement>('tbody tr').forEach((tr) => tr.onclick = () => { this.detail = list[Number(tr.dataset.i)]; this.render(); });
  }

  private renderHistory() {
    const live = this.log.active();
    const list = [...(live ? [live] : []), ...this.log.descents.slice().reverse()];
    this.body.innerHTML = list.length ? `<div class="card"><h4>${list.length} descents, newest first</h4>${this.table(list)}</div>`
      : '<div class="empty">No descents yet. Ski any run; every lap is kept here.</div>';
    this.bindRows(list);
  }

  private renderMountain() {
    const p = this.progress(this.filter);
    const order = { completed: 0, partial: 1, unvisited: 2 };
    const rows = p.cov.slice().sort((a, b) => order[a.status] - order[b.status] || b.frac - a.frac || a.trail.name.localeCompare(b.trail.name));
    this.body.innerHTML = `<div style="display:flex;gap:6px;flex-wrap:wrap;margin-bottom:8px">${['all', 'green', 'blue', 'black', 'double', 'park'].map((f) => `<button class="chip ${f === this.filter ? 'on' : ''}" data-f="${f}">${f === 'all' ? 'All trails' : f === 'double' ? 'Double black' : f[0].toUpperCase() + f.slice(1)}</button>`).join('')}</div>
      <div class="split"><div><canvas height="600"></canvas>
        <div class="legend"><span><i class="dot" style="background:${STATUS.completed}"></i>Completed (${p.done})</span><span><i class="dot" style="background:${STATUS.partial}"></i>Partly skied (${p.part})</span><span><i class="dot" style="background:${STATUS.unvisited}"></i>Not yet skied (${p.total - p.done - p.part})</span><span style="opacity:.7">Viewed from the base</span></div></div>
      <div class="card list"><h4>${p.done} of ${p.total} completed</h4>${rows.map((c) => `<div class="row"><span>${diffIcon(c.trail.difficulty)} ${c.trail.name}</span>
        <b style="color:${STATUS[c.status]}">${c.status === 'completed' ? `${c.laps} lap${c.laps === 1 ? '' : 's'}` : c.status === 'partial' ? `${Math.round(c.frac * 100)}% skied` : 'Not yet'}</b>
        <span class="meta">${(c.trail.length / M_PER_FT).toFixed(0).replace(/\B(?=(\d{3})+(?!\d))/g, ',')} ft long${c.last ? `, last lap ${day(c.last)}` : ''}</span></div>`).join('')}</div></div>`;
    this.body.querySelectorAll<HTMLButtonElement>('.chip').forEach((b) => b.onclick = () => { this.filter = b.dataset.f!; this.render(); });
    const cv = this.body.querySelector('canvas')!;
    requestAnimationFrame(() => this.drawMap(cv, (tr) => {
      const c = p.cov.find((x) => x.trail === tr);
      return c ? STATUS[c.status] : null;
    }, undefined, (tr) => p.cov.find((x) => x.trail === tr)?.status !== 'unvisited'));
  }

  private renderDetail(d: Descent) {
    const vertFt = ft(d.vert);
    this.body.innerHTML = `<button class="back" type="button">&larr; Back</button>
      <div class="split"><div><canvas height="560"></canvas><div class="legend"><span>Line colored by speed: <i class="dot" style="background:#4aa3ff"></i>0 <i class="dot" style="background:#ffd23f"></i>17 <i class="dot" style="background:#ff4d4d"></i>34+ mph</span></div></div>
      <div><div class="card"><h4>${when(d.start)}</h4><div class="kv">
        <span>Distance</span><b>${mi(d.dist)} mi</b><span>Vertical</span><b>${vertFt} ft</b>
        <span>Start elevation</span><b>${ft(d.startY)} ft</b><span>Finish elevation</span><b>${ft(d.endY)} ft</b>
        <span>Moving time</span><b>${dur(d.moving)}</b><span>Elapsed</span><b>${dur((d.end - d.start) / 1000)}</b>
        <span>Average moving speed</span><b>${d.moving > 0 ? mph(d.dist / d.moving) : '0.0'} mph</b><span>Top speed</span><b>${mph(d.top)} mph</b></div>
        <div style="margin-top:12px">${this.runList(d)}</div></div>
        <div class="card" style="margin-top:12px"><h4>Elevation and speed along the descent</h4><canvas class="chart" height="230"></canvas></div></div></div>`;
    (this.body.querySelector('.back') as HTMLButtonElement).onclick = () => { this.detail = null; this.render(); };
    const [map, chart] = this.body.querySelectorAll('canvas');
    requestAnimationFrame(() => {
      const touched = new Set(d.runs.map((r) => r.key));
      this.drawMap(map as HTMLCanvasElement, (tr) => touched.has(tr.key) ? 'rgba(255,255,255,.85)' : null, d);
      this.drawChart(chart as HTMLCanvasElement, d);
    });
  }

  private prep(cv: HTMLCanvasElement) {
    const dpr = Math.min(2, devicePixelRatio), W = cv.clientWidth, H = Number(cv.getAttribute('height'));
    cv.style.height = `${H}px`; cv.width = W * dpr; cv.height = H * dpr;
    const g = cv.getContext('2d')!; g.setTransform(dpr, 0, 0, dpr, 0, 0);
    return { g, W, H };
  }

  /** Map viewed from the base like the resort map (south up). `color` styles each trail; a descent draws its line. */
  private drawMap(cv: HTMLCanvasElement, color: (t: Trail) => string | null, d?: Descent, label: (t: Trail) => boolean = (t) => !!color(t)) {
    const { g, W, H } = this.prep(cv);
    let x0 = Infinity, x1 = -Infinity, z0 = Infinity, z1 = -Infinity;
    const take = (x: number, z: number) => { x0 = Math.min(x0, x); x1 = Math.max(x1, x); z0 = Math.min(z0, z); z1 = Math.max(z1, z); };
    const tr = d?.trace;
    if (tr && tr.length >= 8) for (let i = 0; i < tr.length; i += 4) take(tr[i] / 10, tr[i + 1] / 10);
    else for (const t of this.log.trails) for (const w of t.ways) for (const p of w) take(p[0], p[2]);
    const pad = d ? 220 : 80;
    x0 -= pad; x1 += pad; z0 -= pad; z1 += pad;
    const s = Math.min(W / (x1 - x0), H / (z1 - z0)), cx = (x0 + x1) / 2, cz = (z0 + z1) / 2;
    const P = (x: number, z: number): [number, number] => [W / 2 - (x - cx) * s, H / 2 - (z - cz) * s];
    g.fillStyle = '#1b2633'; g.fillRect(0, 0, W, H);
    const m = this.resort.map;
    if (m && this.img.complete && this.img.naturalWidth) {
      const [ax, ay] = P(m.x0, m.z0), [bx, by] = P(m.x1, m.z1);
      g.save(); g.globalAlpha = 0.75; g.translate(ax, ay); g.rotate(Math.PI); g.drawImage(this.img, 0, 0, ax - bx, ay - by); g.restore();
    }
    g.lineCap = 'round'; g.lineJoin = 'round';
    for (const t of this.log.trails) {
      const c = color(t);
      for (const w of t.ways) {
        g.beginPath(); w.forEach((p, i) => { const [sx, sy] = P(p[0], p[2]); if (i) g.lineTo(sx, sy); else g.moveTo(sx, sy); });
        if (!c) { g.strokeStyle = 'rgba(210,220,230,.28)'; g.lineWidth = 1.5; g.setLineDash([4, 4]); g.stroke(); g.setLineDash([]); continue; }
        const faint = c === STATUS.unvisited;
        g.strokeStyle = 'rgba(0,0,0,.55)'; g.lineWidth = d || faint ? 3.5 : 6; g.stroke();
        g.strokeStyle = c; g.lineWidth = d || faint ? 2 : 3.5; g.stroke();
      }
    }
    // lifts
    for (const l of this.resort.lifts) {
      const [ax, ay] = P(l.bottom[0], l.bottom[2]), [bx, by] = P(l.top[0], l.top[2]);
      g.strokeStyle = '#e8245c'; g.lineWidth = 2.5; g.beginPath(); g.moveTo(ax, ay); g.lineTo(bx, by); g.stroke();
      g.font = '600 11px -apple-system, sans-serif'; g.fillStyle = '#ffd1dd'; g.textAlign = 'center'; g.fillText(l.name, (ax + bx) / 2, (ay + by) / 2 - 6);
    }
    if (tr && tr.length >= 8) {
      for (let i = 4; i < tr.length; i += 4) {
        const [ax, ay] = P(tr[i - 4] / 10, tr[i - 3] / 10), [bx, by] = P(tr[i] / 10, tr[i + 1] / 10);
        const k = Math.min(1, tr[i + 3] / 100 / SPEED_SCALE);
        g.strokeStyle = k < 0.5 ? mix('#4aa3ff', '#ffd23f', k * 2) : mix('#ffd23f', '#ff4d4d', (k - 0.5) * 2);
        g.lineWidth = 4; g.beginPath(); g.moveTo(ax, ay); g.lineTo(bx, by); g.stroke();
      }
      const [sx, sy] = P(tr[0] / 10, tr[1] / 10), [ex, ey] = P(tr[tr.length - 4] / 10, tr[tr.length - 3] / 10);
      for (const [x, y, label] of [[sx, sy, 'Start'], [ex, ey, 'Finish']] as const) {
        g.fillStyle = '#fff'; g.beginPath(); g.arc(x, y, 5, 0, Math.PI * 2); g.fill();
        g.font = 'bold 12px -apple-system, sans-serif'; g.textAlign = 'left'; g.lineWidth = 3; g.strokeStyle = 'rgba(0,0,0,.7)';
        g.strokeText(label, x + 8, y + 4); g.fillText(label, x + 8, y + 4);
      }
    } else if (d) {
      g.fillStyle = '#fff'; g.font = '13px -apple-system, sans-serif'; g.textAlign = 'center';
      g.fillText('The line is kept for your 60 most recent descents.', W / 2, H - 16);
    }
    // labels for coloured trails (skip overlaps)
    if (!d) {
      const placed: number[][] = [];
      g.font = '600 11px -apple-system, sans-serif';
      for (const t of this.log.trails.slice().sort((a, b) => b.length - a.length)) {
        if (!label(t)) continue;
        const w = t.ways[0], mid = w[Math.floor(w.length / 2)], [sx, sy] = P(mid[0], mid[2]);
        const bw = g.measureText(t.name).width + 18;
        const box = [sx - bw / 2, sy - 8, bw, 16];
        if (placed.some((b) => b[0] < box[0] + box[2] && box[0] < b[0] + b[2] && b[1] < box[1] + box[3] && box[1] < b[1] + b[3])) continue;
        placed.push(box);
        g.fillStyle = 'rgba(255,255,255,.85)'; g.beginPath(); g.roundRect(box[0], box[1], box[2], box[3], 4); g.fill();
        drawDiffSymbol(g, t.difficulty, box[0] + 8, sy, 8);
        g.fillStyle = '#111'; g.textAlign = 'left'; g.textBaseline = 'middle'; g.fillText(t.name, box[0] + 15, sy + 0.5); g.textBaseline = 'alphabetic';
      }
    }
    void DIFF_COLOR;
  }

  /** Elevation (filled) and speed (line) against distance along the descent. */
  private drawChart(cv: HTMLCanvasElement, d: Descent) {
    const { g, W, H } = this.prep(cv);
    const tr = d.trace;
    g.fillStyle = 'rgba(255,255,255,.03)'; g.fillRect(0, 0, W, H);
    if (!tr || tr.length < 8) { g.fillStyle = '#ccd'; g.font = '13px -apple-system, sans-serif'; g.fillText('No profile kept for this older descent.', 12, 24); return; }
    const pts: { s: number; y: number; v: number }[] = [];
    let s = 0;
    for (let i = 0; i < tr.length; i += 4) {
      if (i) s += Math.hypot(tr[i] - tr[i - 4], tr[i + 1] - tr[i - 3], tr[i + 2] - tr[i - 2]) / 10;
      pts.push({ s, y: tr[i + 2] / 10, v: tr[i + 3] / 100 });
    }
    const L = { l: 52, r: 52, t: 14, b: 30 }, w = W - L.l - L.r, h = H - L.t - L.b;
    const ymin = Math.min(...pts.map((p) => p.y)), ymax = Math.max(...pts.map((p) => p.y)), vmax = Math.max(1, ...pts.map((p) => p.v));
    const X = (sv: number) => L.l + (sv / Math.max(1, s)) * w;
    const Y = (y: number) => L.t + h - ((y - ymin) / Math.max(1, ymax - ymin)) * h;
    const V = (v: number) => L.t + h - (v / vmax) * h;
    g.strokeStyle = 'rgba(255,255,255,.1)'; g.lineWidth = 1;
    for (let k = 0; k <= 4; k++) { const y = L.t + (h * k) / 4; g.beginPath(); g.moveTo(L.l, y); g.lineTo(L.l + w, y); g.stroke(); }
    g.beginPath(); g.moveTo(X(0), L.t + h);
    for (const p of pts) g.lineTo(X(p.s), Y(p.y));
    g.lineTo(X(s), L.t + h); g.closePath(); g.fillStyle = 'rgba(155,190,220,.35)'; g.fill();
    g.beginPath(); pts.forEach((p, i) => { if (i) g.lineTo(X(p.s), Y(p.y)); else g.moveTo(X(p.s), Y(p.y)); }); g.strokeStyle = '#b9d3ea'; g.lineWidth = 2; g.stroke();
    g.beginPath(); pts.forEach((p, i) => { if (i) g.lineTo(X(p.s), V(p.v)); else g.moveTo(X(p.s), V(p.v)); }); g.strokeStyle = '#ffb02e'; g.lineWidth = 2; g.stroke();
    g.font = '11px -apple-system, sans-serif'; g.fillStyle = '#b9d3ea'; g.textAlign = 'right';
    g.fillText(`${ft(ymax)} ft`, L.l - 6, L.t + 8); g.fillText(`${ft(ymin)} ft`, L.l - 6, L.t + h);
    g.fillStyle = '#ffb02e'; g.textAlign = 'left';
    g.fillText(`${mph(vmax)} mph`, L.l + w + 6, L.t + 8); g.fillText('0 mph', L.l + w + 6, L.t + h);
    g.fillStyle = '#cfd8e2'; g.textAlign = 'center';
    g.fillText(`${mi(s)} mi`, L.l + w, H - 8); g.fillText('0 mi', L.l, H - 8);
    g.textAlign = 'right'; g.fillStyle = '#b9d3ea'; g.fillText('Elevation', L.l + w / 2 - 8, H - 8);
    g.textAlign = 'left'; g.fillStyle = '#ffb02e'; g.fillText('Speed', L.l + w / 2 + 8, H - 8);
  }
}

function mix(a: string, b: string, k: number) {
  const pa = parseInt(a.slice(1), 16), pb = parseInt(b.slice(1), 16);
  const c = (sh: number) => Math.round(((pa >> sh) & 255) * (1 - k) + ((pb >> sh) & 255) * k);
  return `rgb(${c(16)},${c(8)},${c(0)})`;
}
