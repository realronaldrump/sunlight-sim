// Graphics quality presets and auto-detection.
export type QualityName = 'low' | 'medium' | 'high' | 'ultra';

export interface QualityPreset {
  name: QualityName;
  pixelRatio: number;   // upper bound on device pixel ratio
  targetMP: number;     // render-resolution budget in megapixels (1440p = 3.7 MP)
  shadows: boolean; shadowMapSize: number; cascades: number; shadowFar: number;
  terrainSplit: number;
  treeNear: number; treeFar: number;
  antialias: boolean;
}

export const PRESETS: Record<QualityName, QualityPreset> = {
  low: { name: 'low', pixelRatio: 1, targetMP: 1.2, shadows: false, shadowMapSize: 1024, cascades: 1, shadowFar: 300, terrainSplit: 1.15, treeNear: 110, treeFar: 1600, antialias: false },
  medium: { name: 'medium', pixelRatio: 1.25, targetMP: 2.4, shadows: true, shadowMapSize: 1024, cascades: 2, shadowFar: 500, terrainSplit: 1.3, treeNear: 160, treeFar: 2400, antialias: true },
  high: { name: 'high', pixelRatio: 2, targetMP: 3.7, shadows: true, shadowMapSize: 2048, cascades: 3, shadowFar: 900, terrainSplit: 1.5, treeNear: 210, treeFar: 3200, antialias: true },
  ultra: { name: 'ultra', pixelRatio: 2, targetMP: 8.3, shadows: true, shadowMapSize: 4096, cascades: 4, shadowFar: 1400, terrainSplit: 1.9, treeNear: 280, treeFar: 4500, antialias: true },
};

const KEY = 'sunlight.quality';

export function savedQuality(): QualityName | 'auto' {
  try { return (localStorage.getItem(KEY) as QualityName | 'auto' | null) ?? 'auto'; } catch { return 'auto'; }
}
export function saveQuality(q: QualityName | 'auto') {
  try { localStorage.setItem(KEY, q); } catch { /* private mode */ }
}

/** Pick a preset from the device: WebGPU on a desktop GPU -> high; WebGL2 fallback -> medium; small/mobile -> low. */
export async function detectQuality(forceWebGL = false): Promise<QualityName> {
  const url = new URLSearchParams(location.search).get('quality') as QualityName | null;
  if (url && url in PRESETS) return url;
  const saved = savedQuality();
  if (saved !== 'auto' && saved in PRESETS) return saved;
  const mobile = /Android|iPhone|iPad/i.test(navigator.userAgent) || Math.min(screen.width, screen.height) < 600;
  if (mobile) return 'low';
  if (forceWebGL) return 'medium';
  const gpu = (navigator as unknown as { gpu?: { requestAdapter(): Promise<{ info?: { vendor?: string; architecture?: string } } | null> } }).gpu;
  if (!gpu) return 'medium';
  try {
    const adapter = await gpu.requestAdapter();
    if (!adapter) return 'medium';
    const cores = navigator.hardwareConcurrency ?? 4;
    return cores >= 8 ? 'high' : 'medium';
  } catch { return 'medium'; }
}

/** A busy or suspended GPU process can leave requestAdapter pending forever in another tab. */
export async function detectGraphics(forceWebGL = false) {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const quality = await Promise.race([
      detectQuality(forceWebGL),
      new Promise<null>(resolve => { timer = setTimeout(() => resolve(null), 4000); }),
    ]);
    return { quality: quality ?? 'medium' as QualityName, forceWebGL: forceWebGL || quality === null };
  } finally { clearTimeout(timer); }
}

/** Pixel ratio that keeps the render target within the preset's megapixel budget. */
export function pixelRatioFor(q: QualityPreset, cssW: number, cssH: number) {
  const dpr = Math.min(window.devicePixelRatio || 1, q.pixelRatio);
  const budget = Math.sqrt((q.targetMP * 1e6) / Math.max(1, cssW * cssH));
  return Math.max(0.5, Math.min(dpr, budget));
}
