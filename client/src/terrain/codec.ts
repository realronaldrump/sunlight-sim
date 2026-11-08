// Decoder for terrain height tiles produced by pipeline/terrain_codec.py.
// File = gzip( "SLT1" | f32 min | f32 scale | u16 N | u16 reserved | u16[N*N] zigzag planar residuals ).

export interface DecodedTile {
  n: number;
  heights: Float32Array; // row-major, rows south->north, N*N
  min: number;
  max: number;
}

async function maybeGunzip(buf: ArrayBuffer): Promise<ArrayBuffer> {
  const u8 = new Uint8Array(buf);
  if (u8.length > 2 && u8[0] === 0x1f && u8[1] === 0x8b) {
    const ds = new DecompressionStream('gzip');
    const stream = new Blob([u8]).stream().pipeThrough(ds);
    return await new Response(stream).arrayBuffer();
  }
  return buf; // server already removed Content-Encoding gzip
}

export function decodeRaw(raw: ArrayBuffer): DecodedTile {
  const dv = new DataView(raw);
  const magic = String.fromCharCode(dv.getUint8(0), dv.getUint8(1), dv.getUint8(2), dv.getUint8(3));
  if (magic !== 'SLT1') throw new Error('bad terrain tile magic ' + magic);
  const lo = dv.getFloat32(4, true);
  const scale = dv.getFloat32(8, true);
  const n = dv.getUint16(12, true);
  const z = new Uint16Array(raw.slice(16, 16 + n * n * 2));
  const q = new Int32Array(n * n);
  for (let j = 0; j < n; j++) {
    for (let i = 0; i < n; i++) {
      const k = j * n + i;
      let p = 0;
      if (i > 0 && j > 0) p = q[k - 1] + q[k - n] - q[k - n - 1];
      else if (i > 0) p = q[k - 1];
      else if (j > 0) p = q[k - n];
      const zz = z[k];
      const s = zz & 1 ? -((zz + 1) >> 1) : zz >> 1;
      q[k] = (((p + s) % 65536) + 65536) % 65536;
    }
  }
  const heights = new Float32Array(n * n);
  let mn = Infinity, mx = -Infinity;
  for (let k = 0; k < n * n; k++) {
    const h = lo + q[k] * scale;
    heights[k] = h;
    if (h < mn) mn = h;
    if (h > mx) mx = h;
  }
  return { n, heights, min: mn, max: mx };
}

export async function decodeTile(buf: ArrayBuffer): Promise<DecodedTile> {
  return decodeRaw(await maybeGunzip(buf));
}
