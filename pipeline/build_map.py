"""Trail map background (generated from our own DEM + canopy, no copyrighted imagery) and resort boundary.

Outputs: client/public/world/map.jpg (+ bounds in resort.json "map"), resort.json "boundary" (game x/z)
"""
import json
import numpy as np
from PIL import Image
from scipy import ndimage
from pyproj import Transformer
from config import RAW, PROC, PUBLIC, ORIGIN_E, ORIGIN_N

EXT = 1400  # half size (m) of the map around the origin
RES = 2.0


def main():
    meta = json.loads((PROC / "hi_1m.json").read_text())
    x0, n0 = meta["x0"], meta["n0"]
    dem = np.load(PROC / "hi_1m.npy")
    chm = np.load(PROC / "chm_1m.npy")
    i0 = int(-EXT - x0); j0 = int(-EXT - n0); size = int(2 * EXT)
    d = dem[j0:j0 + size, i0:i0 + size]
    c = chm[j0:j0 + size, i0:i0 + size]
    d = d.reshape(size // 2, 2, size // 2, 2).mean(axis=(1, 3))
    c = (c.reshape(size // 2, 2, size // 2, 2) > 2).mean(axis=(1, 3))
    gy, gx = np.gradient(ndimage.gaussian_filter(d, 1.0), RES)
    # light from the north-west, rows are south->north
    lx, ly, lz = -0.6, 0.6, 0.55
    nrm = np.sqrt(gx ** 2 + gy ** 2 + 1)
    shade = np.clip((-gx * lx - gy * ly + lz) / nrm / np.sqrt(lx * lx + ly * ly + lz * lz), 0, 1)
    snow = np.array([238, 242, 247], np.float32)
    forest = np.array([62, 98, 72], np.float32)
    base = snow[None, None] * (1 - c[..., None] * 0.85) + forest[None, None] * (c[..., None] * 0.85)
    img = base * (0.55 + 0.45 * shade[..., None])
    # contour lines every 20 m, darker every 100 m
    for step, a in ((20, 0.10), (100, 0.22)):
        q = np.floor(d / step)
        edge = (q != np.roll(q, 1, 0)) | (q != np.roll(q, 1, 1))
        img[edge] *= (1 - a)
    img = np.clip(img[::-1], 0, 255).astype(np.uint8)  # north up
    Image.fromarray(img).save(PUBLIC / "map.jpg", quality=86, optimize=True)

    resort = json.loads((PUBLIC / "resort.json").read_text())
    resort["map"] = {"x0": -EXT, "x1": EXT, "z0": -EXT, "z1": EXT, "res": RES}
    # ski area boundary from OSM landuse=winter_sports (Sunlight Mountain Resort)
    osm = json.load(open(RAW / "osm.json"))
    nodes = {e["id"]: e for e in osm["elements"] if e["type"] == "node"}
    T = Transformer.from_crs(4326, 26913, always_xy=True)
    for w in osm["elements"]:
        if w["type"] == "way" and w.get("tags", {}).get("landuse") == "winter_sports" and "Sunlight" in w["tags"].get("name", ""):
            pts = []
            for nid in w["nodes"]:
                e, n = T.transform(nodes[nid]["lon"], nodes[nid]["lat"])
                x, nn = e - ORIGIN_E, n - ORIGIN_N
                h = float(dem[int(round(nn - n0)), int(round(x - x0))])
                pts.append([round(x, 1), round(h, 1), round(-nn, 1)])
            resort["boundary"] = pts
            print("boundary points", len(pts))
    (PUBLIC / "resort.json").write_text(json.dumps(resort, separators=(",", ":")))
    print("map", img.shape)


if __name__ == "__main__":
    main()
