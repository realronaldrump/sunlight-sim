import { SkiNavigation, type SkiRoute } from '../../../shared/skiNavigation';
import type { Point } from '../../../shared/mountainGuestNavigation';
import { loadGuestWorld, type GuestResort } from '../world/mountainGuestWorld';
import { browserLoader } from '../terrain/heightfield';

export interface RouteRequest {
  id: number; base: string; resort: GuestResort; from: Point; destination: Point; liftsOpen: boolean; riding?: number;
}
export interface RouteResponse { id: number; route: SkiRoute | null; error?: string }
let planner: Promise<SkiNavigation> | undefined;
let latest = 0;
self.onmessage = async ({ data }: MessageEvent<RouteRequest>) => {
  latest = data.id;
  try {
    planner ??= loadGuestWorld(data.base, data.resort, browserLoader).then(w => new SkiNavigation(w.navigation, data.resort.runs));
    const p = await planner;
    if (data.id !== latest) return;
    self.postMessage({ id: data.id, route: p.plan(data.from, data.destination, data) } satisfies RouteResponse);
  } catch (error) {
    planner = undefined;
    self.postMessage({ id: data.id, route: null, error: String(error) } satisfies RouteResponse);
  }
};
