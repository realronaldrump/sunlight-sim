"""Validate shipped Sopris geometry, optionally against the original USGS files.

Use --report to record the independent native-source comparison in the shipped
accuracy manifest. Normal test runs do not modify files. Raw files are optional
for CI, but required for --report and a release accuracy claim.
"""
import json
import sys
import hashlib
from functools import lru_cache
import numpy as np
import rasterio
from config import PUBLIC, RAW, ORIGIN_E, ORIGIN_N
from terrain_codec import decode

ROOT = PUBLIC / "terrain"


@lru_cache(maxsize=64)
def tile(level, tx, tn):
    return decode((ROOT / f"L{level}" / f"{tx}_{tn}.bin.gz").read_bytes())


def height(x, n, level=2):
    r, size = 2 ** level, 256 * 2 ** level
    tx, tn = int(x // size), int(n // size)
    a = tile(level, tx, tn)
    fi, fj = (x - tx * size) / r + 1, (n - tn * size) / r + 1
    i, j = int(fi), int(fj)
    u, v = fi - i, fj - j
    h00, h10, h01, h11 = a[j, i], a[j, i + 1], a[j + 1, i], a[j + 1, i + 1]
    return float(h00 + (h10 - h00) * u + (h11 - h10) * v if u >= v else
                 h00 + (h11 - h01) * u + (h01 - h00) * v)


def validate(report=False):
    manifest = json.loads((ROOT / "sopris.json").read_text())
    index = json.loads((ROOT / "index.json").read_text())
    for f in manifest["files"]:
        data = (ROOT / f["path"]).read_bytes()
        assert hashlib.sha256(data).hexdigest() == f["sha256"], f["path"]
        a = decode(data)
        assert np.isfinite(a).all() and a.min() > 1500 and a.max() < 4000
    for region in manifest["detailRegions"][:3]:
        level = region["maxLevel"]
        size = 256 * 2 ** level
        x0, x1, n0, n1 = region["extent"]
        listed = {(t[0], t[1]) for t in index["levels"][str(level)]["tiles"]}
        for tn in range(n0 // size, n1 // size):
            for tx in range(x0 // size, x1 // size):
                assert (tx, tn) in listed
                a = tile(level, tx, tn)
                if (tx + 1) * size < x1:
                    assert np.max(np.abs(a[1:258, 257] - tile(level, tx + 1, tn)[1:258, 1])) < 0.04
                if (tn + 1) * size < n1:
                    assert np.max(np.abs(a[257, 1:258] - tile(level, tx, tn + 1)[1, 1:258])) < 0.04
    print("ok Sopris asset hashes, complete LOD tiles and shared edges")

    paths = [RAW / "sopris" / s["filename"] for s in manifest["sources"]]
    if not all(p.exists() for p in paths):
        if report:
            raise RuntimeError("Native USGS sources required to produce the accuracy report")
        print("Native source comparison skipped: download with npm run data:sopris")
        return
    # Independent source path: rasterio's coordinate sampler, not build_sopris's
    # window/array sampler. Include off-grid vertices to measure triangle error.
    rng = np.random.default_rng(20261108)
    xy = rng.integers([13320, -17400], [17400, -13320], size=(8192, 2))
    xy[:1024] = (xy[:1024] // 4) * 4
    values = np.full(len(xy), np.nan)
    coords = [(ORIGIN_E + int(x), ORIGIN_N + int(n)) for x, n in xy]
    for path in paths:
        with rasterio.open(path) as ds:
            samples = np.array([float(s[0]) for s in ds.sample(coords)])
            good = np.isfinite(samples) & (samples > -9000)
            if ds.nodata is not None:
                good &= samples != ds.nodata
            values[good] = samples[good]
    assert np.isfinite(values).all()
    errors = np.abs(np.array([height(x, n) for x, n in xy]) - values)
    assert errors[:1024].max() < 0.02, errors[:1024].max()
    assert np.percentile(errors, 95) < 1.0, np.percentile(errors, 95)
    peaks = []
    for p in manifest["summits"]:
        actual = height(p["x"], p["n"])
        assert abs(actual - p["elevation"]) < 2
        peaks.append({**p, "renderedElevation": round(actual, 3),
                      "heightErrorM": round(abs(actual - p["elevation"]), 3)})
    result = {"source": manifest["source"], "sourceResolutionM": 1, "geometrySpacingM": 4,
              "sampleCount": len(xy), "seed": 20261108,
              "maxVertexQuantizationErrorM": round(float(errors[:1024].max()), 5),
              "medianTriangleErrorM": round(float(np.median(errors)), 4),
              "p95TriangleErrorM": round(float(np.percentile(errors, 95)), 4),
              "maxTriangleErrorM": round(float(errors.max()), 4), "summits": peaks,
              "note": "Errors relative to the native DEM, not absolute survey accuracy. Snow/rock appearance is an approximation."}
    if report:
        (ROOT / "sopris-accuracy.json").write_text(json.dumps(result, indent=2) + "\n")
    print(json.dumps(result, indent=2))


if __name__ == "__main__":
    validate("--report" in sys.argv)
