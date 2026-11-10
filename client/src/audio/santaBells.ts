import type { Vec3 } from '../../../shared/skiPhysics';
import type { GuestPose } from '../../../shared/mountainGuest';

export const SANTA_BELL_RANGE = 62;

export function santaSoundPosition(source: Vec3, listener: Vec3, forward: Vec3) {
  const dx = source.x - listener.x, dy = source.y - listener.y, dz = source.z - listener.z;
  const distance = Math.hypot(dx, dy, dz);
  const pan = (-forward.z * dx + forward.x * dz) / Math.max(2, Math.hypot(dx, dz) * Math.hypot(forward.x, forward.z));
  return { distance, pan: Math.max(-.86, Math.min(.86, pan)) };
}

export function santaBellMix(source: GuestPose | null, listener: Vec3, forward: Vec3) {
  if (!source || source.speed < 2.1 || source.ride || source.airborne || source.fallen > .1 || source.touring > .6) return null;
  const { distance, pan } = santaSoundPosition({ x: source.x, y: source.y + 1.1, z: source.z }, listener, forward);
  if (distance >= SANTA_BELL_RANGE) return null;
  const proximity = (1 - (distance / SANTA_BELL_RANGE) ** 1.15) ** 1.65;
  const effort = Math.min(1, source.speed / 9 + .22 * Math.abs(source.edge));
  const distant = Math.max(0, Math.min(1, (distance - 19) / 29));
  return { gain: .16 * proximity * (.51 + .49 * effort), pan,
    interval: Math.max(.39, 1.02 - .037 * source.speed - .23 * Math.abs(source.edge)) + distant * 1.75,
    cutoff: 8800 - distant * 5900, echo: distance >= 27 };
}

export function santaJingle(ctx: BaseAudioContext) {
  const buffer = ctx.createBuffer(1, Math.round(ctx.sampleRate * .43), ctx.sampleRate);
  const samples = buffer.getChannelData(0);
  const hits = [[0, 1, 1], [.034, .55, .94], [.080, .32, 1.09]];
  const modes = [[1681, .28, 12], [2297, .25, 15], [3193, .19, 21], [4179, .11, 25], [5501, .07, 39]];
  for (let i = 0; i < samples.length; i++) {
    let sample = 0;
    for (const [at, gain, pitch] of hits) {
      const t = i / ctx.sampleRate - at;
      if (t < 0) continue;
      for (const [frequency, amplitude, decay] of modes) {
        sample += Math.sin(t * frequency * pitch * 2 * Math.PI) * amplitude * gain * Math.exp(-t * decay);
      }
    }
    samples[i] = sample * .62;
  }
  return buffer;
}

export function santaChime(ctx: BaseAudioContext) {
  const buffer = ctx.createBuffer(1, Math.round(ctx.sampleRate * 1.10), ctx.sampleRate);
  const samples = buffer.getChannelData(0), modes = [[1, .43, 5.0], [2, .22, 7.1], [2.72, .095, 10.3], [4.07, .070, 18]];
  for (let i = 0; i < samples.length; i++) {
    const t = i / ctx.sampleRate;
    let value = 0;
    for (const [frequency, amplitude, decay] of modes) value += Math.sin(t * 784 * frequency * 2 * Math.PI) * amplitude * Math.exp(-t * decay);
    samples[i] = value * Math.min(1, t * 320);
  }
  return buffer;
}
