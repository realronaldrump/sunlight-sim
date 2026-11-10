// Ski physics. Pure module (no Three.js) so it runs in the browser, in Node tests and in the
// scripted test harness. Units: SI. Game axes: +x east, +y up, +z south.
//
// Model (see DECISIONS.md D8 for sources and values):
//  - gravity resolved on the local slope (terrain normal from the 1 m heightfield)
//  - snow friction mu(v, surface) * N along the direction of travel
//  - aerodynamic drag 0.5 rho CdA v^2, CdA from stance (upright, tuck, wedge)
//  - skis have a heading; the snow resists sideways motion of the skis (edge grip). If the grip
//    needed exceeds what the edges can hold, the skis skid and the lateral friction scrubs speed
//  - turning: edge angle follows the steering input with a lag (weight shift); an edged ski
//    carves an arc of radius R_sidecut * cos(edge); at low speed the skier can also pivot (steer)
//    the skis, which creates a skid
//  - snowplow (wedge) adds braking proportional to the normal force; hockey stop turns the skis
//    across the direction of travel and sets the edges
//  - collisions and hard landings cause a fall; the fallen skier slides to a stop

export interface Vec3 { x: number; y: number; z: number }

export interface SurfaceInfo {
  groomed: number; // 0..1 groomed corduroy
  piste: number;   // 0..1 inside a marked run (packed by skier traffic)
  moguls: number;  // 0..1 mogul field
  /** 0..1 traffic-polished hardpack (optional: client snow memory). Faster, and edges hold less. */
  worn?: number;
  /** 0..1 cover of new snow over the base (optional). Slower, softer. */
  fresh?: number;
}

export interface TerrainProbe {
  height(x: number, z: number): number;
  normal(x: number, z: number, out: Vec3): Vec3;
  surface(x: number, z: number): SurfaceInfo;
}

export interface SkiInput {
  steer: number;   // -1 (left) .. 1 (right)
  tuck: boolean;
  plow: number;    // 0..1 wedge / brake
  stop: boolean;   // hockey stop
  push: boolean;   // pole/skate push on flats (same key as tuck at low speed)
  /** Standing in a lift line: poles planted to hold position on the sloped loading snow. */
  hold?: boolean;
  /** An AI skier's target for progressive braking on snow, in meters per second. */
  cruiseSpeed?: number;
}

export type SkierMode = 'skiing' | 'air' | 'fallen' | 'gettingUp' | 'riding' | 'standing';

export interface SkierState {
  pos: Vec3;
  vel: Vec3;
  heading: number;   // yaw of the skis, radians; 0 = facing -z (north), positive = turning left (CCW from above)
  edge: number;      // current edge angle, radians, + = turning right (right edges / inside of right turn)
  plow: number;      // current wedge amount 0..1
  tuck: number;      // current tuck amount 0..1
  mode: SkierMode;
  modeTime: number;
  grounded: boolean;
  skid: number;      // 0 carving .. 1 full skid (for audio/visuals)
  slopeDeg: number;
  speed: number;
  lastImpact: number;
  normal: Vec3;
}

