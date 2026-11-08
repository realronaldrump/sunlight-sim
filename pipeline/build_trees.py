"""Detect individual trees from the lidar canopy height model and classify species.

Inputs:  data/processed/chm_1m.npy, hi_1m.npy, data/raw/naip_1m.tif (optional, fall 2023 NAIP),
         client/public/world/resort.json (lift lines and buildings to mask out cables and roofs)
Outputs: client/public/world/trees/{tx}_{tn}.bin.gz (512 m tiles), client/public/world/trees/index.json,
         data/processed/trees.npz (all trees, for other pipeline steps and accuracy checks)

Species codes: 0 Engelmann spruce / subalpine fir, 1 Douglas-fir, 2 quaking aspen (bare in winter),
               3 Gambel (scrub) oak
"""
import gzip, json, struct
import numpy as np
from scipy import ndimage
from scipy.spatial import cKDTree
from config import RAW, PROC, PUBLIC

TILE = 512.0


def main():
    meta = json.loads((PROC / "hi_1m.json").read_text())
    x0, n0 = meta["x0"], meta["n0"]
    chm = np.load(PROC / "chm_1m.npy")
    dem = np.load(PROC / "hi_1m.npy")
    H, W = chm.shape
    resort = json.loads((PUBLIC / "resort.json").read_text())

    # ---- masks: lift lines (cables/towers in the point cloud) and buildings ----
    mask = np.zeros_like(chm, bool)
    jj, ii = np.mgrid[0:H, 0:W]
    for L in resort["lifts"]:
        bx, bz = L["bottom"][0], L["bottom"][2]
        tx, tz = L["top"][0], L["top"][2]
        ax, an = tx - bx, -(tz - bz)
        ln = np.hypot(ax, an); ax /= ln; an /= ln
        # local coords of grid
        X = x0 + ii - bx; N = n0 + jj - (-bz)
        along = X * ax + N * an
        across = np.abs(-X * an + N * ax)
        mask |= (along > -15) & (along < ln + 15) & (across < 6.5)
    for b in resort["buildings"]:
        pts = np.array(b["points"])
        xs, ns = pts[:, 0], -pts[:, 1]
        i0 = int(max(0, xs.min() - x0 - 3)); i1 = int(min(W, xs.max() - x0 + 4))
        j0 = int(max(0, ns.min() - n0 - 3)); j1 = int(min(H, ns.max() - n0 + 4))
        mask[j0:j1, i0:i1] = True
    c = np.where(mask, 0, chm)
    c = np.where(c > 48, 0, c)  # isolated noise (birds, wires)

    # ---- local maxima with height-dependent window ----
    rng = np.random.default_rng(42)
    cs = ndimage.gaussian_filter(c, 0.85) + rng.random(c.shape).astype(np.float32) * 1e-3
    mf3 = ndimage.maximum_filter(cs, 3)
    mf5 = ndimage.maximum_filter(cs, 5)
    mf7 = ndimage.maximum_filter(cs, 7)
    peak = (cs >= 1.8) & (((cs < 7) & (cs == mf3)) | ((cs >= 7) & (cs < 15) & (cs == mf5)) | ((cs >= 15) & (cs == mf7)))
    pj, pi = np.nonzero(peak)
    hmax = ndimage.maximum_filter(c, 3)[pj, pi]
    keep = hmax >= 2.0
    pj, pi, hmax = pj[keep], pi[keep], hmax[keep]
    xs = x0 + pi + rng.uniform(-0.35, 0.35, len(pi))
    ns = n0 + pj + rng.uniform(-0.35, 0.35, len(pj))
    ground = dem[pj, pi]
    print(f"trees detected: {len(xs)}")

    # ---- terrain aspect for heuristics ----
    gy, gx = np.gradient(ndimage.gaussian_filter(dem, 6))
    south = (-gy[pj, pi]) / (np.hypot(gx[pj, pi], gy[pj, pi]) + 1e-6)  # +1 = facing south (downhill toward -n)

    # ---- species ----
    species = np.zeros(len(xs), np.uint8)
    naip_path = RAW / "naip_1m.tif"
    decid = None
    if naip_path.exists():
        import rasterio
        with rasterio.open(naip_path) as ds:
            img = ds.read().astype(np.float32)  # rows north->south
        img = img[:, ::-1, :]  # to south->north rows like our grids
        k = np.ones((3, 3)) / 9
        R = ndimage.convolve(img[0], k)[pj, pi]; G = ndimage.convolve(img[1], k)[pj, pi]
        B = ndimage.convolve(img[2], k)[pj, pi]; NIR = ndimage.convolve(img[3], k)[pj, pi]
        bright = (R + G + B) / 3
        warm = (R - B) / (bright + 1)
        valid = bright > 5
        # fall imagery (late Sep / early Oct 2023): aspen and oak are bright yellow-green to gold with high NIR,
        # spruce/fir/Douglas-fir are dark blue-green. Two-cluster k-means on (brightness, warmth, NIR) of trees > 4 m.
        from scipy.cluster.vq import kmeans2
        X = np.c_[bright, warm * 100, NIR]
        m4 = valid & (hmax > 4)
        mu, sd = X[m4].mean(0), X[m4].std(0) + 1e-6
        centers, _ = kmeans2((X[m4] - mu) / sd, 2, seed=1, minit="++")
        Z = (X - mu) / sd
        d0 = ((Z - centers[0]) ** 2).sum(1); d1 = ((Z - centers[1]) ** 2).sum(1)
        bright_cluster = 0 if (centers[0][0] > centers[1][0]) else 1
        d_dec, d_con = (d0, d1) if bright_cluster == 0 else (d1, d0)
        # elevation prior: aspen thins out toward the spruce-fir zone near the summit
        prior = 1.0 - 0.3 * np.clip((ground - 2800) / 250, 0, 1)
        decid = valid & (d_dec < d_con * prior)
        print("k-means centers (bright, warm*100, NIR):", np.round(centers * sd + mu, 1).tolist())
        np.savez(PROC / "tree_colors.npz", R=R, G=G, B=B, NIR=NIR, h=hmax)
        print(f"NAIP: deciduous fraction {decid.mean():.2f}")
    if decid is None:
        # fallback heuristic: aspen stands on moderate slopes 2450-3050 m, more on north/east aspects
        p = 0.25 * ((ground > 2450) & (ground < 3050)) * (1 - 0.5 * np.clip(south, 0, 1))
        decid = rng.random(len(xs)) < p
    oak = decid & (hmax < 5.5) & (ground < 2650)
    aspen = decid & ~oak
    douglas = ~decid & ((ground < 2650) | ((south > 0.4) & (ground < 2850)))
    species[douglas] = 1
    species[aspen] = 2
    species[oak] = 3

    # ---- crown radius: allometry capped by neighbour spacing ----
    a = np.array([0.095, 0.14, 0.11, 0.0])[species]
    b = np.array([0.5, 0.6, 0.7, 1.2])[species]
    crown = a * hmax + b
    tree = cKDTree(np.c_[xs, ns])
    d, _ = tree.query(np.c_[xs, ns], k=2)
    crown = np.minimum(crown, np.maximum(0.6, d[:, 1] * 0.75))
    crown = np.where(species == 3, np.clip(crown, 0.8, 2.2), crown)

    np.savez(PROC / "trees.npz", x=xs, n=ns, y=ground, h=hmax, r=crown, s=species)
    counts = {name: int((species == k).sum()) for k, name in enumerate(["spruce_fir", "douglas_fir", "aspen", "gambel_oak"])}
    print("species counts", counts)

    # ---- tiles ----
    out = PUBLIC / "trees"
    out.mkdir(parents=True, exist_ok=True)
    for f in out.glob("*.bin.gz"):
        f.unlink()
    txs = np.floor(xs / TILE).astype(int); tns = np.floor(ns / TILE).astype(int)
    seeds = rng.integers(0, 256, len(xs)).astype(np.uint8)
    index = {"tileSize": TILE, "tiles": [], "species": ["spruce_fir", "douglas_fir", "aspen", "gambel_oak"], "counts": counts}
    total = 0
    for tx, tn in sorted(set(zip(txs.tolist(), tns.tolist()))):
        m = (txs == tx) & (tns == tn)
        n = int(m.sum())
        order = np.argsort(-hmax[m])  # tallest first (lets the client take a prefix for far LOD)
        X = xs[m][order].astype("<f4"); Z = (-ns[m][order]).astype("<f4"); Y = ground[m][order].astype("<f4")
        Hc = np.clip(np.round(hmax[m][order] * 100), 0, 65535).astype("<u2")
        Rd = np.clip(np.round(crown[m][order] * 20), 0, 255).astype("u1")
        S = species[m][order].astype("u1"); E = seeds[m][order]
        buf = b"SLTR" + struct.pack("<I", n) + X.tobytes() + Z.tobytes() + Y.tobytes() + Hc.tobytes() + Rd.tobytes() + S.tobytes() + E.tobytes()
        data = gzip.compress(buf, 9, mtime=0)
        (out / f"{tx}_{tn}.bin.gz").write_bytes(data)
        total += len(data)
        index["tiles"].append([tx, tn, n])
    (out / "index.json").write_text(json.dumps(index))
    print(f"wrote {len(index['tiles'])} tree tiles, {total/1e6:.1f} MB")


if __name__ == "__main__":
    main()
