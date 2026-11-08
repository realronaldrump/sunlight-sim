"""Canopy height model from the lidar point cloud (first/all non-ground returns minus the 1 m DEM).

Input:  data/raw/ept/*.laz (EPSG:3857 EPT nodes), data/processed/hi_1m.npy
Output: data/processed/chm_1m.npy (float32, same grid as hi_1m), data/processed/chm_stats.json
"""
import glob, json, multiprocessing as mp
import numpy as np
import laspy
from pyproj import Transformer
from config import RAW, PROC, ORIGIN_E, ORIGIN_N

META = json.loads((PROC / "hi_1m.json").read_text())
X0, N0 = META["x0"], META["n0"]
H, W = META["shape"]


def work(files):
    hi = np.load(PROC / "hi_1m.npy", mmap_mode="r")
    t = Transformer.from_crs(3857, 26913, always_xy=True)
    chm = np.zeros(H * W, np.float32)
    dens = np.zeros(H * W, np.uint16)
    gd = []
    npts = 0
    for f in files:
        try:
            p = laspy.read(f)
        except Exception as e:
            print("bad", f, e); continue
        if len(p.points) == 0:
            continue
        e, n = t.transform(np.asarray(p.x), np.asarray(p.y))
        i = np.rint(e - ORIGIN_E - X0).astype(np.int64)
        j = np.rint(n - ORIGIN_N - N0).astype(np.int64)
        m = (i >= 0) & (i < W) & (j >= 0) & (j < H)
        if not m.any():
            continue
        i, j = i[m], j[m]
        z = np.asarray(p.z)[m]
        cls = np.asarray(p.classification)[m]
        g = hi[j, i]
        hag = (z - g).astype(np.float32)
        npts += len(z)
        gm = cls == 2
        if gm.any():
            gd.append(np.random.choice(hag[gm], min(2000, gm.sum()), replace=False))
        veg = (cls == 1) & (hag > 0.25) & (hag < 55)
        lin = j[veg] * W + i[veg]
        np.maximum.at(chm, lin, hag[veg])
        np.add.at(dens, lin, 1)
    return chm, dens, (np.concatenate(gd) if gd else np.zeros(0, np.float32)), npts


def main():
    files = sorted(glob.glob(str(RAW / "ept" / "*.laz")))
    n = min(10, mp.cpu_count())
    chunks = [files[k::n] for k in range(n)]
    with mp.Pool(n) as pool:
        res = pool.map(work, chunks)
    chm = np.maximum.reduce([r[0] for r in res]).reshape(H, W)
    dens = np.sum([r[1].astype(np.int32) for r in res], axis=0).reshape(H, W)
    gd = np.concatenate([r[2] for r in res])
    npts = sum(r[3] for r in res)
    np.save(PROC / "chm_1m.npy", chm)
    np.save(PROC / "vegdens_1m.npy", np.clip(dens, 0, 65535).astype(np.uint16))
    stats = {"points": int(npts), "ground_minus_dem_median": float(np.median(gd)) if len(gd) else None,
             "ground_minus_dem_p95_abs": float(np.percentile(np.abs(gd), 95)) if len(gd) else None,
             "canopy_cover_2m": float((chm > 2).mean()), "max_height": float(chm.max())}
    (PROC / "chm_stats.json").write_text(json.dumps(stats, indent=1))
    print(stats)


if __name__ == "__main__":
    main()
