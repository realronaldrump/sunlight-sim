"""Tree-cover fraction for terrain outside the lidar area, from ESA WorldCover 10 m 2021 (CC BY 4.0,
public COGs on AWS, no key). Used to darken forested slopes on distant terrain where no tree instances exist.

Outputs: client/public/world/landcover_far.bin.gz  (64 m cells over +-65.5 km)
         client/public/world/landcover_mid.bin.gz  (16 m cells over +-16.4 km)
Format: "SLL1" | f32 x0 | f32 n0 | f32 res | u16 w | u16 h | u8 fraction*255 [w*h], rows south->north
"""
import gzip, struct
import numpy as np
import rasterio
from rasterio.warp import reproject, Resampling, transform_bounds
from rasterio.transform import from_origin
from rasterio.windows import from_bounds
from config import PUBLIC, ORIGIN_E, ORIGIN_N, FAR_HALF, REGION_HALF

TILES = [
    "https://esa-worldcover.s3.eu-central-1.amazonaws.com/v200/2021/map/ESA_WorldCover_10m_2021_v200_N39W108_Map.tif",
    "https://esa-worldcover.s3.eu-central-1.amazonaws.com/v200/2021/map/ESA_WorldCover_10m_2021_v200_N36W108_Map.tif",
    "https://esa-worldcover.s3.eu-central-1.amazonaws.com/v200/2021/map/ESA_WorldCover_10m_2021_v200_N39W111_Map.tif",
    "https://esa-worldcover.s3.eu-central-1.amazonaws.com/v200/2021/map/ESA_WorldCover_10m_2021_v200_N36W111_Map.tif",
]


def build(name, half, res, read_res):
    n = int(2 * half / res)
    x0 = -half; n0 = -half
    dst_t = from_origin(ORIGIN_E + x0, ORIGIN_N + n0 + n * res, res, res)
    acc = np.zeros((n, n), np.float32)
    have = np.zeros((n, n), np.float32)
    bounds_utm = (ORIGIN_E + x0, ORIGIN_N + n0, ORIGIN_E + x0 + n * res, ORIGIN_N + n0 + n * res)
    with rasterio.Env(GDAL_DISABLE_READDIR_ON_OPEN="EMPTY_DIR", CPL_VSIL_CURL_ALLOWED_EXTENSIONS=".tif"):
        for url in TILES:
            with rasterio.open(url) as src:
                l, b, r, t = transform_bounds("EPSG:26913", src.crs, *bounds_utm)
                try:
                    win = from_bounds(l, b, r, t, src.transform).intersection(rasterio.windows.Window(0, 0, src.width, src.height))
                except Exception:
                    continue
                deg = read_res / 111000.0
                fac = max(1, int(round(deg / src.transform.a)))
                oh, ow = int(win.height // fac), int(win.width // fac)
                cls = src.read(1, window=win, out_shape=(oh, ow), resampling=Resampling.nearest)
                wt = src.window_transform(win) * rasterio.Affine.scale(win.width / ow, win.height / oh)
                tree = (cls == 10).astype(np.float32)
                valid = (cls > 0).astype(np.float32)
                tmp = np.zeros((n, n), np.float32); tv = np.zeros((n, n), np.float32)
                reproject(tree, tmp, src_transform=wt, src_crs=src.crs, dst_transform=dst_t, dst_crs="EPSG:26913", resampling=Resampling.average)
                reproject(valid, tv, src_transform=wt, src_crs=src.crs, dst_transform=dst_t, dst_crs="EPSG:26913", resampling=Resampling.average)
                m = (tv > 0.5) & (have == 0)
                acc[m] = tmp[m] / np.maximum(tv[m], 1e-3)
                have[m] = 1
                print(name, url.split("_")[-2], "covered", m.mean())
    frac = np.clip(acc, 0, 1)[::-1]  # rows south->north
    out = (frac * 255).astype(np.uint8)
    (PUBLIC / f"{name}.bin.gz").write_bytes(gzip.compress(b"SLL1" + struct.pack("<fffHH", x0, n0, res, n, n) + out.tobytes(), 9, mtime=0))
    print(name, "mean tree cover", frac.mean())


def main():
    build("landcover_far", FAR_HALF, 64.0, 30.0)
    build("landcover_mid", REGION_HALF, 16.0, 10.0)


if __name__ == "__main__":
    main()
