"""Preserve Mount Sopris using pinned USGS 1 m bare-earth elevations.

Only this landmark gets 4 m summit geometry, 8 m upper slopes and a 16 m apron.
Samples are actual source pixel centers, without low-pass smoothing, invented
displacement or vertical exaggeration. The outer 1,024 m blends into the
existing regional terrain. Run after build_terrain.py, or independently.
"""
import hashlib
import json
import concurrent.futures as cf

import numpy as np
import rasterio
from rasterio.windows import Window

from build_terrain import downsample, read_tif_grid
from config import CRS, ORIGIN_E, ORIGIN_N, PUBLIC, RAW
from fetch_usgs import download
from terrain_codec import encode

PROJECT = "CO_SanLuisJuanMiguel_2020_D20"
SOURCE_ROOT = f"https://prd-tnm.s3.amazonaws.com/StagedProducts/Elevation/1m/Projects/{PROJECT}/TIFF"
SOURCE_IDS = {
    "x30y435": "62172170d34ec739b2dbf70c",
    "x30y436": "6217216fd34ec739b2dbf70a",
    "x31y435": "62172161d34ec739b2dbf6f4",
    "x31y436": "62172160d34ec739b2dbf6f2",
}
SOURCE_HASHES = {
    "x30y435": "03e17518f41c1476d298d1c6b4db559981ac64f040bf42e09feb209329ffb2a1",
    "x30y436": "efb0ca34e51c39cfa3944d8f86a4ac1dcf8a580ea35d1f987c3c5307965e032a",
    "x31y435": "3f801835876aa9895d9e9b6b604063f4104bb52151890f83addf2326642bdcfc",
    "x31y436": "5fc8f64b4e9bf178298b22a5d9396d6d33d857b0b85b6e7d725501cf2b4bf0e4",
}
EXTENTS = {
    2: (13312, 17408, -17408, -13312),
    3: (10240, 18432, -18432, -12288),
    4: (8192, 20480, -20480, -8192),
}
BLEND = 1024
SAMPLES = 259
OUT = PUBLIC / "terrain"


def sources():
    root = RAW / "sopris"
    root.mkdir(parents=True, exist_ok=True)
    records = []
    for tile, source_id in SOURCE_IDS.items():
        filename = f"USGS_1M_13_{tile}_{PROJECT}.tif"
        records.append({"filename": filename, "url": f"{SOURCE_ROOT}/{filename}",
                        "metadataUrl": f"https://www.sciencebase.gov/catalog/item/{source_id}"})
    with cf.ThreadPoolExecutor(2) as pool:
        for path, status in pool.map(lambda r: download(r["url"], root / r["filename"]), records):
            if status == "FAILED":
                raise RuntimeError(f"Missing Sopris elevation source: {path}")
            print(status, path.name, flush=True)
    for record in records:
        path = root / record["filename"]
        with path.open("rb") as f:
            record["sha256"] = hashlib.file_digest(f, "sha256").hexdigest()
        tile = record["filename"].split("_13_")[1].split("_CO_")[0]
        if record["sha256"] != SOURCE_HASHES[tile]:
            raise ValueError(f"USGS source changed or is incomplete: {path.name}")
        record["bytes"] = path.stat().st_size
    return records


def sample_sources(datasets, xs, ns):
    """Sample aligned 1 m source centers exactly, preserving narrow ridgelines."""
    out = np.full((len(ns), len(xs)), np.nan, dtype=np.float32)
    for ds in datasets:
        assert ds.crs == rasterio.crs.CRS.from_string(CRS) and ds.res == (1, 1)
        cols = (ORIGIN_E + xs - ds.transform.c) - 0.5
        rows = (ds.transform.f - (ORIGIN_N + ns)) - 0.5
        assert np.allclose(cols, np.round(cols), atol=0.001, rtol=0)
        assert np.allclose(rows, np.round(rows), atol=0.001, rtol=0)
        ci = np.flatnonzero((cols >= 0) & (cols < ds.width))
        ri = np.flatnonzero((rows >= 0) & (rows < ds.height))
        if not len(ci) or not len(ri):
            continue
        cc, rr = np.round(cols[ci]).astype(int), np.round(rows[ri]).astype(int)
        c0, r0 = int(cc.min()), int(rr.min())
        a = ds.read(1, window=Window(c0, r0, int(cc.max()) - c0 + 1, int(rr.max()) - r0 + 1))
        values = a[(rr - r0)[:, None], (cc - c0)[None, :]]
        good = np.isfinite(values) & (values > -9000)
        if ds.nodata is not None:
            good &= values != ds.nodata
        target = out[np.ix_(ri, ci)]
        target[good] = values[good]
        out[np.ix_(ri, ci)] = target
    return out


def blend_weight(xs, ns):
    x0, x1, n0, n1 = EXTENTS[4]
    x, n = np.meshgrid(xs, ns)
    d = np.minimum.reduce([x - x0, x1 - x, n - n0, n1 - n])
    w = np.clip(d / BLEND, 0, 1)
    return w * w * (3 - 2 * w)