export const PARAMS = {
  mass: 75,                // kg incl. gear
  g: 9.81,
  rho: 0.96,               // air density at ~2700 m, -5 C (kg/m^3)
  cdaUpright: 0.6,         // m^2 recreational skier standing tall
  cdaTuck: 0.3,            // m^2 recreational tuck (racers ~0.15-0.25)
  cdaPlow: 0.65,           // m^2
  muGroomedSlow: 0.10,     // ski-snow kinetic friction at walking speed (groomed)
  muGroomedFast: 0.045,    // at >15 m/s (meltwater lubrication)
  muPowderExtra: 0.05,     // ungroomed snow adds resistance
  powderDrag: 0.9,         // N per (m/s) per unit off-piste, ploughing drag
  muStatic: 0.11,          // static along-ski friction (stand still on gentle slopes)
  sidecutRadius: 14,       // m, typical all-mountain ski
  maxEdge: 1.0,            // rad (~57 deg) max edge angle for strong carving
  edgeRate: 3.2,           // 1/s edge angle response (weight shift lag)
  pivotRateLow: 1.9,       // rad/s skis can be steered at low speed
  pivotFadeSpeed: 9,       // m/s speed where pivoting fades to ~1/3
  gripFlat: 0.32,          // lateral grip coefficient with flat skis
  gripEdged: 1.05,         // lateral grip with edges set (hard groomed snow)
  skidMu: 0.45,            // friction of skis sliding sideways (skidding)
  plowDecel: 0.32,         // wedge braking as fraction of normal force (g cos slope)
  stopMu: 0.75,            // hockey stop friction coefficient
  pushAccel: 1.6,          // m/s^2 from poling/skating on flats
  pushMaxSpeed: 4.2,       // m/s, pushing no longer helps above this
  fallImpactSpeed: 2.2,    // m/s into an obstacle causes a fall
  hardLanding: 8.5,        // m/s normal landing speed causes a fall
  fallenMu: 0.55,
  getUpTime: 1.6,
};

export function createSkier(pos: Vec3, heading = 0): SkierState {
  return {
    pos: { ...pos }, vel: { x: 0, y: 0, z: 0 }, heading, edge: 0, plow: 0, tuck: 0,
    mode: 'standing', modeTime: 0, grounded: true, skid: 0, slopeDeg: 0, speed: 0, lastImpact: 0,
    normal: { x: 0, y: 1, z: 0 },
  };
}

const dot = (a: Vec3, b: Vec3) => a.x * b.x + a.y * b.y + a.z * b.z;
const len = (a: Vec3) => Math.sqrt(dot(a, a));

/** Ski direction (unit, horizontal) for a heading. */
export function headingDir(h: number): Vec3 {
  return { x: -Math.sin(h), y: 0, z: -Math.cos(h) };
}
export function headingFromDir(x: number, z: number) {
  return Math.atan2(-x, -z);
}

function wrapAngle(a: number) {
  while (a > Math.PI) a -= 2 * Math.PI;
  while (a < -Math.PI) a += 2 * Math.PI;
  return a;
}

const tmpN: Vec3 = { x: 0, y: 1, z: 0 };

/** Friction coefficient for the current surface and speed. */
export function snowMu(speed: number, s: SurfaceInfo) {
  const P = PARAMS;
  const base = P.muGroomedFast + (P.muGroomedSlow - P.muGroomedFast) * Math.exp(-speed / 5);
  const packed = Math.max(s.groomed, s.piste * 0.7);
  // Scraped hardpack glides about 10% faster; a few inches of new snow add resistance.
  return base + P.muPowderExtra * (1 - packed) + 0.02 * s.moguls - 0.006 * (s.worn ?? 0) * packed + 0.025 * (s.fresh ?? 0);
}

/** Advance the skier by dt seconds (call with dt <= 1/60; internally substeps). */
export function stepSkier(st: SkierState, input: SkiInput, terrain: TerrainProbe, dt: number) {
  const sub = Math.max(1, Math.ceil(dt / (1 / 120)));
  const h = dt / sub;
  for (let i = 0; i < sub; i++) substep(st, input, terrain, h);
  st.speed = len(st.vel);
}

