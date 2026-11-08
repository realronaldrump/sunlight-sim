"""Base-area ground mask: plowed roads (OSM highways) and parking lots (derived from NAIP + DEM: flat,
treeless, grey gravel/asphalt near the base, connected to roads).

Output: client/public/world/base.bin.gz  ("SLB1" | f32 x0 | f32 n0 | f32 res | u16 w | u16 h | u8 mask[w*h])
        mask: 0 none, 1..255 plowed surface strength. Also resort.json "parking" polygons (game x/z).
"""
import gzip, json, struct
import numpy as np
import rasterio
from scipy import ndimage
from skimage.draw import line as draw_line
from skimage import measure
from config import RAW, PROC, PUBLIC

RES = 1.0
# base area window (local x/n) around the lodge and lower terminals
X0, X1, N0, N1 = -500.0, 524.0, 600.0, 1624.0


def main():
    meta = json.loads((PROC / "hi_1m.json").read_text())
    hx0, hn0 = meta["x0"], meta["n0"]
    dem = np.load(PROC / "hi_1m.npy"); chm = np.load(PROC / "chm_1m.npy")
    i0, j0 = int(X0 - hx0), int(N0 - hn0)
    W, H = int((X1 - X0) / RES), int((N1 - N0) / RES)
    d = dem[j0:j0 + H, i0:i0 + W]; c = chm[j0:j0 + H, i0:i0 + W]
    with rasterio.open(RAW / "naip_1m.tif") as ds:
        img = ds.read()[:3].astype(np.float32)[:, ::-1, :]
    rgb = img[:, j0:j0 + H, i0:i0 + W]
    bright = rgb.mean(0)
    sat = rgb.max(0) - rgb.min(0)
    gy, gx = np.gradient(ndimage.gaussian_filter(d, 2))
    slope = np.degrees(np.arctan(np.hypot(gx, gy)))
    resort = json.loads((PUBLIC / "resort.json").read_text())

    # roads
    road = np.zeros((H, W), np.float32)
    for r in resort["roads"]:
        width = {"tertiary": 8, "unclassified": 7, "residential": 6, "service": 5}.get(r["type"])
        if width is None:
            continue
        pts = np.array(r["points"])
        cc = (pts[:, 0] - X0) / RES; rr = ((-pts[:, 1]) - N0) / RES
        m = np.zeros((H, W), bool)
        for k in range(len(pts) - 1):
            R, C = draw_line(int(rr[k]), int(cc[k]), int(rr[k + 1]), int(cc[k + 1]))
            ok = (R >= 0) & (R < H) & (C >= 0) & (C < W)
            m[R[ok], C[ok]] = True
        if m.any():
            dist = ndimage.distance_transform_edt(~m) * RES
            road = np.maximum(road, np.clip((width / 2 + 0.8 - dist) / 1.6, 0, 1))

    # parking: flat (< 5 deg), no canopy, grey (low saturation, bright) gravel/asphalt, large connected areas
    cand = (slope < 6.5) & (c < 2.5) & (sat < 42) & (bright > 92)
    cand = ndimage.binary_opening(cand, iterations=2)
    lab, n = ndimage.label(cand)
    sizes = ndimage.sum(cand, lab, range(1, n + 1))
    keep = np.zeros_like(cand)
    for k, sz in enumerate(sizes, start=1):
        if sz > 900:  # > 900 m^2
            region = lab == k
            # must touch a road
            if (ndimage.binary_dilation(region, iterations=6) & (road > 0.5)).any():
                keep |= region
    keep = ndimage.binary_closing(keep, iterations=3)
    park = ndimage.gaussian_filter(keep.astype(np.float32), 1.2)
    mask = np.clip(np.maximum(road, park), 0, 1)
    out = (mask * 255).astype(np.uint8)
    (PUBLIC / "base.bin.gz").write_bytes(gzip.compress(b"SLB1" + struct.pack("<fffHH", X0, N0, RES, W, H) + out.tobytes(), 9, mtime=0))
    polys = []
    for ctr in measure.find_contours(np.pad(keep, 1).astype(np.uint8), 0.5):
        if len(ctr) < 20:
            continue
        ctr = measure.approximate_polygon(ctr, 1.5)
        polys.append([[round(X0 + (p[1] - 1) * RES, 1), round(-(N0 + (p[0] - 1) * RES), 1)] for p in ctr])
    resort["parking"] = polys
    (PUBLIC / "resort.json").write_text(json.dumps(resort, separators=(",", ":")))
    print(f"base mask {W}x{H}; parking areas {len(polys)} ({keep.sum():.0f} m^2); road px {(road > 0.5).sum()}")


if __name__ == "__main__":
    main()
