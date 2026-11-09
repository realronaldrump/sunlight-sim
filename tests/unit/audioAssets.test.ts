import { it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../../client/public/audio/', import.meta.url));
it('ships complete, unclipped PCM assets with verified provenance and continuous loop seams', () => {
  const manifest = JSON.parse(readFileSync(`${root}sources.json`, 'utf8'));
  expect(manifest.outputs).toHaveLength(14);
  expect(manifest.sources.every((s: any) => s.license === 'CC0-1.0' && /^[a-f0-9]{64}$/.test(s.sha256))).toBe(true);
  for (const asset of manifest.outputs) {
    const b = readFileSync(root+asset.file);
    expect(createHash('sha256').update(b).digest('hex'), asset.file).toBe(asset.sha256);
    expect(b.toString('ascii',0,4)).toBe('RIFF'); expect(b.toString('ascii',8,12)).toBe('WAVE');
    expect(b.readUInt16LE(20)).toBe(1); expect(b.readUInt16LE(34)).toBe(16);
    expect(b.readUInt32LE(24)).toBe(32000);
    let peak = 0, square = 0, stepSquare = 0, last = 0;
    const samples = (b.length-44)/2;
    for (let i = 0; i < samples; i++) {
      const n = b.readInt16LE(44+i*2)/32768;
      peak = Math.max(peak,Math.abs(n)); square += n*n;
      stepSquare += (n-last)**2; last = n;
    }
    expect(peak, asset.file).toBeLessThan(.83);
    expect(Math.sqrt(square/samples), asset.file).toBeGreaterThan(.01);
    if (asset.loop) {
      // A wrap discontinuity must be no larger than an ordinary high-frequency sample step.
      const seam = Math.abs(b.readInt16LE(44)-b.readInt16LE(b.length-2*asset.channels))/32768;
      expect(seam, asset.file).toBeLessThan(Math.sqrt(stepSquare/samples)*5+.001);
    }
  }
});