function substep(st: SkierState, input: SkiInput, terrain: TerrainProbe, dt: number) {
  const P = PARAMS;
  st.modeTime += dt;
  if (st.mode === 'riding') return;
  if (st.mode === 'gettingUp') {
    st.vel.x *= 0.9; st.vel.z *= 0.9; st.vel.y = 0;
    st.pos.y = terrain.height(st.pos.x, st.pos.z);
    if (st.modeTime > P.getUpTime) {
      // stand up with skis across the fall line so we do not slide away
      const n = terrain.normal(st.pos.x, st.pos.z, tmpN);
      if (Math.hypot(n.x, n.z) > 0.02) {
        const fall = headingFromDir(n.x, n.z);
        const a1 = fall + Math.PI / 2, a2 = fall - Math.PI / 2;
        st.heading = Math.abs(wrapAngle(a1 - st.heading)) < Math.abs(wrapAngle(a2 - st.heading)) ? a1 : a2;
      }
      st.vel = { x: 0, y: 0, z: 0 };
      st.mode = 'standing'; st.modeTime = 0; st.edge = 0;
    }
    return;
  }

  const n = terrain.normal(st.pos.x, st.pos.z, tmpN);
  st.normal.x = n.x; st.normal.y = n.y; st.normal.z = n.z;
  st.slopeDeg = Math.acos(Math.min(1, n.y)) * 180 / Math.PI;
  const ground = terrain.height(st.pos.x, st.pos.z);
  const v = st.vel;
  const speed = len(v);
  const m = P.mass;

  // ---------- stance targets ----------
  const fallen = st.mode === 'fallen';
  const wantTuck = input.tuck && speed > P.pushMaxSpeed && !fallen ? 1 : 0;
  st.tuck += (wantTuck - st.tuck) * Math.min(1, dt * 4);
  const wantPlow = fallen ? 0 : input.plow;
  st.plow += (wantPlow - st.plow) * Math.min(1, dt * 5);
  const steer = fallen ? 0 : input.steer;
  const steerScale = 1 - 0.55 * st.tuck; // tucked skiers make only gentle turns
  const targetEdge = steer * P.maxEdge * steerScale * (1 - 0.6 * st.plow);
  st.edge += (targetEdge - st.edge) * Math.min(1, dt * P.edgeRate);

  // ---------- forces ----------
  const F: Vec3 = { x: 0, y: -m * P.g, z: 0 };
  const cda = P.cdaUpright + (P.cdaTuck - P.cdaUpright) * st.tuck + (P.cdaPlow - P.cdaUpright) * st.plow;
  const dragK = 0.5 * P.rho * cda * speed;
  F.x -= dragK * v.x; F.y -= dragK * v.y; F.z -= dragK * v.z;

  if (!st.grounded) {
    v.x += (F.x / m) * dt; v.y += (F.y / m) * dt; v.z += (F.z / m) * dt;
    st.pos.x += v.x * dt; st.pos.y += v.y * dt; st.pos.z += v.z * dt;
    // spin skis toward travel direction slowly in the air
    const g2 = terrain.height(st.pos.x, st.pos.z);
    if (st.pos.y <= g2) land(st, terrain, g2);
    else st.mode = fallen ? 'fallen' : 'air';
    return;
  }

  // normal force magnitude (gravity component into the slope); curvature handled by the ground constraint
  const Nmag = m * P.g * n.y;
  // tangent-plane gravity is implicit in F (we project velocity back to the plane after integrating)
  const surf = terrain.surface(st.pos.x, st.pos.z);

  // ski axes in the tangent plane
  const hd = headingDir(st.heading);
  // project heading onto the tangent plane
  const hdn = dot(hd, n);
  const ski: Vec3 = { x: hd.x - n.x * hdn, y: hd.y - n.y * hdn, z: hd.z - n.z * hdn };
  const sl = len(ski) || 1;
  ski.x /= sl; ski.y /= sl; ski.z /= sl;
  // lateral axis (to the left of the skis) = n x ski
  const lat: Vec3 = { x: n.y * ski.z - n.z * ski.y, y: n.z * ski.x - n.x * ski.z, z: n.x * ski.y - n.y * ski.x };

  // tangent velocity components
  const vn = dot(v, n);
  const vt: Vec3 = { x: v.x - n.x * vn, y: v.y - n.y * vn, z: v.z - n.z * vn };
  const vPar = dot(vt, ski);
  const vLat = dot(vt, lat);
  const vtLen = Math.hypot(vPar, vLat);

  if (fallen) {
    // sliding on the body: strong friction, no steering
    if (vtLen > 0.01) {
      const f = Math.min(P.fallenMu * Nmag, (m * vtLen) / dt);
      F.x -= (vt.x / vtLen) * f; F.y -= (vt.y / vtLen) * f; F.z -= (vt.z / vtLen) * f;
    }
  } else {
    // ---- along-ski snow friction ----
    const mu = snowMu(vtLen, surf);
    if (Math.abs(vPar) > 0.02) {
      const f = Math.min(mu * Nmag, (m * Math.abs(vPar)) / dt);
      const sgn = Math.sign(vPar);
      F.x -= ski.x * f * sgn; F.y -= ski.y * f * sgn; F.z -= ski.z * f * sgn;
    } else {
      // static friction: hold still unless gravity along the skis exceeds it
      const gAlong = -m * P.g * ski.y; // gravity component along ski axis
      if (Math.abs(gAlong) < (P.muStatic + 0.35 * st.plow + (input.hold ? 0.25 : 0)) * Nmag) {
        F.x += ski.x * -gAlong; F.y += ski.y * -gAlong; F.z += ski.z * -gAlong;
      }
    }
    // off-piste ploughing drag
    const unpacked = 1 - Math.max(surf.groomed, surf.piste * 0.8);
    if (vtLen > 0.1 && unpacked > 0) {
      const f = P.powderDrag * unpacked * vtLen;
      F.x -= (vt.x / vtLen) * f; F.y -= (vt.y / vtLen) * f; F.z -= (vt.z / vtLen) * f;
    }
    // ---- snowplow ----
    if (st.plow > 0.02 && vtLen > 0.05) {
      const f = Math.min(P.plowDecel * st.plow * Nmag * Math.min(1, vtLen / 1.5), (m * vtLen) / dt);
      F.x -= (vt.x / vtLen) * f; F.y -= (vt.y / vtLen) * f; F.z -= (vt.z / vtLen) * f;
    }
    if (input.cruiseSpeed !== undefined && vtLen > input.cruiseSpeed) {
      // A controlled edge scrub builds with excess speed. Airborne momentum is untouched.
      const resistance = m * Math.min(8, (vtLen - input.cruiseSpeed) * 4.6) / vtLen;
      F.x -= resistance * vt.x; F.y -= resistance * vt.y; F.z -= resistance * vt.z;
    }
    // ---- poling / skating on the flats ----
    if (input.push && vPar >= -0.2 && vtLen < P.pushMaxSpeed && ski.y > -0.2) {
      const a = P.pushAccel * (1 - vtLen / P.pushMaxSpeed);
      F.x += ski.x * a * m; F.y += ski.y * a * m; F.z += ski.z * a * m;
    }
  }

  // ---------- integrate ----------
  v.x += (F.x / m) * dt; v.y += (F.y / m) * dt; v.z += (F.z / m) * dt;

  if (!fallen) {
    // ---- edges: lateral grip and skidding ----
    const vn2 = dot(v, n);
    const vt2: Vec3 = { x: v.x - n.x * vn2, y: v.y - n.y * vn2, z: v.z - n.z * vn2 };
    let vLat2 = dot(vt2, lat);
    const vPar2 = dot(vt2, ski);
    const edgeAbs = Math.abs(st.edge);
    const hard = Math.max(surf.groomed, surf.piste * 0.7);
    let grip = P.gripFlat + (P.gripEdged - P.gripFlat) * Math.min(1, edgeAbs / 0.35);
    grip *= 0.75 + 0.25 * hard;
    // polished, icy main lines: edges hold less and skids start sooner
    grip *= 1 - 0.2 * (surf.worn ?? 0) * hard;
    if (input.stop) grip = P.stopMu;
    const maxDv = grip * (Nmag / m) * dt; // lateral velocity the edges can remove this step
    let skid = 0;
    if (Math.abs(vLat2) <= maxDv) {
      // edges hold: velocity follows the skis (carving or straight running)
      vLat2 = 0;
    } else {
      // skidding: scrub what we can
      skid = Math.min(1, (Math.abs(vLat2) - maxDv) / Math.max(0.5, Math.abs(vLat2)) + 0.3);
      vLat2 -= Math.sign(vLat2) * maxDv;
    }
    st.skid += (skid - st.skid) * Math.min(1, dt * 8);
    // rebuild velocity: along-ski + remaining lateral + normal
    v.x = ski.x * vPar2 + lat.x * vLat2 + n.x * vn2;
    v.y = ski.y * vPar2 + lat.y * vLat2 + n.y * vn2;
    v.z = ski.z * vPar2 + lat.z * vLat2 + n.z * vn2;

    // ---- heading change: carving + pivoting ----
    const vPos = Math.abs(vPar2);
    let omega = 0;
    if (edgeAbs > 0.03 && vPos > 0.3) {
      const R = P.sidecutRadius * Math.cos(Math.min(edgeAbs, 1.3));
      // carving needs speed; at low edge angles the ski runs nearly straight
      const carve = (vPos / R) * Math.min(1, edgeAbs / 0.35) * Math.sign(vPar2 || 1);
      omega -= Math.sign(st.edge) * carve; // positive edge (right turn) rotates heading clockwise (negative yaw)
    }
    // pivot steering (rotary): strong at low speed, weak at high speed
    const pivot = P.pivotRateLow / (1 + (vPos / P.pivotFadeSpeed) ** 2) * (1 - 0.7 * st.tuck);
    omega -= steer * pivot * (vPos < 0.3 ? 0.8 : 0.55);
    if (input.stop && vtLen > 0.5) {
      // hockey stop: swing skis across the direction of travel
      const travel = headingFromDir(vt2.x, vt2.z);
      const a1 = travel + Math.PI / 2, a2 = travel - Math.PI / 2;
      const target = Math.abs(wrapAngle(a1 - st.heading)) < Math.abs(wrapAngle(a2 - st.heading)) ? a1 : a2;
      omega = wrapAngle(target - st.heading) * 7;
    }
    // natural tendency: at low edge and moving forward, skis align with travel
    if (vPos > 1 && Math.abs(steer) < 0.05 && !input.stop) {
      const travel = headingFromDir(vt2.x, vt2.z);
      const rel = wrapAngle(travel - st.heading);
      const forward = Math.abs(rel) < Math.PI / 2 ? rel : wrapAngle(rel + Math.PI);
      omega += forward * 1.2;
    }
    st.heading = wrapAngle(st.heading + omega * dt);
  }

  st.pos.x += v.x * dt; st.pos.y += v.y * dt; st.pos.z += v.z * dt;

  // ---------- ground constraint ----------
  const g2 = terrain.height(st.pos.x, st.pos.z);
  const n2 = terrain.normal(st.pos.x, st.pos.z, tmpN);
  const above = st.pos.y - g2;
  const vnNow = dot(v, n2);
  if (above <= 0.0) {
    land(st, terrain, g2);
  } else if (above < 0.06 && vnNow < 0.8) {
    // stay glued over tiny undulations (lidar noise); real crests and bumps launch the skier
    st.pos.y = g2;
    v.x -= n2.x * vnNow; v.y -= n2.y * vnNow; v.z -= n2.z * vnNow;
  } else {
    st.grounded = false;
  }
  void ground;
  if (st.mode === 'standing' && len(v) > 0.3) { st.mode = 'skiing'; st.modeTime = 0; }
  if (st.mode === 'skiing' && len(v) < 0.05 && st.plow < 0.5) { st.mode = 'standing'; st.modeTime = 0; }
}

