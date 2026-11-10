import type { FirInstance } from './treeData';
// Static collider spatial hash (trees, towers, buildings). Shared by client, tests and server.
import { SkierState, collideCylinder, collideBox } from './skiPhysics';

/** `bottom` (optional) lets upper-storey walls and overhangs leave the space beneath them free. */
export interface Collider { type: 'cyl' | 'box'; x: number; z: number; r?: number; hx?: number; hz?: number; yaw?: number; top: number; bottom?: number; fir?: FirInstance }

export class ColliderGrid {
  private cells = new Map<number, Collider[]>();
  constructor(private cell = 8) {}

  private key(i: number, j: number) { return (i + 32768) * 65536 + (j + 32768); }

  add(c: Collider) {
    const ext = c.type === 'cyl' ? c.r! : Math.hypot(c.hx!, c.hz!);
    const i0 = Math.floor((c.x - ext) / this.cell), i1 = Math.floor((c.x + ext) / this.cell);
    const j0 = Math.floor((c.z - ext) / this.cell), j1 = Math.floor((c.z + ext) / this.cell);
    for (let i = i0; i <= i1; i++) for (let j = j0; j <= j1; j++) {
      const k = this.key(i, j);
      let a = this.cells.get(k);
      if (!a) { a = []; this.cells.set(k, a); }
      a.push(c);
    }
  }

  query(x: number, z: number, out: Collider[] = []) {
    out.length = 0;
    const i = Math.floor(x / this.cell), j = Math.floor(z / this.cell);
    for (let di = -1; di <= 1; di++) for (let dj = -1; dj <= 1; dj++) {
      const a = this.cells.get(this.key(i + di, j + dj));
      if (a) for (const c of a) out.push(c);
    }
    return out;
  }

  /** Resolve skier collisions; returns the number of contacts. */
  collide(st: SkierState): number {
    const near = this.query(st.pos.x, st.pos.z);
    let n = 0;
    for (const c of near) {
      if (st.pos.y > c.top + 0.5) continue; // flying over (e.g. small trees)
      if (c.bottom !== undefined && st.pos.y + 1.7 < c.bottom) continue; // passing under
      if (c.type === 'cyl') { if (collideCylinder(st, c.x, c.z, c.r!)) n++; }
      else if (collideBox(st, c.x, c.z, c.hx!, c.hz!, c.yaw ?? 0)) n++;
    }
    return n;
  }
}
