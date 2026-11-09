// Resort guests with a stable identity. The same person (jacket, skin tone, helmet or beanie) waits in a
// lift line, rides the chair, skis off the unload ramp, finishes a run and lines up again, so the
// mountain is populated by people you can recognize from one place to the next.
import * as THREE from 'three/webgpu';
import type { Appearance } from './pedestrian';
import type { Persona } from '../../../shared/skiBot';

export const JACKETS = [0x1d2a44, 0x111317, 0xb3262e, 0x1f6f78, 0x6d1f2f, 0x4b5a2a, 0xe8e6e0, 0xd8642a, 0x55306f, 0x5f8fc4, 0xc9a227, 0x2e5a3c, 0x8c8f94, 0x23324f, 0x1f6fd1, 0x2e9e44, 0x7b3fbf, 0xff6f91, 0x1aa3a3];
export const SKINS = [[1, 1, 1], [0.96, 0.86, 0.77], [0.84, 0.68, 0.56], [0.64, 0.49, 0.39], [0.47, 0.35, 0.28]];
export const HELMETS = [0xf2f2f0, 0x1a1a1c, 0x5b6068, 0x1c2f55, 0xa8242b, 0x2d5f3c, 0xd8d0c0];
export const BEANIES = [0xb3262e, 0x1c2f55, 0xd9b44a, 0x2e2e2e, 0x7a8a99, 0xe07b39, 0x3d6b4f, 0xe9e4da];

export interface GuestLook {
  jacket: number; skin: number[]; hat: 'helmet' | 'beanie'; hatColor: number;
  /** Body scale: 1 for adults, about 0.7 to 0.8 for children in ski school. */
  scale?: number;
  /** Ski school bib over the jacket. */
  bib?: { color: number; number: string; text?: string };
}
export interface Guest { id: number; look: GuestLook; persona: Persona; group?: string }

export function rng(seed: number) { let s = Math.max(1, Math.floor(seed) % 2147483647); return () => { s = (s * 16807) % 2147483647; return (s - 1) / 2147483646; }; }
export const pick = <T>(a: T[], r: () => number) => a[Math.floor(r() * a.length) % a.length];

let nextId = 1;
const registry = new Map<number, Guest>();

/** A new adult guest. `jacket` fixes the jacket when it was already seen (a chair rider becoming a skier). */
export function guestLook(r: () => number, opts: { jacket?: number; indoor?: boolean } = {}): GuestLook {
  const beanie = r() < (opts.indoor ? 0.55 : 0.28);
  const jacket = opts.jacket ?? pick(JACKETS, r);
  const skin = pick(SKINS, r);
  return { jacket, skin, hat: beanie ? 'beanie' : 'helmet', hatColor: beanie ? pick(BEANIES, r) : pick(HELMETS, r) };
}

export function makeGuest(r: () => number, opts: { jacket?: number; indoor?: boolean; persona?: Persona } = {}): Guest {
  const look = guestLook(r, opts);
  const a = r();
  const persona: Persona = opts.persona ?? (a < 0.3 ? 'beginner' : 'intermediate');
  const g: Guest = { id: nextId++, look, persona };
  registry.set(g.id, g);
  if (registry.size > 4000) registry.delete(registry.keys().next().value!);
  return g;
}

export function registerGuest(g: Guest) { registry.set(g.id, g); return g; }
export function guestById(id: number) { return registry.get(id); }

export function guestAppearance(g: Guest): Appearance {
  const s = g.look.skin;
  return {
    jacket: new THREE.Color(g.look.jacket), skin: new THREE.Color(s[0], s[1], s[2]),
    hat: g.look.hat, hatColor: new THREE.Color(g.look.hatColor), instancedGear: true, lod: 'crowd',
  };
}