function land(st: SkierState, terrain: TerrainProbe, g: number) {
  const n = terrain.normal(st.pos.x, st.pos.z, tmpN);
  const v = st.vel;
  const vn = dot(v, n);
  st.pos.y = g;
  if (vn < 0) {
    if (!st.grounded) st.lastImpact = -vn;
    v.x -= n.x * vn; v.y -= n.y * vn; v.z -= n.z * vn;
    // legs absorb landings and bump compressions up to a limit
    const limit = st.grounded ? PARAMS.hardLanding * 1.25 : PARAMS.hardLanding;
    if (-vn > limit && st.mode !== 'fallen') fall(st, -vn);
  }
  st.grounded = true;
  if (st.mode === 'air') { st.mode = 'skiing'; st.modeTime = 0; }
}

export function fall(st: SkierState, impact: number) {
  st.mode = 'fallen';
  st.modeTime = 0;
  st.lastImpact = impact;
  st.edge = 0; st.plow = 0; st.tuck = 0;
}

export function getUp(st: SkierState) {
  if (st.mode !== 'fallen' || !st.grounded || st.speed > 1.0) return false;
  st.mode = 'gettingUp';
  st.modeTime = 0;
  return true;
}

/**
 * Resolve a collision against a vertical cylinder (tree trunk, tower). Returns true on contact.
 * Pushes the skier out; falls if the approach speed exceeds the threshold.
 */
