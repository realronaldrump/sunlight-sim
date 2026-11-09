// Ties the snow's memory together: wear and tracks from every skier, snow falling on them, the
// overnight grooming, and saving it all in the browser so the next visit picks up where the
// mountain left off (or shows what the groomers and the weather did in between).
import type { SkiTracks } from '../skier/tracks';
import type { SurfaceMap } from '../../../shared/surface';
import { SnowState, SNOW_KEY, type SavedSnow } from './snowState';
import { dayNumber, overnightSnow } from '../world/conditions';

/** Snowfall rate while it snows in the sim: about an inch every eight minutes of play. */
const SNOW_RATE = 1 / 480;
const REC = 17;

export class SnowMemory {
  private saveTimer = 0;
  private coverTimer = 0;
  private pendingCover = 0;

  constructor(readonly state: SnowState, readonly tracks: SkiTracks, readonly crowd: SkiTracks, private surface: SurfaceMap | null,
    private storage: Storage | null = safeStorage()) {}

  /** Restore the snow from the last visit. Returns a short note about what changed while you were away. */
  load(now: number): string | null {
    const today = dayNumber(now);
    let saved: SavedSnow | null = null;
    try { const raw = this.storage?.getItem(SNOW_KEY); if (raw) saved = JSON.parse(raw); } catch { saved = null; }
    if (!saved || saved.v !== 1) {
      // first visit: the morning after any overnight storm
      const fresh = overnightSnow(today);
      if (fresh) this.state.snowfall(fresh);
      return null;
    }
    const sameDay = saved.day === today;
    this.state.restore(saved);
    const groomedAt = (x: number, z: number) => (this.surface?.at(x, z).groomed ?? 0) > 0.5;
    const tracks = unpack(saved.tracks), crowd = unpack(saved.crowd);
    if (sameDay) {
      this.tracks.restore(tracks); this.crowd.restore(crowd);
      const n = this.tracks.segments + this.crowd.segments;
      return n > 50 ? 'Your tracks from earlier today are still in the snow.' : null;
    }
    // A night (or more) went by: the cats groomed every groomed run, and any storm covered the rest.
    const keep = (flat: number[]) => {
      const out: number[] = [];
      for (let o = 0; o + REC <= flat.length; o += REC) {
        const cx = (flat[o] + flat[o + 3] + flat[o + 6] + flat[o + 9]) / 4, cz = (flat[o + 2] + flat[o + 5] + flat[o + 8] + flat[o + 11]) / 4;
        if (!groomedAt(cx, cz)) for (let j = 0; j < REC; j++) out.push(flat[o + j]);
      }
      return out;
    };
    this.state.newDay(groomedAt);
    this.tracks.restore(keep(tracks)); this.crowd.restore(keep(crowd));
    let snow = 0;
    for (let d = Math.max(saved.day + 1, today - 6); d <= today; d++) snow += overnightSnow(d);
    if (snow) { this.state.snowfall(snow); this.tracks.cover(1 - Math.exp(-snow / 2)); this.crowd.cover(1 - Math.exp(-snow / 2)); }
    const nights = today - saved.day;
    const when = nights === 1 ? 'Overnight' : `In the ${nights} nights since your last visit`;
    return snow
      ? `${when}, ${snow} in of new snow covered the old tracks and the groomers laid fresh corduroy.`
      : `${when}, the groomers laid fresh corduroy on the groomed runs. Tracks in the trees are still there.`;
  }

  save(now: number) {
    this.saveTimer = 0;
    const data: SavedSnow = { v: 1, t: now, day: dayNumber(now), ...this.state.serialize(), tracks: pack(this.tracks.serialize(0.08)), crowd: pack(this.crowd.serialize(0.12)) };
    try { this.storage?.setItem(SNOW_KEY, JSON.stringify(data)); } catch {
      // storage full: keep the snow, drop the crowd's tracks
      try { this.storage?.setItem(SNOW_KEY, JSON.stringify({ ...data, crowd: undefined })); } catch { /* blocked */ }
    }
  }

  /** Per frame: snowfall while it snows, periodic saves. */
  update(dt: number, snowing: boolean, now: number) {
    if (snowing) {
      const inches = dt * SNOW_RATE;
      this.state.snowfall(inches);
      this.pendingCover += inches;
    }
    if ((this.coverTimer += dt) > 2 && this.pendingCover > 0) {
      const k = 1 - Math.exp(-this.pendingCover / 2);
      this.tracks.cover(k); this.crowd.cover(k);
      this.pendingCover = 0; this.coverTimer = 0;
    }
    this.state.update(dt);
    if ((this.saveTimer += dt) > 30) this.save(now);
  }
}

/** Tracks, 40 bytes a segment, base64: the first ski point as float32 metres, the other three as
 * int16 millimetre offsets from it, then widths, strengths and opacity in thousandths. */
const BYTES = 40;
function pack(flat: number[]): string | undefined {
  const n = Math.floor(flat.length / REC);
  if (!n) return undefined;
  const buf = new ArrayBuffer(n * BYTES), dv = new DataView(buf);
  const i16 = (v: number) => Math.max(-32767, Math.min(32767, Math.round(v)));
  for (let k = 0; k < n; k++) {
    const o = k * REC, b = k * BYTES;
    dv.setFloat32(b, flat[o], true); dv.setFloat32(b + 4, flat[o + 1], true); dv.setFloat32(b + 8, flat[o + 2], true);
    for (let j = 3; j < 12; j++) dv.setInt16(b + 12 + (j - 3) * 2, i16((flat[o + j] - flat[o + (j % 3)]) * 1000), true);
    for (let j = 12; j < REC; j++) dv.setInt16(b + 30 + (j - 12) * 2, i16(flat[o + j] * 1000), true);
  }
  const bytes = new Uint8Array(buf);
  let s = '';
  for (let i = 0; i < bytes.length; i += 8192) s += String.fromCharCode(...bytes.subarray(i, i + 8192));
  return btoa(s);
}
function unpack(saved: string | undefined): number[] {
  if (!saved) return [];
  try {
    const raw = atob(saved), bytes = new Uint8Array(raw.length);
    for (let i = 0; i < raw.length; i++) bytes[i] = raw.charCodeAt(i);
    const dv = new DataView(bytes.buffer), n = Math.floor(bytes.length / BYTES), out: number[] = [];
    for (let k = 0; k < n; k++) {
      const b = k * BYTES, p0 = [dv.getFloat32(b, true), dv.getFloat32(b + 4, true), dv.getFloat32(b + 8, true)];
      out.push(...p0);
      for (let j = 3; j < 12; j++) out.push(p0[j % 3] + dv.getInt16(b + 12 + (j - 3) * 2, true) / 1000);
      for (let j = 12; j < REC; j++) out.push(dv.getInt16(b + 30 + (j - 12) * 2, true) / 1000);
    }
    return out;
  } catch { return []; }
}

function safeStorage(): Storage | null {
  try { return typeof localStorage === 'undefined' ? null : localStorage; } catch { return null; }
}
