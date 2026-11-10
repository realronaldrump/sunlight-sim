import { MountainGuest, readGuestCheckpoint, type GuestCheckpoint, type GuestPose } from '../../../shared/mountainGuest';
import { browserLoader } from '../terrain/heightfield';
import { loadGuestWorld, type GuestResort } from './mountainGuestWorld';
import type { SantaTraces, SantaVisitor } from '../../../shared/santaFestivities';

export type GuestWorkerRequest =
  | { type: 'start'; base: string; resort: GuestResort; seed: number; saved: unknown }
  | { type: 'step'; at: number; times: number[]; occupied: { lift: number; chair: number; seat: number } | null; open: boolean; visitor?: SantaVisitor };
export type GuestWorkerResponse =
  | { type: 'ready'; pose: GuestPose; at: number; saved: GuestCheckpoint; traces: SantaTraces }
  | { type: 'pose'; pose: GuestPose; at: number; saved?: GuestCheckpoint; traces?: SantaTraces }
  | { type: 'error'; reason: string };

let guest: MountainGuest | undefined, last = 0, nextSave = 0, tracesAfter = 0;
function send(msg: GuestWorkerResponse) { self.postMessage(msg); }

self.onmessage = async ({ data }: MessageEvent<GuestWorkerRequest>) => {
  if (data.type === 'start') {
    try {
      const { navigation, colliders } = await loadGuestWorld(data.base, data.resort, browserLoader);
      const saved = readGuestCheckpoint(data.saved, navigation);
      guest = new MountainGuest(navigation, colliders, data.seed, saved ?? undefined);
      last = Date.now() / 1000;
      tracesAfter = guest.age;
      send({ type: 'ready', pose: guest.pose(), at: last, saved: guest.checkpoint(), traces: guest.santaTraces() });
    } catch (err) {
      send({ type: 'error', reason: err instanceof Error ? err.message : String(err) });
    }
    return;
  }
  if (!guest) return;
  const { at, times, occupied, open, visitor } = data;
  guest.advance(at - last, times, (lift, chair, seat) =>
    !(occupied?.lift === lift && occupied.chair === chair && occupied.seat === seat), open, visitor ? [visitor] : []);
  last = at;
  const saved = at >= nextSave ? guest.checkpoint() : undefined;
  if (saved) nextSave = at + .8;
  let traces: SantaTraces | undefined;
  if (guest.age - tracesAfter >= .25) {
    const update = guest.santaTraces(tracesAfter);
    tracesAfter = guest.age;
    if (update.firs || update.tracks.length) traces = update;
  }
  send({ type: 'pose', pose: guest.pose(), at, saved, traces });
};