export function collideCylinder(st: SkierState, cx: number, cz: number, radius: number, skierRadius = 0.35): boolean {
  const dx = st.pos.x - cx, dz = st.pos.z - cz;
  const d = Math.hypot(dx, dz);
  const minD = radius + skierRadius;
  if (d >= minD || d < 1e-6) return false;
  const nx = dx / d, nz = dz / d;
  st.pos.x = cx + nx * minD; st.pos.z = cz + nz * minD;
  const vInto = -(st.vel.x * nx + st.vel.z * nz);
  if (vInto > 0) {
    st.vel.x += nx * vInto; st.vel.z += nz * vInto;
    if (vInto > PARAMS.fallImpactSpeed && st.mode !== 'fallen' && st.mode !== 'riding') {
      fall(st, vInto);
      // bounce a little and lose most speed
      st.vel.x *= 0.3; st.vel.z *= 0.3;
    }
  }
  return true;
}

/** Axis-aligned-in-local-frame box collision (buildings, stations). Box given by center, half sizes, yaw. */
export function collideBox(st: SkierState, cx: number, cz: number, hx: number, hz: number, yaw: number, skierRadius = 0.35): boolean {
  const c = Math.cos(yaw), s = Math.sin(yaw);
  const dx = st.pos.x - cx, dz = st.pos.z - cz;
  // to box local
  const lx = c * dx - s * dz, lz = s * dx + c * dz;
  const ex = hx + skierRadius, ez = hz + skierRadius;
  if (Math.abs(lx) >= ex || Math.abs(lz) >= ez) return false;
  // push out along the axis of least penetration
  const px = ex - Math.abs(lx), pz = ez - Math.abs(lz);
  let nlx = 0, nlz = 0, nlx2 = lx, nlz2 = lz;
  if (px < pz) { nlx = Math.sign(lx) || 1; nlx2 = nlx * ex; } else { nlz = Math.sign(lz) || 1; nlz2 = nlz * ez; }
  // back to world
  const wx = c * nlx + s * nlz, wz = -s * nlx + c * nlz;
  st.pos.x = cx + c * nlx2 + s * nlz2;
  st.pos.z = cz - s * nlx2 + c * nlz2;
  const vInto = -(st.vel.x * wx + st.vel.z * wz);
  if (vInto > 0) {
    st.vel.x += wx * vInto; st.vel.z += wz * vInto;
    if (vInto > PARAMS.fallImpactSpeed && st.mode !== 'fallen' && st.mode !== 'riding') {
      fall(st, vInto);
      st.vel.x *= 0.3; st.vel.z *= 0.3;
    }
  }
  return true;
}
