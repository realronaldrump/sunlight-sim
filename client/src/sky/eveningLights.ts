// @ts-nocheck -- TSL node graphs: @types/three node typings are too strict to be useful here.
// Lights coming on as the day ends. One shared level (0 by day, 1 once the sun is down) drives every
// window in the base area, so the lodge and the condos start to glow while the last skiers come in.
import { uniform, vec3, float, floor, hash, dot, positionWorld, step, mix } from 'three/tsl';

/** 0 in daylight, rising through sunset to 1 at dusk. Set by the environment from the sun's elevation. */
export const eveningLights = uniform(0);

/**
 * Give a window material a warm glow after dark. Windows share one merged mesh per building, so each
 * window decides for itself from where it is: `share` of them are lit, the rest stay dark, and no two
 * lit rooms are quite the same warmth.
 */
export function glowAtDusk(material, share = 0.6, strength = 1.5, cell = 2.6) {
  const id = floor(positionWorld.div(vec3(cell, 2.7, cell)).add(0.37));
  const pick = hash(dot(id, vec3(12.9898, 78.233, 37.719)));
  const warmth = hash(dot(id, vec3(4.1, 91.7, 53.3)));
  const on = step(float(1).sub(share), pick);
  const colour = mix(vec3(1.0, 0.62, 0.3), vec3(1.0, 0.82, 0.58), warmth);
  const glow = colour.mul(on).mul(eveningLights).mul(mix(0.55, 1.0, warmth)).mul(strength);
  material.emissiveNode = material.emissiveNode ? material.emissiveNode.add(glow) : glow;
  return material;
}
