// Tag-along lesson panel, the instructor's spoken tips as captions, and a small name tag that marks
// the instructor when you are with the group.
import * as THREE from 'three/webgpu';
import { formatDistance } from './units';

const css = `
#lesson { position: fixed; right: 16px; bottom: 64px; z-index: 10; width: 300px; pointer-events: none; background: rgba(10,20,35,.62); backdrop-filter: blur(6px); border-radius: 10px; padding: 10px 14px; font-size: 13px; line-height: 1.45; display: none; box-shadow: 0 2px 10px rgba(0,0,0,.2); }
#lesson.show { display: block; }
#lesson .t { font-size: 11px; text-transform: uppercase; letter-spacing: .08em; opacity: .75; display: flex; justify-content: space-between; }
#lesson .now { font-size: 15px; font-weight: 650; margin: 3px 0 2px; }
#lesson .next { opacity: .85; }
#lesson .route { margin-top: 6px; font-size: 12px; opacity: .8; }
#lesson .route b { color: #7be08f; }
#lesson .k { margin-top: 6px; font-size: 11px; opacity: .7; }
#lesson kbd { background: rgba(255,255,255,.18); border-radius: 4px; padding: 0 5px; font-family: inherit; }
#caption { position: fixed; left: 50%; bottom: 30%; transform: translateX(-50%); z-index: 10; pointer-events: none; max-width: min(640px, calc(100vw - 32px)); background: rgba(10,20,35,.7); padding: 8px 16px; border-radius: 8px; font-size: 15px; opacity: 0; transition: opacity .4s; text-align: center; }
#caption.show { opacity: 1; }
#caption b { color: #ffb37a; }
#lesson-tag { position: fixed; z-index: 9; pointer-events: none; transform: translate(-50%, -100%); background: rgba(181,18,27,.85); color: #fff; padding: 2px 8px; border-radius: 10px; font-size: 12px; font-weight: 600; white-space: nowrap; display: none; }
@media (max-width: 700px) { #lesson { right: 8px; left: 8px; width: auto; bottom: 120px; } }
`;

export class LessonHud {
  private panel: HTMLElement; private caption: HTMLElement; private tag: HTMLElement;
  private captionTimer = 0;
  private lastKey = '';
  private v = new THREE.Vector3();

  constructor() {
    const style = document.createElement('style'); style.textContent = css; document.head.appendChild(style);
    this.panel = document.createElement('div'); this.panel.id = 'lesson'; document.body.appendChild(this.panel);
    this.caption = document.createElement('div'); this.caption.id = 'caption'; document.body.appendChild(this.caption);
    this.tag = document.createElement('div'); this.tag.id = 'lesson-tag'; document.body.appendChild(this.tag);
  }

  /** Speak a line once per key (the instructor does not repeat themself every frame). */
  say(key: string, speaker: string, text: string | null) {
    if (!text || key === this.lastKey) return;
    this.lastKey = key;
    this.caption.innerHTML = `<b>${speaker}:</b> ${text}`;
    this.caption.classList.add('show');
    this.captionTimer = Math.min(11, 3 + text.length / 18);
  }

  update(dt: number, s: { tagging: boolean; title: string; now: string; next: string; distance: number; waiting: boolean } | null) {
    if (this.captionTimer > 0) { this.captionTimer -= dt; if (this.captionTimer <= 0) this.caption.classList.remove('show'); }
    if (!s || !s.tagging) { this.panel.classList.remove('show'); return; }
    this.panel.classList.add('show');
    const dist = s.distance > 25 ? ` · ${formatDistance(s.distance)} away` : '';
    this.panel.innerHTML = `<div class="t"><span>${s.title}</span><span>${s.waiting ? 'waiting for you' : 'tagging along'}</span></div>
      <div class="now">${s.now}</div><div class="next">Next: ${s.next}${dist}</div>
      <div class="route">Route: Segundo lift, <b>Segundo Road</b>, <b>Ute</b>, back to the lodge</div>
      <div class="k"><kbd>L</kbd> leave the lesson</div>`;
  }

  /** Name tag above the instructor's helmet while you are with the group. */
  placeTag(camera: THREE.Camera, at: THREE.Vector3 | null, text: string) {
    if (!at) { this.tag.style.display = 'none'; return; }
    this.v.copy(at).project(camera);
    if (this.v.z > 1 || Math.abs(this.v.x) > 1.05 || Math.abs(this.v.y) > 1.05) { this.tag.style.display = 'none'; return; }
    this.tag.style.display = 'block';
    this.tag.textContent = text;
    this.tag.style.left = `${(this.v.x * 0.5 + 0.5) * innerWidth}px`;
    this.tag.style.top = `${(-this.v.y * 0.5 + 0.5) * innerHeight}px`;
  }
}
