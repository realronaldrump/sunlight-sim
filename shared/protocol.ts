// Multiplayer wire protocol (JSON over WebSocket). Shared by client and server.

export const MAX_PLAYERS = 8;
export const TICK_HZ = 15;
export const MAX_SPEED = 70; // m/s; anything faster between updates is treated as a teleport

export interface NetSkier {
  x: number; y: number; z: number; heading: number;
  vx: number; vy: number; vz: number;
  mode: string; edge: number; plow: number; tuck: number; fallen: number;
}

export interface NetRide { lift: number; chair: number; seat: number }

export interface PlayerInfo {
  id: string; name: string; color: string;
  s: NetSkier; ride: NetRide | null; t: number;
}

export type ClientMsg =
  | { type: 'join'; room: string; name: string; color: string }
  | { type: 'state'; s: NetSkier; teleport?: boolean }
  | { type: 'board'; lift: number; chair: number; seat: number }
  | { type: 'unload' }
  | { type: 'chat'; text: string }
  | { type: 'ping'; t: number };

export type ServerMsg =
  | { type: 'welcome'; id: string; room: string; serverTime: number; players: PlayerInfo[] }
  | { type: 'error'; reason: string }
  | { type: 'joined'; player: PlayerInfo }
  | { type: 'left'; id: string }
  | { type: 'snapshot'; serverTime: number; players: PlayerInfo[] }
  | { type: 'boarded'; id: string; lift: number; chair: number; seat: number }
  | { type: 'boardRejected'; reason: string }
  | { type: 'unloaded'; id: string }
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
