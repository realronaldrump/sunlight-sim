"""Snow surface masks and run boundaries.

Run boundaries come from the lidar: a run is the tree-free corridor (canopy < 2 m) around its OSM centerline,
limited to a plausible half-width; pixels claimed by several runs go to the nearest centerline. Glades use
their OSM polygon (they are skied through the trees).

Outputs:
  client/public/world/surface.bin.gz  RGBA at 2 m: R groomed, G piste, B canopy cover, A moguls
  client/public/world/runs.bin.gz     u16 run index + 1 per 2 m pixel (0 = no run)
  resort.json runs[*].idx, runs[*].outline (boundary polygon, game x/z), runs[*].stats (filled by accuracy)
"""
import gzip, json, struct
import numpy as np
from scipy import ndimage
from skimage.draw import polygon as draw_polygon, line as draw_line
from skimage import measure
from config import PROC, PUBLIC

RES = 2.0
CAT_TRACKS = {"Grizzly Road", "Ute", "Segundo Road", "Midland Traverse", "Blue Catwalk", "Hike-Out Only", "The Parks",
              "Sundance", "Ute Cutoff", "Loop"}


def main():
    meta = json.loads((PROC / "hi_1m.json").read_text())
    x0, n0 = meta["x0"], meta["n0"]
    chm = np.load(PROC / "chm_1m.npy")
    H1, W1 = chm.shape
    H, W = H1 // 2, W1 // 2
    c2 = chm[:H * 2, :W * 2].reshape(H, 2, W, 2)
    canopy = (c2 > 2.0).mean(axis=(1, 3)).astype(np.float32)
    tall = c2.max(axis=(1, 3))
    open_ = ndimage.binary_opening(tall < 2.5, iterations=1)
    resort = json.loads((PUBLIC / "resort.json").read_text())
    runs = resort["runs"]

    def to_px(x, z):
        return (x - x0) / RES, ((-z) - n0) / RES  # col, row (rows south->north)

    best_d = np.full((H, W), np.inf, np.float32)
    owner = np.zeros((H, W), np.int32)  # run index + 1
    groomed = np.zeros((H, W), np.float32)
    moguls = np.zeros((H, W), np.float32)
    piste = np.zeros((H, W), np.float32)

    # glades/areas first (lower priority than line runs where they overlap)
    for k, r in enumerate(runs):
        if r["kind"] != "area":
            continue
        pts = np.array(r["points"])
        cc, rr = to_px(pts[:, 0], pts[:, 2])
        R, C = draw_polygon(rr, cc, (H, W))
        owner[R, C] = k + 1
        best_d[R, C] = 30.0
        piste[R, C] = np.maximum(piste[R, C], 0.6)
        moguls[R, C] = np.maximum(moguls[R, C], 0.45)

    for k, r in enumerate(runs):
        if r["kind"] != "line":
            continue
        pts = np.array(r["points"])
        cc, rr = to_px(pts[:, 0], pts[:, 2])
        line = np.zeros((H, W), bool)
        for i in range(len(pts) - 1):
            R, C = draw_line(int(round(rr[i])), int(round(cc[i])), int(round(rr[i + 1])), int(round(cc[i + 1])))
            m = (R >= 0) & (R < H) & (C >= 0) & (C < W)
            line[R[m], C[m]] = True
        if not line.any():
            continue
        r0, r1 = max(0, int(rr.min()) - 40), min(H, int(rr.max()) + 41)
        c0, c1 = max(0, int(cc.min()) - 40), min(W, int(cc.max()) + 41)
        sub = line[r0:r1, c0:c1]
        d = ndimage.distance_transform_edt(~sub) * RES
        cat = r["name"] in CAT_TRACKS or r["difficulty"] == "hike"
        maxhw = 9.0 if cat else (22.0 if r["grooming"] == "moguls" else 34.0)
        core = 4.0 if cat else 7.0
        # corridor: always the core, plus open snow connected to the centerline within max half-width
        cand = (d <= maxhw) & open_[r0:r1, c0:c1]
        lab, _ = ndimage.label(cand | (d <= core))
        keep_labels = np.unique(lab[sub & (lab > 0)])
        mask = np.isin(lab, keep_labels) & (d <= maxhw)
        mask = ndimage.binary_closing(mask, iterations=2) & (d <= maxhw)
        bd = best_d[r0:r1, c0:c1]
        ow = owner[r0:r1, c0:c1]
        claim = mask & (d < bd)
        bd[claim] = d[claim]
        ow[claim] = k + 1
        # grooming / moguls
        g = r["grooming"]
        edge_soft = np.clip((maxhw - d) / 4.0, 0, 1) * mask
        if g == "groomed" or cat:
            groomed[r0:r1, c0:c1] = np.maximum(groomed[r0:r1, c0:c1], edge_soft)
        elif g == "mixed":
            inner = np.clip((maxhw * 0.55 - d) / 3.0, 0, 1) * mask
            groomed[r0:r1, c0:c1] = np.maximum(groomed[r0:r1, c0:c1], inner)
            moguls[r0:r1, c0:c1] = np.maximum(moguls[r0:r1, c0:c1], edge_soft * (1 - inner))
        else:
            moguls[r0:r1, c0:c1] = np.maximum(moguls[r0:r1, c0:c1], edge_soft)
        piste[r0:r1, c0:c1] = np.maximum(piste[r0:r1, c0:c1], mask.astype(np.float32))

    # surface texture
    rgba = np.stack([groomed, piste, canopy, moguls], -1)
    rgba = (np.clip(rgba, 0, 1) * 255).astype(np.uint8)
    hdr = b"SLS1" + struct.pack("<fffHH", x0 - 0.5 + 0.5, n0 - 0.5 + 0.5, RES, W, H)
    # pixel (i, j) covers x in [x0 + 2i - 0.5, ...]; we store the min corner as x0 (vertex grid start) for simplicity
    (PUBLIC / "surface.bin.gz").write_bytes(gzip.compress(hdr + rgba.tobytes(), 9, mtime=0))
    ids = owner.astype("<u2")
    (PUBLIC / "runs.bin.gz").write_bytes(gzip.compress(b"SLR1" + struct.pack("<fffHH", x0, n0, RES, W, H) + ids.tobytes(), 9, mtime=0))

    # outlines for the trail map
    for k, r in enumerate(runs):
        r["idx"] = k + 1
        m = owner == k + 1
        r["areaM2"] = round(float(m.sum() * RES * RES))
        if not m.any():
            r["outline"] = []
            continue
        m2 = ndimage.binary_closing(m, iterations=1)
        cs = measure.find_contours(np.pad(m2, 1).astype(np.uint8), 0.5)
        outs = []
        for ctr in cs:
            if len(ctr) < 8:
                continue
            ctr = measure.approximate_polygon(ctr, 0.8)
            outs.append([[round(x0 + (p[1] - 1) * RES, 1), round(-(n0 + (p[0] - 1) * RES), 1)] for p in ctr])
        outs.sort(key=len, reverse=True)
        r["outline"] = outs[:3]
    (PUBLIC / "resort.json").write_text(json.dumps(resort, separators=(",", ":")))
    print(f"surface {W}x{H} @ {RES} m; piste area {piste.mean() * W * H * RES * RES / 1e4:.0f} ha; groomed {groomed.mean() * W * H * RES * RES / 1e4:.0f} ha")


if __name__ == "__main__":
    main()
