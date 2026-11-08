"""Fetch regional (8 m grid, from 1/3 arc-second 3DEP) and far (32 m grid) elevation around the resort
from the USGS 3DEP ImageServer (no key). Grids are vertex-aligned to ORIGIN in UTM 13N.
Requests are split into blocks because the server times out on large exports."""
import sys, time, io, concurrent.futures as cf
import numpy as np, requests, rasterio
from rasterio.transform import from_origin
from config import RAW, ORIGIN_E, ORIGIN_N, REGION_HALF, FAR_HALF, CRS

URL = "https://elevation.nationalmap.gov/arcgis/rest/services/3DEPElevation/ImageServer/exportImage"
BLOCK = 1024

def get_block(res, x0, y0, w, h):
    """Return float32 array (h, w) whose pixel (r, c) center is at (x0 + c*res, y0 - r*res)."""
    params = {
        "bbox": f"{x0 - res/2},{y0 - (h-1)*res - res/2},{x0 + (w-1)*res + res/2},{y0 + res/2}",
        "bboxSR": 26913, "imageSR": 26913, "size": f"{w},{h}", "format": "tiff",
        "pixelType": "F32", "interpolation": "RSP_BilinearInterpolation", "noData": -9999, "f": "image",
    }
    for attempt in range(8):
        try:
            r = requests.get(URL, params=params, timeout=300)
            r.raise_for_status()
            with rasterio.open(io.BytesIO(r.content)) as ds:
                a = ds.read(1).astype(np.float32)
            assert a.shape == (h, w), a.shape
            return a
        except Exception as e:
            print("retry block", x0, y0, e, file=sys.stderr, flush=True); time.sleep(3 * (attempt + 1))
    raise RuntimeError("block failed")

def fetch(name, res, half):
    out = RAW / f"{name}.tif"
    if out.exists():
        print("cached", out.name); return
    n = int(half / res) + 1
    count = 2 * n + 1
    xs0 = ORIGIN_E - n * res; ytop = ORIGIN_N + n * res
    arr = np.full((count, count), -9999, np.float32)
    jobs = [(r0, c0) for r0 in range(0, count, BLOCK) for c0 in range(0, count, BLOCK)]
    def run(job):
        r0, c0 = job
        h = min(BLOCK, count - r0); w = min(BLOCK, count - c0)
        return r0, c0, get_block(res, xs0 + c0 * res, ytop - r0 * res, w, h)
    with cf.ThreadPoolExecutor(4) as ex:
        for r0, c0, a in ex.map(run, jobs):
            arr[r0:r0 + a.shape[0], c0:c0 + a.shape[1]] = a
            print(name, "block", r0, c0, flush=True)
    tr = from_origin(xs0 - res / 2, ytop + res / 2, res, res)
    with rasterio.open(out, "w", driver="GTiff", width=count, height=count, count=1, dtype="float32",
                       crs=CRS, transform=tr, nodata=-9999, compress="deflate", predictor=3) as ds:
        ds.write(arr, 1)
    print("wrote", out, "min", arr[arr > -9000].min(), "max", arr.max())

if __name__ == "__main__":
    fetch("regional_8m", 8, REGION_HALF)
    fetch("far_32m", 32, FAR_HALF)
