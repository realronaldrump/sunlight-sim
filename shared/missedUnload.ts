// The comic missed-unload sequence, shared so every client tells the same story.
// A rider who does not stand up on the ramp clips the missed-unload gate, is whirled around the top
// bull wheel in two full loops of the chair about its grip, and is flung onto the snow beside the
// station. Deliberately exaggerated: real lifts stop at the gate. Times are real seconds since the
// chair passed the end of the stand-up window.
import type { LiftPath } from './lifts';
import type { ChairSwing } from './chairSwing';

export const MISSED = {
  loopsStart: 1.1,        // the chair reaches the bull wheel and the whirl begins
  loopsEnd: 3.5,          // the rider lets go
  loops: 2,               // full turns of the chair about the grip
  flingSpeed: 9.5,        // m/s across the snow at release
  flingLift: 7.5,         // m/s upward at release
  spin: 11,               // rad/s of tumbling in the air
};

const smooth = (x: number) => { const t = Math.max(0, Math.min(1, x)); return t * t * (3 - 2 * t); };

/** Chair swing during the sequence: a wobble after the gate, then two loops ending tipped forward. */
export function missedSwing(tau: number, out: ChairSwing): ChairSwing {
  const total = MISSED.loops * Math.PI * 2 + 0.9;
  let pitch: number, pitchV: number;
  if (tau < MISSED.loopsStart) {
    const k = tau / MISSED.loopsStart;
    pitch = 0.45 * k * Math.sin(tau * 11); pitchV = 0.45 * k * 11 * Math.cos(tau * 11);
  } else {
    const k = (tau - MISSED.loopsStart) / (MISSED.loopsEnd - MISSED.loopsStart), e = smooth(k);
    pitch = total * e; pitchV = total * 6 * k * (1 - Math.min(1, k)) / (MISSED.loopsEnd - MISSED.loopsStart);
  }
  out.pitch = pitch; out.pitchV = pitchV;
  out.roll = 0.28 * Math.sin(tau * 5.3) * smooth(tau / 0.6); out.rollV = 0.28 * 5.3 * Math.cos(tau * 5.3);
  out.leanX = 0; out.leanZ = 0; out.slip = 0; out.slipX = 0; out.slipZ = 0;
  return out;
}

/** Launch velocity: away from the returning chairs and a little back down the slope, plus a high arc. */
export function flingVelocity(path: LiftPath) {
  let dx = path.rx * 0.85 - path.ax * 0.5, dz = path.rz * 0.85 - path.az * 0.5;
  const n = Math.hypot(dx, dz); dx /= n; dz /= n;
  return { x: dx * MISSED.flingSpeed, y: MISSED.flingLift, z: dz * MISSED.flingSpeed };
}
