import { DRONE, NO_DRONE_INPUT, type DroneInput } from './dronePhysics';

/** Phone flight follows the view, like holding forward in a free-flight game. */
export function directFlightInput(direction: number, pitch: number): DroneInput {
  if (!Number.isFinite(direction) || !Number.isFinite(pitch)) return {...NO_DRONE_INPUT};
  const amount=Math.max(-1,Math.min(1,direction));
  const speed=amount*(amount<0 ? 3 : 6);
  const aim=Math.max(-Math.PI/2,Math.min(Math.PI/2,pitch));
  return {...NO_DRONE_INPUT,
    forward:Math.cos(aim)*speed/DRONE.normalSpeed,
    up:Math.max(-1,Math.min(1,Math.sin(aim)*speed/DRONE.climbSpeed)),
  };
}
