import { DRONE, NO_DRONE_INPUT, type DroneInput } from './dronePhysics';

/** Phone flight follows the view, like holding forward in a free-flight game. */
export function directFlightInput(direction: -1 | 0 | 1, pitch: number): DroneInput {
  if (!Number.isFinite(pitch)) return {...NO_DRONE_INPUT};
  const speed = direction * 6;
  const aim=Math.max(-Math.PI/2,Math.min(Math.PI/2,pitch));
  return {...NO_DRONE_INPUT,
    forward:Math.cos(aim)*speed/DRONE.normalSpeed,
    up:Math.max(-1,Math.min(1,Math.sin(aim)*speed/DRONE.climbSpeed)),
  };
}
