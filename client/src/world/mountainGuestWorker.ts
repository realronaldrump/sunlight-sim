import { MountainGuest, readGuestCheckpoint, type GuestCheckpoint, type GuestPose } from '../../../shared/mountainGuest';
import { browserLoader } from '../terrain/heightfield';
import { loadGuestWorld, type GuestResort } from './mountainGuestWorld';

export type GuestWorkerRequest =
  | { type: 'start'; base: string; resort: GuestResort; seed: number; saved: unknown }
  | { type: 'step'; at: number; times: number[]; occupied: { lift: number; chair: number; seat: number } | null; open: boolean };
export type GuestWorkerResponse =
  | { type: 'ready'; pose: GuestPose; at: number; saved: GuestCheckpoint }
  | { type: 'pose'; pose: GuestPose; at: number; saved?: GuestCheckpoint }
  | { type: 'error'; reason: string };

let guest: MountainGuest | undefined, last = 0, nextSave = 0;
function send(msg: GuestWorkerResponse) { self.postMessage(msg); }

self.onmessage = async ({ data }: MessageEvent<GuestWorkerRequest>) => {
  if (data.type === 'start') {
    try {
      const { navigation, colliders } = await loadGuestWorld(data.base, data.resort, browserLoader);
      const saved = readGuestCheckpoint(data.saved, navigation);
      guest = new MountainGuest(navigation, colliders, data.seed, saved ?? undefined);
      last = Date.now() / 1000;
      send({ type: 'ready', pose: guest.pose(), at: last, saved: guest.checkpoint() });
    } catch (err) {
      send({ type: 'error', reason: err instanceof Error ? err.message : String(err) });
    }
    return;
  }
  if (!guest) return;
  const { at, times, occupied, open } = data;
  guest.advance(at - last, times, (lift, chair, seat) =>
    !(occupied?.lift === lift && occupied.chair === chair && occupied.seat === seat), open);
  last = at;
  const saved = at >= nextSave ? guest.checkpoint() : undefined;
  if (saved) nextSave = at + .8;
  send({ type: 'pose', pose: guest.pose(), at, saved });
};
