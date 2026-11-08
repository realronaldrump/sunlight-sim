// Mogul fields: skier-formed bumps on ungroomed runs. The offset is baked into the 1 m and 2 m height
// tiles on load (client and tests), so the rendered mesh and the physics sample identical heights.
// Pattern: staggered egg-crate of ~4.6 m spacing (typical recreational moguls), height ~0.7 m peak to
// trough at full mask, with slow variation so it does not look machine-made.

const TWO_PI = Math.PI * 2;

export function mogulOffset(x: number, n: number, mask: number): number {
  if (mask <= 0.01) return 0;
  const u = (x + n) * 0.7071, v = (x - n) * 0.7071;
  // slowly varying spacing and phase
  const w = 1 + 0.12 * Math.sin(x * 0.031 + n * 0.017) + 0.08 * Math.sin(n * 0.043 - x * 0.021);
  const lam = 4.6 * w;
  const a = Math.sin((TWO_PI * u) / lam + 0.7 * Math.sin(v * 0.11)) * Math.sin((TWO_PI * v) / lam + 0.7 * Math.sin(u * 0.13));
  const b = Math.sin((TWO_PI * u) / (lam * 0.53)) * Math.sin((TWO_PI * v) / (lam * 0.61));
  return mask * (0.36 * a + 0.06 * b);
}
