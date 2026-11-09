// Game coordinates are meters: +x east, -z north. Keep the map north-up while following the skier.
export interface MapView { x: number; z: number; width: number; height: number; span: number }

export function mapPoint(view: MapView, x: number, z: number): [number, number] {
  const scale = view.width / view.span;
  return [view.width / 2 + (x - view.x) * scale, view.height / 2 + (z - view.z) * scale];
}

/** Closest point on a trail, including segments whose vertices are outside the view. */
export function nearestTrailPoint(points: number[][], x: number, z: number) {
  let best = { x: points[0]?.[0] ?? x, z: points[0]?.[2] ?? z, distance: Infinity };
  for (let i = 0; i < points.length; i++) {
    const a = points[i], b = points[i + 1] ?? a;
    const dx = b[0] - a[0], dz = b[2] - a[2];
    const t = Math.max(0, Math.min(1, ((x - a[0]) * dx + (z - a[2]) * dz) / (dx * dx + dz * dz || 1)));
    const px = a[0] + dx * t, pz = a[2] + dz * t;
    const distance = Math.hypot(px - x, pz - z);
    if (distance < best.distance) best = { x: px, z: pz, distance };
  }
  return best;
}

/** Canvas rotation is clockwise; the skier's yaw is counterclockwise. */
export function mapHeading(heading: number) { return -heading; }
