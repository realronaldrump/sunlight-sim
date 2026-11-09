"""Sopris evidence section included by the main accuracy report generator."""
import json
from config import PUBLIC


def accuracy_section():
    path = PUBLIC / "terrain" / "sopris-accuracy.json"
    if not path.exists():
        return ["## Mount Sopris\n", "Native-data comparison has not been generated. Run `npm run data:sopris` and `npm run test:sopris`.\n"]
    report = json.loads(path.read_text())
    manifest = json.loads((PUBLIC / "terrain" / "sopris.json").read_text())
    lines = ["## Mount Sopris\n",
             "The landmark uses native 1 m USGS 3DEP bare-earth data from CO_SanLuisJuanMiguel_2020_D20. It retains 4 m summit, 8 m upper-slope and 16 m apron geometry from Sunlight on every graphics preset. The outer 1,024 m blends into the existing regional terrain. No smoothing, vertical scaling or procedural terrain displacement is applied to its summit and upper slopes.\n",
             "| Summit | Native DEM (NAVD88) | Rendered surface | Difference |",
             "|---|---|---|---|"]
    for p in report["summits"]:
        lines.append(f"| {p['name']} | {p['elevation']:.3f} m ({p['elevation']/0.3048:,.1f} ft) | {p['renderedElevation']:.3f} m | {p['heightErrorM']:.3f} m |")
    lines += [f"\nIndependent comparison at {report['sampleCount']:,} deterministic native DEM sample locations: median triangle interpolation error {report['medianTriangleErrorM']:.4f} m; 95th percentile {report['p95TriangleErrorM']:.4f} m; maximum {report['maxTriangleErrorM']:.4f} m. At 1,024 aligned mesh vertices, maximum encoding error is {report['maxVertexQuantizationErrorM']:.5f} m.",
              f"The {len(manifest['files'])} detail tiles total {manifest['compressedBytes']/1048576:.2f} MiB compressed. Source URLs, hashes, coverage and native summit positions are in `client/public/world/terrain/sopris.json`; numerical evidence is in `sopris-accuracy.json`. Rebuild with `npm run data:sopris`, verify with `npm run test:sopris`, and refresh the evidence with `.venv/bin/python pipeline/test_sopris.py --report`.",
              "These differences measure rendering relative to the native DEM, not absolute survey error. Seasonal snow depth, snow distribution, rock exposure and coloration remain approximations. The shared earth-curvature/refraction model is retained. Davis's October 2020 photo from Sunlight is a silhouette reference, not a texture.\n"]
    return lines
