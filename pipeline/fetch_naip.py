"""Fetch NAIP (USDA, ~0.6 m, R G B NIR) over the 1 m area from Microsoft Planetary Computer (no key),
resampled to a 1 m grid aligned with the game grid. Used only as a guide (tree species, open areas,
parking lots), never as a ground texture."""
import json, sys, time
import numpy as np, requests, rasterio
from rasterio.warp import reproject, Resampling
from rasterio.transform import from_origin
from config import RAW, PROC, ORIGIN_E, ORIGIN_N, HI_MIN_E, HI_MAX_E, HI_MIN_N, HI_MAX_N

STAC = "https://planetarycomputer.microsoft.com/api/stac/v1/search"
SIGN = "https://planetarycomputer.microsoft.com/api/sas/v1/sign"


def main():
    out = RAW / "naip_1m.tif"
    if out.exists():
        print("cached"); return
    bbox = [-107.372, 39.364, -107.302, 39.418]
    r = requests.post(STAC, json={"collections": ["naip"], "bbox": bbox, "limit": 50}, timeout=60)
    r.raise_for_status()
    items = r.json()["features"]
    items.sort(key=lambda f: f["properties"]["datetime"], reverse=True)
    print("NAIP items:", [(f["id"], f["properties"]["datetime"][:10]) for f in items[:8]])
    latest_year = items[0]["properties"]["datetime"][:4]
    use = [f for f in items if f["properties"]["datetime"][:4] == latest_year]
    # target grid: 1 m, pixel centers at game vertices (same as hi_1m mosaic incl. border)
    x0 = HI_MIN_E - 1 - 0.5; y1 = HI_MAX_N + 1 + 0.5
    w = int(HI_MAX_E - HI_MIN_E) + 3; h = int(HI_MAX_N - HI_MIN_N) + 3
    dst_t = from_origin(x0, y1, 1.0, 1.0)
    dst = np.zeros((4, h, w), np.float32)
    cnt = np.zeros((h, w), np.float32)
    for f in use:
        href = f["assets"]["image"]["href"]
        signed = requests.get(SIGN, params={"href": href}, timeout=60).json()["href"]
        with rasterio.open(signed) as src:
            from rasterio.windows import from_bounds as wfb
            from rasterio.warp import transform_bounds
            l, b_, r_, t_ = transform_bounds("EPSG:26913", src.crs, x0, y1 - h, x0 + w, y1)
            try:
                win = wfb(l, b_, r_, t_, src.transform).intersection(rasterio.windows.Window(0, 0, src.width, src.height))
            except Exception:
                print("skip (no overlap)", f["id"]); continue
            # read a decimated window (uses the COG overviews) at ~0.5 m, then resample onto our 1 m grid
            fac = max(1, int(round(0.5 / abs(src.transform.a))))
            oh, ow = max(1, int(win.height // fac)), max(1, int(win.width // fac))
            data = src.read(window=win, out_shape=(src.count, oh, ow), resampling=Resampling.average).astype(np.float32)
            wt = src.window_transform(win) * rasterio.Affine.scale(win.width / ow, win.height / oh)
            tmp = np.zeros((src.count, h, w), np.float32)
            for b in range(src.count):
                reproject(data[b], tmp[b], src_transform=wt, src_crs=src.crs, dst_transform=dst_t, dst_crs="EPSG:26913",
                          resampling=Resampling.average, src_nodata=0, dst_nodata=0)
            valid = tmp[:3].sum(0) > 0
            m = valid & (cnt == 0)
            dst[:, m] = tmp[:4, m] if src.count >= 4 else np.concatenate([tmp, tmp[:1]])[:, m]
            cnt[m] = 1
            print("merged", f["id"], valid.sum(), flush=True)
    with rasterio.open(out, "w", driver="GTiff", width=w, height=h, count=4, dtype="uint8", crs="EPSG:26913",
                       transform=dst_t, compress="deflate") as ds:
        ds.write(np.clip(dst, 0, 255).astype(np.uint8))
    (RAW / "naip_meta.json").write_text(json.dumps({"year": latest_year, "items": [f["id"] for f in use]}))
    print("wrote", out, "coverage", cnt.mean())


if __name__ == "__main__":
    main()
