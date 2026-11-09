// Multiplayer wire protocol (JSON over WebSocket). Shared by client and server.
import type { LiftPlayback, LiftSpeed } from './liftClock';
import type { ChairSwing } from './chairSwing';

export const MAX_PLAYERS = 8;
export const TICK_HZ = 15;
export const MAX_SPEED = 70; // m/s; anything faster between updates is treated as a teleport

export interface NetSkier {
  x: number; y: number; z: number; heading: number;
  vx: number; vy: number; vz: number;
  mode: string; edge: number; plow: number; tuck: number; fallen: number;
  swing?: ChairSwing;
  tumble?: { pitch: number; roll: number };
  /** On foot (mode 'walking' or 'sitting'): skis on the shoulder or racked, seat and table heights. */
  foot?: { carry: boolean; seat?: number; table?: number };
  /** A gesture friends can see: a wave, or a point toward actYaw (radians, relative to heading). */
  act?: 'wave' | 'point';
  actYaw?: number;
}

export interface NetRide { lift: number; chair: number; seat: number; boardedAt?: number }
export interface NetDrone { x: number; y: number; z: number; yaw: number; pitch: number; bank: number; tilt: number; rpm: number[] }

export interface PlayerInfo {
  id: string; name: string; color: string;
  s: NetSkier; ride: NetRide | null; t: number; drone?: NetDrone | null;
  controlMode?: 'skier' | 'drone';
}

export type ClientMsg =
  | { type: 'join'; room: string; name: string; color: string; controlMode?: 'skier' | 'drone' }
  | { type: 'state'; s: NetSkier; teleport?: boolean; drone?: NetDrone | null }
  | { type: 'board'; lift: number; chair: number; seat: number }
  | { type: 'unload' }
  | { type: 'liftFall'; swing: ChairSwing }
  | { type: 'liftSpeed'; rate?: LiftSpeed; cancel?: boolean; fast?: boolean }
  | { type: 'chat'; text: string }
  | { type: 'ping'; t: number };

export type ServerMsg =
  | { type: 'welcome'; id: string; room: string; serverTime: number; players: PlayerInfo[]; liftPlayback?: LiftPlayback[] }
  | { type: 'error'; reason: string }
  | { type: 'joined'; player: PlayerInfo }
  | { type: 'left'; id: string }
  | { type: 'snapshot'; serverTime: number; players: PlayerInfo[]; liftPlayback?: LiftPlayback[] }
  | ({ type: 'boarded'; id: string } & NetRide)
  | { type: 'boardRejected'; reason: string }
  | { type: 'unloaded'; id: string }
  | { type: 'liftFell'; id: string; s: NetSkier }
  | { type: 'correct'; s: NetSkier }
  | { type: 'chat'; id: string; name: string; text: string }
  | { type: 'pong'; t: number; serverTime: number };

export function sanitizeName(n: string) {
  return (n || 'Skier').replace(/[^\p{L}\p{N} ._'-]/gu, '').trim().slice(0, 18) || 'Skier';
}
export function sanitizeColor(c: string) {
  return /^#[0-9a-fA-F]{6}$/.test(c) ? c : '#d33a2c';
}
export function sanitizeRoom(r: string) {
  return (r || '').toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 8);
}
export function randomRoomCode() {
  const A = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let s = '';
  for (let i = 0; i < 5; i++) s += A[Math.floor(Math.random() * A.length)];
  return s;
}