def reference_grid():
    # Reconstruct the old data from raw inputs, never from the previous output:
    # repeated builds must not blend an already blended tile a second time.
    regional = downsample(read_tif_grid(RAW / "regional_8m.tif"), 2)
    far = read_tif_grid(RAW / "far_32m.tif")

    def sample(xs, ns):
        x, n = np.meshgrid(xs, ns)
        values = far.sample(x, n)
        inside = (np.abs(x) <= 16384) & (np.abs(n) <= 16384)
        values[inside] = regional.sample(x[inside], n[inside])
        return values
    return sample


def build():
    records = sources()
    datasets = [rasterio.open(RAW / "sopris" / r["filename"]) for r in records]
    baseline = reference_grid()
    index = json.loads((OUT / "index.json").read_text())
    files, coverage = [], {}
    try:
        for level, extent in EXTENTS.items():
            r, size = 2 ** level, 256 * 2 ** level
            x0, x1, n0, n1 = extent
            level_dir = OUT / f"L{level}"
            level_dir.mkdir(exist_ok=True)
            entries = {(a[0], a[1]): a for a in index["levels"][str(level)]["tiles"]}
            missing, count = 0, 0
            for tn in range(n0 // size, n1 // size):
                for tx in range(x0 // size, x1 // size):
                    xs = tx * size + (np.arange(SAMPLES) - 1) * r
                    ns = tn * size + (np.arange(SAMPLES) - 1) * r
                    data = sample_sources(datasets, xs, ns)
                    valid = np.isfinite(data)
                    missing += int((~valid).sum())
                    count += data.size
                    if level <= 3 and not valid.all():
                        raise ValueError(f"Incomplete lidar coverage on Sopris L{level}/{tx}_{tn}")
                    base = baseline(xs, ns)
                    weight = blend_weight(xs, ns) * valid
                    heights = base + (np.where(valid, data, base) - base) * weight
                    assert np.isfinite(heights).all()
                    # 1 cm quantization; no distant-terrain height rounding.
                    buf = encode(heights, 0.01)
                    path = level_dir / f"{tx}_{tn}.bin.gz"
                    path.write_bytes(buf)
                    entries[(tx, tn)] = [tx, tn, round(float(heights.min()), 2), round(float(heights.max()), 2)]
                    files.append({"path": str(path.relative_to(OUT)), "bytes": len(buf),
                                  "sha256": hashlib.sha256(buf).hexdigest()})
            index["levels"][str(level)]["tiles"] = sorted(entries.values(), key=lambda t: (t[1], t[0]))
            coverage[str(level)] = {"samples": count, "missingSourceSamples": missing}
            print(f"Sopris L{level}: {r} m geometry, {missing}/{count} source gaps", flush=True)
        # Both topographic maxima are found from the native 1 m raster, not OSM
        # elevation labels or a published height imposed on the geometry.
        xs, ns = np.arange(13312, 17409), np.arange(-17408, -13311)
        native = sample_sources(datasets, xs, ns)
        assert np.isfinite(native).all()
        peaks = []
        search = native.copy()
        for _ in range(2):
            j, i = np.unravel_index(np.argmax(search), search.shape)
            peaks.append({"x": int(xs[i]), "n": int(ns[j]), "elevation": float(native[j, i])})
            # The two summits are separated by about a kilometer.
            yy, xx = np.ogrid[:len(ns), :len(xs)]
            search[(xx - i) ** 2 + (yy - j) ** 2 < 700 ** 2] = -np.inf
        peaks.sort(key=lambda p: p["x"])
        peaks[0]["name"], peaks[1]["name"] = "West Sopris", "East Sopris"
        regions = [{"name": "Mount Sopris", "extent": list(ex), "maxLevel": level}
                   for level, ex in EXTENTS.items()]
        # Keep neighboring LOD steps modest where the apron rejoins the horizon.
        regions += [{"name": "Mount Sopris transition", "extent": [4096, 24576, -24576, -4096], "maxLevel": 5}]
        index["detailRegions"] = [d for d in index.get("detailRegions", []) if not d["name"].startswith("Mount Sopris")] + regions
        index["revision"] = "sopris-" + hashlib.sha256(json.dumps(files, sort_keys=True).encode()).hexdigest()[:16]
        manifest = {"name": "Mount Sopris", "source": "USGS 3DEP 1 m DEM", "project": PROJECT,
                    "sourceResolutionM": 1, "horizontalCRS": CRS, "verticalDatum": "NAVD88",
                    "license": "Public domain (U.S. Government work)", "sources": records,
                    "geometrySpacingM": [4, 8, 16], "edgeBlendM": BLEND, "coverage": coverage,
                    "summits": peaks, "detailRegions": regions, "files": files,
                    "compressedBytes": sum(f["bytes"] for f in files)}
        (OUT / "sopris.json").write_text(json.dumps(manifest, indent=2) + "\n")
        (OUT / "index.json").write_text(json.dumps(index))
        print(json.dumps({"summits": peaks, "bytes": manifest["compressedBytes"]}, indent=2))
    finally:
        for ds in datasets:
            ds.close()


if __name__ == "__main__":
    build()
    from test_sopris import validate
    validate(report=True)
