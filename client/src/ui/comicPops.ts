// Comic-book exclamations that pop up over the 3D scene ("BONK!", "WHEEEE!", "YARD SALE!").
import * as THREE from 'three/webgpu';

const css = `
.comic-pop { position: fixed; z-index: 11; pointer-events: none; transform: translate(-50%, -50%); font: 900 44px "Arial Black", Impact, "Helvetica Neue", sans-serif; letter-spacing: 1px;
  color: #ffd21f; -webkit-text-stroke: 3px #1a1a1a; paint-order: stroke fill; text-shadow: 4px 5px 0 #c22a1c; white-space: nowrap; }
@media (max-width: 700px) { .comic-pop { font-size: 30px; } }
`;
interface Pop { el: HTMLElement; at: THREE.Vector3; follow?: () => THREE.Vector3 | null; age: number; life: number; tilt: number }

export class ComicPops {
  private pops: Pop[] = [];
  private v = new THREE.Vector3();
  constructor() { const s = document.createElement('style'); s.textContent = css; document.head.appendChild(s); }

  pop(text: string, at: THREE.Vector3, opts: { life?: number; color?: string; follow?: () => THREE.Vector3 | null } = {}) {
    const el = document.createElement('div'); el.className = 'comic-pop'; el.textContent = text;
    if (opts.color) el.style.color = opts.color;
    document.body.appendChild(el);
    this.pops.push({ el, at: at.clone(), follow: opts.follow, age: 0, life: opts.life ?? 1.8, tilt: (Math.random() - 0.5) * 18 });
  }

  update(dt: number, camera: THREE.Camera) {
    for (const p of this.pops) {
      p.age += dt;
      const f = p.follow?.(); if (f) p.at.copy(f);
      this.v.copy(p.at); this.v.y += 0.8 + p.age * 0.6; this.v.project(camera);
      const k = p.age / p.life, scale = p.age < 0.18 ? 0.3 + 1.0 * (p.age / 0.18) : 1.3 - 0.3 * Math.min(1, (p.age - 0.18) / 0.25);
      const visible = this.v.z < 1 && Math.abs(this.v.x) < 1.2 && Math.abs(this.v.y) < 1.2;
      p.el.style.display = visible ? 'block' : 'none';
      p.el.style.left = `${(this.v.x * 0.5 + 0.5) * innerWidth}px`; p.el.style.top = `${(-this.v.y * 0.5 + 0.5) * innerHeight}px`;
      p.el.style.transform = `translate(-50%, -50%) rotate(${p.tilt}deg) scale(${scale})`;
      p.el.style.opacity = String(k < 0.75 ? 1 : Math.max(0, 1 - (k - 0.75) / 0.25));
    }
    this.pops = this.pops.filter((p) => { if (p.age < p.life) return true; p.el.remove(); return false; });
  }
}
