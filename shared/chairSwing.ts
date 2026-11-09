// Two-axis damped pendulum about the fixed grip. SI units, local +x right, -z forward.
// The release threshold is an easter-egg tuning choice, not an equipment safety model.
import { HANGER, RIDER_ROOT_BELOW_SEAT, RIDER_ROOT_FORWARD, SEAT_TOP, type LiftPath } from './lifts';
import type { Vec3 } from './skiPhysics';

export interface ChairSwing {
  roll: number; pitch: number; rollV: number; pitchV: number;
  leanX: number; leanZ: number; slip: number; slipX: number; slipZ: number;
}
export interface RockInput { right: number; forward: number }
export const CHAIR_SWING = { length: HANGER + .15, gravity: 9.81, damping: .16, drive: .36, releaseAngle: .62, releaseSlip: .72 };
export const createChairSwing = (): ChairSwing => ({ roll: 0, pitch: 0, rollV: 0, pitchV: 0, leanX: 0, leanZ: 0, slip: 0, slipX: 0, slipZ: 0 });
export const swingEnergy = (s: ChairSwing) => s.roll * s.roll + s.pitch * s.pitch + (s.rollV * s.rollV + s.pitchV * s.pitchV) * CHAIR_SWING.length / CHAIR_SWING.gravity;
/** Share carrier rotation, while each occupant keeps their own lean and cushion contact. */
export function carriedSwing(own: ChairSwing, carrier?: ChairSwing): ChairSwing {
  return carrier ? { ...own, roll: carrier.roll, pitch: carrier.pitch, rollV: carrier.rollV, pitchV: carrier.pitchV } : own;
}
const clamp = (x: number, n: number) => Number.isFinite(x) ? Math.max(-n, Math.min(n, x)) : 0;

/** A held lean settles; reversing in time with the swing adds energy. Never count keypresses. */
export function stepChairSwing(s: ChairSwing, input: RockInput, dt: number, canSlip = true) {
  const duration = Math.max(0, Math.min(.1, dt));
  const steps = Math.max(1, Math.ceil(duration * 240)), h = duration / steps, P = CHAIR_SWING;
  const length = Math.max(1, Math.hypot(input.right, input.forward));
  const right = clamp(input.right / length, 1), forward = clamp(input.forward / length, 1);
  for (let i = 0; i < steps; i++) {
    const k = 1 - Math.exp(-4 * h);
    s.leanX += (right - s.leanX) * k;
    s.leanZ += (forward - s.leanZ) * k;
    s.rollV += (-P.gravity / P.length * Math.sin(s.roll) - P.damping * s.rollV + P.drive * s.leanX) * h;
    s.pitchV += (-P.gravity / P.length * Math.sin(s.pitch) - P.damping * s.pitchV + P.drive * s.leanZ) * h;
    s.roll = clamp(s.roll + s.rollV * h, 1.05);
    s.pitch = clamp(s.pitch + s.pitchV * h, 1.05);
    if (!s.slip && canSlip && Math.hypot(s.roll, s.pitch) > P.releaseAngle) {
      // Lose the seated posture, drop the hips below the lap bar, and slide off the
      // front/side of the cushion. No broken grip or detached carrier is implied.
      s.slip = .001;
      s.slipX = -Math.sign(s.roll || s.leanX) * Math.min(.75, Math.abs(s.roll) / P.releaseAngle);
      s.slipZ = -Math.sqrt(1 - s.slipX * s.slipX);
    }
    if (s.slip) s.slip = Math.min(P.releaseSlip, s.slip + h * (.55 + s.slip * 1.5));
  }
  return s.slip >= P.releaseSlip;
}

/** Rotation R_y(heading) R_x(pitch) R_z(roll), shared by the seat, skier and server. */
export function rotateChairVector(v: Vec3, heading: number, pitch: number, roll: number): Vec3 {
  const cr = Math.cos(roll), sr = Math.sin(roll), cp = Math.cos(pitch), sp = Math.sin(pitch);
  const x = cr * v.x - sr * v.y, y = sr * v.x + cr * v.y;
  const py = cp * y - sp * v.z, z = sp * y + cp * v.z;
  return { x: Math.cos(heading) * x + Math.sin(heading) * z, y: py, z: -Math.sin(heading) * x + Math.cos(heading) * z };
}

export function swingingRiderPoint(path: LiftPath, chair: number, seat: number, t: number, s: ChairSwing) {
  // Preserve the original transform exactly when idle, including the loading transition.
  if (!s.roll && !s.pitch && !s.slip) return path.riderPoint(chair, seat, t);
  const u = path.chairU(chair, t), p = path.loopPoint(u);
  const offset = rotateChairVector({ x: path.seatOffset(seat) + s.slipX * s.slip,
    y: -HANGER + SEAT_TOP - RIDER_ROOT_BELOW_SEAT - s.slip * .4,
    z: .12 - RIDER_ROOT_FORWARD + s.slipZ * s.slip }, p.heading, s.pitch, s.roll + path.chairBank(u));
  p.p.x += offset.x; p.p.y += offset.y; p.p.z += offset.z;
  return p;
}

/** True derivative of the moving/rotating seat, including the last slide off its edge. */
export function chairReleaseVelocity(path: LiftPath, chair: number, seat: number, t: number, s: ChairSwing): Vec3 {
  const eps = .001, a = swingingRiderPoint(path, chair, seat, t - eps, { ...s,
    roll: s.roll - s.rollV * eps, pitch: s.pitch - s.pitchV * eps,
    slip: Math.max(0, s.slip - eps * (.55 + s.slip * 1.5)) }).p;
  const b = swingingRiderPoint(path, chair, seat, t, s).p;
  return { x: (b.x - a.x) / eps, y: (b.y - a.y) / eps, z: (b.z - a.z) / eps };
}

/** Wire bounds: a chair report can never inject an arbitrary position or launch velocity. */
export function validChairSwing(s: ChairSwing | undefined): s is ChairSwing {
  return !!s && [s.roll, s.pitch, s.rollV, s.pitchV, s.leanX, s.leanZ, s.slip, s.slipX, s.slipZ].every(Number.isFinite)
    && Math.abs(s.roll) <= 1.05 && Math.abs(s.pitch) <= 1.05 && Math.abs(s.rollV) <= 3 && Math.abs(s.pitchV) <= 3
    && Math.abs(s.leanX) <= 1 && Math.abs(s.leanZ) <= 1 && s.slip >= 0 && s.slip <= CHAIR_SWING.releaseSlip
    && Math.abs(s.slipX) <= 1 && s.slipZ <= 0 && s.slipZ >= -1;
}
