// The mountain status board by the Lesson Line-Up Area, laid out like Sunlight's online mountain
// status: current weather, snowfall, base and surface, lift status, trails groomed overnight and when
// the Snowriders' Club lesson heads out. It updates as the time of day, weather and lesson change.
import * as THREE from 'three/webgpu';
import type { ColliderGrid } from '../../../shared/collision';

export interface Conditions {
  clock: string; weather: string; tempF: number;
  snow: { since4: number; day: number; twoDay: number; season: number }; baseIn: number;
  surface: [string, string];
  lifts: { name: string; status: string; open: boolean }[];
  trailsOpen: number; trailsTotal: number;
  groomed: string[]; groomedAt: string;
  lesson: string;
}

export class ConditionsBoard {
  readonly group = new THREE.Group();
  private canvas = document.createElement('canvas');
  private ctx: CanvasRenderingContext2D;
  private tex: THREE.CanvasTexture;
  private last = '';

  constructor(x: number, z: number, facing: number, height: (x: number, z: number) => number, colliders: ColliderGrid) {
    this.group.name = 'mountain-status-board';
    this.canvas.width = 1024; this.canvas.height = 720;
    this.ctx = this.canvas.getContext('2d')!;
    this.tex = new THREE.CanvasTexture(this.canvas);
    this.tex.colorSpace = THREE.SRGBColorSpace; this.tex.anisotropy = 8;
    const y = height(x, z);
    const wood = new THREE.MeshStandardNodeMaterial({ color: 0x4f3a28, roughness: 0.9 });
    const face = new THREE.Mesh(new THREE.PlaneGeometry(1.7, 1.2), new THREE.MeshStandardNodeMaterial({ map: this.tex, roughness: 0.75 }));
    face.position.set(0, 1.55, 0.04); this.group.add(face);
    const back = new THREE.Mesh(new THREE.BoxGeometry(1.84, 1.34, 0.06), wood); back.position.set(0, 1.55, 0); this.group.add(back);
    const roof = new THREE.Mesh(new THREE.BoxGeometry(2.0, 0.06, 0.34), wood); roof.position.set(0, 2.27, 0.06); roof.rotation.x = 0.18; this.group.add(roof);
    const cap = new THREE.Mesh(new THREE.BoxGeometry(1.98, 0.05, 0.32), new THREE.MeshStandardNodeMaterial({ color: 0xf4f7fa, roughness: 0.95 }));
    cap.position.set(0, 2.31, 0.06); cap.rotation.x = 0.18; this.group.add(cap); // snow on the little roof
    for (const s of [-0.85, 0.85]) {
      const post = new THREE.Mesh(new THREE.BoxGeometry(0.11, 2.4, 0.11), wood); post.position.set(s, 1.1, -0.02); this.group.add(post);
    }
    this.group.position.set(x, y - 0.1, z); this.group.rotation.y = facing;
    this.group.traverse((o) => { if ((o as THREE.Mesh).isMesh) { o.castShadow = true; o.receiveShadow = true; } });
    for (const s of [-0.85, 0.85]) colliders.add({ type: 'cyl', x: x + Math.cos(facing) * s, z: z - Math.sin(facing) * s, r: 0.12, top: y + 2.3 });
  }

  update(c: Conditions) {
    const key = JSON.stringify(c);
    if (key === this.last) return;
    this.last = key;
    const g = this.ctx, W = 1024, H = 720;
    g.fillStyle = '#163f2a'; g.fillRect(0, 0, W, H);
    g.strokeStyle = '#e9e2c8'; g.lineWidth = 6; g.strokeRect(10, 10, W - 20, H - 20);
    const text = (t: string, x: number, y: number, px: number, color = '#f3eedc', weight = 'bold', align: CanvasTextAlign = 'left') => {
      g.font = `${weight} ${px}px Helvetica, Arial, sans-serif`; g.fillStyle = color; g.textAlign = align; g.textBaseline = 'alphabetic'; g.fillText(t, x, y);
    };
    text('SUNLIGHT MOUNTAIN', 36, 70, 46);
    text('MOUNTAIN STATUS', 36, 104, 24, '#c9d8b9', '600');
    text(c.clock, W - 36, 70, 40, '#f3eedc', 'bold', 'right');
    text(`${c.weather}  ·  ${c.tempF}°F`, W - 36, 104, 24, '#c9d8b9', '600', 'right');
    g.fillStyle = 'rgba(233,226,200,.35)'; g.fillRect(36, 122, W - 72, 3);
    // snowfall row
    const cols = [['SINCE 4 PM', `${c.snow.since4}"`], ['24 HOURS', `${c.snow.day}"`], ['48 HOURS', `${c.snow.twoDay}"`], ['SEASON', `${c.snow.season}"`], ['BASE', `${c.baseIn}"`]];
    cols.forEach(([label, value], i) => { const x = 36 + i * 192; text(label, x, 160, 20, '#c9d8b9', '600'); text(value, x, 210, 46); });
    text(`Surface: ${c.surface[0]}, ${c.surface[1].toLowerCase()}`, 36, 252, 24, '#f3eedc', '500');
    g.fillStyle = 'rgba(233,226,200,.35)'; g.fillRect(36, 270, W - 72, 3);
    // lifts
    text('LIFTS', 36, 308, 22, '#c9d8b9', '600');
    c.lifts.forEach((l, i) => {
      const y = 348 + i * 40;
      g.fillStyle = l.open ? '#57c26b' : '#d9534f'; g.beginPath(); g.arc(46, y - 9, 9, 0, Math.PI * 2); g.fill();
      text(l.name, 66, y, 28); text(l.status, 300, y, 22, '#c9d8b9', '500', 'right');
    });
    text(`Trails open: ${c.trailsOpen} of ${c.trailsTotal}`, 36, 486, 24, '#f3eedc', '600');
    // grooming report
    text(`GROOMED ${c.groomedAt.toUpperCase()}`, 360, 308, 22, '#c9d8b9', '600');
    c.groomed.slice(0, 12).forEach((name, i) => {
      const x = 360 + (i % 2) * 320, y = 346 + Math.floor(i / 2) * 34;
      g.fillStyle = '#e9e2c8'; g.fillRect(x, y - 15, 18, 3); g.fillRect(x, y - 9, 18, 3); g.fillRect(x, y - 3, 18, 3);
      text(name, x + 28, y, 24, '#f3eedc', '500');
    });
    g.fillStyle = 'rgba(233,226,200,.35)'; g.fillRect(36, 568, W - 72, 3);
    text('SKI & RIDE SCHOOL', 36, 608, 22, '#c9d8b9', '600');
    text(c.lesson, 36, 650, 28, '#ffcf9e', '600');
    text('Lesson Line-Up Area: this way through the breezeway', 36, 690, 20, '#c9d8b9', '500');
    this.tex.needsUpdate = true;
  }
}
