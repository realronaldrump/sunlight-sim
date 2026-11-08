"""Build the terrain height tile pyramid used by the client.

Inputs:  data/raw/dem1m/*.tif (USGS 3DEP 1 m), data/raw/regional_8m.tif, data/raw/far_32m.tif
Outputs: client/public/world/terrain/L{L}/{tx}_{tn}.bin.gz, client/public/world/terrain/index.json
         data/processed/hi_1m.npy (+ .json) : the 1 m mosaic on the game grid (used by later steps)

Grid convention: local x = E - ORIGIN_E (east), n = N - ORIGIN_N (north). A tile (tx, tn) at level L has
spacing r = 2^L m, covers [tx*S, (tx+1)*S] x [tn*S, (tn+1)*S] with S = 256*r, and stores 259x259 samples:
sample (j, i) is at x = tx*S + (i-1)*r, n = tn*S + (j-1)*r (one-sample border on every side).
"""
import json, glob, math
import numpy as np
import rasterio
from rasterio.windows import from_bounds
from scipy import ndimage
from config import RAW, PROC, PUBLIC, ORIGIN_E, ORIGIN_N, HI_MIN_E, HI_MAX_E, HI_MIN_N, HI_MAX_N, REGION_HALF, FAR_HALF
from terrain_codec import encode

TILE = 256
# vertical quantization step per level (m): fine near the skier, coarser for distant terrain
MIN_SCALE = {0: 0.01, 1: 0.02, 2: 0.03, 3: 0.05, 4: 0.08}
N = TILE + 3  # 259 samples incl. border


class Grid:
    """A regular vertex grid in local coordinates: value[j, i] at (x0 + i*r, n0 + j*r)."""

    def __init__(self, data, x0, n0, r):
        self.data, self.x0, self.n0, self.r = data, x0, n0, r

    @property
    def x1(self):
        return self.x0 + (self.data.shape[1] - 1) * self.r

    @property
    def n1(self):
        return self.n0 + (self.data.shape[0] - 1) * self.r

    def sample(self, xs, ns):
        """Bilinear sample at arrays of local coordinates (clamped)."""
        fi = np.clip((xs - self.x0) / self.r, 0, self.data.shape[1] - 1.000001)
        fj = np.clip((ns - self.n0) / self.r, 0, self.data.shape[0] - 1.000001)
        return ndimage.map_coordinates(self.data, [fj, fi], order=1, mode="nearest")


def read_hi():
    """Mosaic the 1 m DEM tiles onto the game grid (vertex = DEM pixel center), with a 1 sample border."""
    x0, x1 = HI_MIN_E - ORIGIN_E - 1, HI_MAX_E - ORIGIN_E + 1
    n0, n1 = HI_MIN_N - ORIGIN_N - 1, HI_MAX_N - ORIGIN_N + 1
    w = int(round(x1 - x0)) + 1
    h = int(round(n1 - n0)) + 1
    out = np.full((h, w), np.nan, np.float32)
    files = sorted(glob.glob(str(RAW / "dem1m" / "*Central_Western_2016*.tif"))) + \
        sorted(glob.glob(str(RAW / "dem1m" / "*SanLuisJuanMiguel_2020*.tif")))
    for f in files:
        with rasterio.open(f) as ds:
            # bounds of pixel areas around our vertex centers
            E0, E1 = ORIGIN_E + x0 - 0.5, ORIGIN_E + x1 + 0.5
            N0, N1 = ORIGIN_N + n0 - 0.5, ORIGIN_N + n1 + 0.5
            win = from_bounds(E0, N0, E1, N1, ds.transform).round_offsets().round_lengths()
            a = ds.read(1, window=win, boundless=True, fill_value=np.nan).astype(np.float32)
            nd = ds.nodata
            if nd is not None:
                a[(a <= -1e4) | (a == nd)] = np.nan
            a = a[::-1]  # rows north->south to south->north
            assert a.shape == out.shape, (a.shape, out.shape)
            m = np.isnan(out) & ~np.isnan(a)
            out[m] = a[m]
            print(f"  {f.split('/')[-1]}: filled {m.sum()} px")
    return Grid(out, x0, n0, 1.0)


def read_tif_grid(path):
    with rasterio.open(path) as ds:
        a = ds.read(1).astype(np.float32)
        a[a <= -9000] = np.nan
        t = ds.transform
        r = t.a
        # pixel centers: first col center E = t.c + r/2; top row center N = t.f - r/2
        e0 = t.c + r / 2
        ntop = t.f - r / 2
    a = a[::-1]
    nbot = ntop - (a.shape[0] - 1) * r
    return Grid(a, e0 - ORIGIN_E, nbot - ORIGIN_N, r)


def fill_nans(g: Grid, fallback: Grid):
    m = np.isnan(g.data)
    if m.any():
        jj, ii = np.nonzero(m)
        g.data[m] = fallback.sample(g.x0 + ii * g.r, g.n0 + jj * g.r)
        print(f"  filled {m.sum()} nodata samples from coarser grid")


