"""Height tile codec shared by the pipeline and tests.

Format (little endian):
  bytes 0..3   magic b"SLT1"
  bytes 4..7   float32 min height (m)
  bytes 8..11  float32 scale (m per unit)
  bytes 12..13 uint16 N (samples per side)
  bytes 14..15 uint16 reserved
  then N*N uint16 zigzag residuals of a planar predictor (row-major, rows south->north)
The whole file is gzip compressed. Decoding is mirrored in client/src/terrain/codec.ts.
"""
import gzip, struct
import numpy as np

MAGIC = b"SLT1"


def quantize(h: np.ndarray, min_scale=0.01):
    lo = float(np.floor(h.min() * 100) / 100)
    hi = float(h.max())
    scale = max(min_scale, (hi - lo) / 65535.0)
    q = np.clip(np.round((h - lo) / scale), 0, 65535).astype(np.int64)
    return lo, scale, q


def encode(h: np.ndarray, min_scale=0.01) -> bytes:
    n = h.shape[0]
    assert h.shape == (n, n)
    lo, scale, q = quantize(h.astype(np.float64), min_scale)
    pred = np.zeros_like(q)
    pred[0, 1:] = q[0, :-1]
    pred[1:, 0] = q[:-1, 0]
    pred[1:, 1:] = q[1:, :-1] + q[:-1, 1:] - q[:-1, :-1]
    res = (q - pred) % 65536
    s = np.where(res >= 32768, res - 65536, res)
    z = np.where(s >= 0, 2 * s, -2 * s - 1).astype("<u2")
    header = MAGIC + struct.pack("<ffHH", lo, scale, n, 0)
    return gzip.compress(header + z.tobytes(), compresslevel=9, mtime=0)


def decode(buf: bytes) -> np.ndarray:
    raw = gzip.decompress(buf)
    assert raw[:4] == MAGIC
    lo, scale, n, _ = struct.unpack("<ffHH", raw[4:16])
    z = np.frombuffer(raw[16:16 + n * n * 2], dtype="<u2").astype(np.int64).reshape(n, n)
    s = np.where(z & 1, -((z + 1) >> 1), z >> 1)
    q = np.zeros((n, n), np.int64)
    for j in range(n):
        for i in range(n):
            if i > 0 and j > 0:
                p = q[j, i - 1] + q[j - 1, i] - q[j - 1, i - 1]
            elif i > 0:
                p = q[j, i - 1]
            elif j > 0:
                p = q[j - 1, i]
            else:
                p = 0
            q[j, i] = (p + s[j, i]) % 65536
    return (lo + q * scale).astype(np.float32)