def composite(base: Grid, fine: Grid, blend):
    """Replace base samples inside fine's extent by a low-passed sample of fine, blended near its edge."""
    factor = base.r / fine.r
    sm = ndimage.gaussian_filter(fine.data, sigma=0.45 * factor) if factor > 1 else fine.data
    smg = Grid(sm, fine.x0, fine.n0, fine.r)
    jj, ii = np.mgrid[0:base.data.shape[0], 0:base.data.shape[1]]
    xs = base.x0 + ii * base.r
    ns = base.n0 + jj * base.r
    inside = (xs >= fine.x0) & (xs <= fine.x1) & (ns >= fine.n0) & (ns <= fine.n1)
    d = np.minimum.reduce([xs - fine.x0, fine.x1 - xs, ns - fine.n0, fine.n1 - ns])
    wgt = np.clip(d / blend, 0, 1) * inside
    vals = np.zeros_like(base.data)
    vals[inside] = smg.sample(xs[inside], ns[inside])
    out = base.data * (1 - wgt) + vals * wgt
    return Grid(out.astype(np.float32), base.x0, base.n0, base.r)


def downsample(g: Grid, factor: int):
    if factor == 1:
        return g
    sm = ndimage.gaussian_filter(g.data, sigma=0.45 * factor)
    # keep vertices that land on multiples of the new spacing relative to origin
    r2 = g.r * factor
    i0 = int(round((math.ceil(g.x0 / r2) * r2 - g.x0) / g.r))
    j0 = int(round((math.ceil(g.n0 / r2) * r2 - g.n0) / g.r))
    d = sm[j0::factor, i0::factor]
    return Grid(d, g.x0 + i0 * g.r, g.n0 + j0 * g.r, r2)


def write_tiles(level, g: Grid, extent, index):
    """Write all tiles at `level` whose area lies within extent (x0, x1, n0, n1) using grid g (spacing 2^level)."""
    r = float(2 ** level)
    assert abs(g.r - r) < 1e-6, (g.r, r)
    S = TILE * r
    ex0, ex1, en0, en1 = extent
    txs = range(math.floor(ex0 / S), math.ceil(ex1 / S))
    tns = range(math.floor(en0 / S), math.ceil(en1 / S))
    outdir = PUBLIC / "terrain" / f"L{level}"
    outdir.mkdir(parents=True, exist_ok=True)
    tiles = []
    total = 0
    for tn in tns:
        for tx in txs:
            bx = tx * S - r
            bn = tn * S - r
            i0 = int(round((bx - g.x0) / r))
            j0 = int(round((bn - g.n0) / r))
            if i0 < 0 or j0 < 0 or i0 + N > g.data.shape[1] or j0 + N > g.data.shape[0]:
                # partially outside: sample with clamping
                ii = np.arange(N) * r + bx
                jj = np.arange(N) * r + bn
                X, Y = np.meshgrid(ii, jj)
                a = g.sample(X, Y).astype(np.float32)
            else:
                a = g.data[j0:j0 + N, i0:i0 + N]
            assert not np.isnan(a).any(), (level, tx, tn)
            buf = encode(a, MIN_SCALE.get(level, 0.1))
            (outdir / f"{tx}_{tn}.bin.gz").write_bytes(buf)
            total += len(buf)
            tiles.append([tx, tn, round(float(a.min()), 2), round(float(a.max()), 2)])
    index["levels"][str(level)] = {"spacing": r, "tileSize": S, "tiles": tiles}
    print(f"L{level}: {len(tiles)} tiles, {total/1e6:.1f} MB")


def main():
    PROC.mkdir(parents=True, exist_ok=True)
    print("reading far/regional grids")
    far = read_tif_grid(RAW / "far_32m.tif")
    reg = read_tif_grid(RAW / "regional_8m.tif")
    fill_nans(far, Grid(np.nan_to_num(far.data, nan=float(np.nanmean(far.data))), far.x0, far.n0, far.r))
    fill_nans(reg, far)
    print("reading 1 m DEM mosaic")
    hi = read_hi()
    fill_nans(hi, reg)
    np.save(PROC / "hi_1m.npy", hi.data)
    (PROC / "hi_1m.json").write_text(json.dumps({"x0": hi.x0, "n0": hi.n0, "r": hi.r, "shape": hi.data.shape}))
    print("compositing")
    reg_c = composite(reg, hi, blend=192.0)
    far_c = composite(far, reg_c, blend=1024.0)

    index = {
        "origin": {"E": ORIGIN_E, "N": ORIGIN_N, "crs": "EPSG:26913"},
        "tileSamples": N, "tileCells": TILE, "levels": {},
        "hiExtent": [hi.x0 + 1, hi.x1 - 1, hi.n0 + 1, hi.n1 - 1],
    }
    hi_ext = (hi.x0 + 1, hi.x1 - 1, hi.n0 + 1, hi.n1 - 1)
    reg_ext = (-REGION_HALF, REGION_HALF, -REGION_HALF, REGION_HALF)
    far_ext = (-FAR_HALF, FAR_HALF, -FAR_HALF, FAR_HALF)
    write_tiles(0, hi, hi_ext, index)
    write_tiles(1, downsample(hi, 2), hi_ext, index)
    write_tiles(2, downsample(hi, 4), hi_ext, index)
    write_tiles(3, reg_c, reg_ext, index)
    write_tiles(4, downsample(reg_c, 2), reg_ext, index)
    write_tiles(5, far_c, far_ext, index)
    g = far_c
    for L in range(6, 9):
        g = downsample(g, 2)
        write_tiles(L, g, far_ext, index)
    index["maxLevel"] = 8
    (PUBLIC / "terrain" / "index.json").write_text(json.dumps(index))
    print("done")


if __name__ == "__main__":
    main()
