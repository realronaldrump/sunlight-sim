"""Add reference-checked structures missing from OSM; preserve all run/lift data.

The lodge roof outline is traced from the already downloaded 2023 NAIP, in the same local CRS.
See DECISIONS.md and CREDITS.md for photo references and uncertainty. Run after build_osm.py.
"""
import json
import numpy as np
from scipy.ndimage import map_coordinates, binary_erosion, binary_dilation
from config import PROC, PUBLIC

LODGE = {
    "id": -1001, "name": "Sunlight Mountain Main Lodge", "style": "sunlight_lodge", "levels": 2,
    "points": [[112, -978], [127, -974], [119, -944], [104, -948], [107, -960], [99, -962], [102, -972], [110, -970]],
    "provenance": "Roof footprint traced from USDA NAIP 2023, about 1-2 m uncertainty. Main roof elevation from 2016 USGS lidar returns. Facade, floor, deck and roof-plant details from photos and estimates.",
}
# Summit ski patrol building west of the Primo top terminal: footprint from the green metal roof in
# NAIP 2023 (about 9 x 15 m, long axis about 69 degrees from east toward north); heights are measured by
# lidar_massing below. Corners in local (x, z).
_c, _s = np.cos(np.radians(69)), np.sin(np.radians(69))
_ax, _az = _c, -_s          # long axis in game x/z (z = -north)
_bx, _bz = _s, _c           # short axis
PATROL = {
    "id": -1002, "name": "Ski patrol summit building", "levels": 1,
    "points": [[round(-15.5 + _ax * a * 7.5 + _bx * b * 4.5, 2), round(980.0 + _az * a * 7.5 + _bz * b * 4.5, 2)] for a, b in [(-1, -1), (1, -1), (1, 1), (-1, 1)]],
    "sign": {"text": "SKI PATROL", "bg": "#ffffff", "fg": "#c21b1b", "cross": True},
    "provenance": "Roof outline traced from USDA NAIP 2023 (about 1-2 m uncertainty); eave and ridge from 2016 USGS lidar. Use as the patrol building is an inference from its summit location and Sunlight patrol practice.",
}
OVERRIDES = {
    789090241: {"name": "Brettelberg Condominiums", "style": "brettelberg", "levels": 2},
    789088639: {"name": "Base area modular building", "style": "base_modular", "levels": 1},
    789101612: {"name": "Base area service building", "style": "base_modular", "levels": 1},
    789106639: {"name": "Base lift operations building", "style": "base_modular", "levels": 1},
}

def _inside(x, y, poly):
    inside = np.zeros(x.shape, bool)
    for i in range(len(poly)):
        x1, y1 = poly[i]; x2, y2 = poly[(i + 1) % len(poly)]
        inside ^= ((y1 > y) != (y2 > y)) & (x < (x2 - x1) * (y - y1) / ((y2 - y1) + 1e-12) + x1)
    return inside


def lidar_massing(resort, dem, chm, meta):
    """Eave, ridge and roof form for generic buildings from 2016 lidar first returns.

    Grade is the DEM on a 2 m ring outside the footprint. Inside the eroded footprint the surface
    (DEM + canopy/structure height) gives roof elevations: the 20th percentile approximates the eave
    and the 90th the ridge, capped at 4.5 m above the median so overhanging trees do not inflate it.
    A spread under 1.2 m is a flat or low-slope roof. Footprints without returns keep OSM levels.
    """
    x0, n0 = meta["x0"], meta["n0"]
    H, W = dem.shape
    for b in resort["buildings"]:
        if b.get("style"):
            continue
        pts = np.array(b["points"], float)
        xs, ns = pts[:, 0], -pts[:, 1]
        i0, i1 = int(xs.min() - x0) - 2, int(xs.max() - x0) + 3
        j0, j1 = int(ns.min() - n0) - 2, int(ns.max() - n0) + 3
        if i0 < 0 or j0 < 0 or i1 > W or j1 > H:
            continue
        jj, ii = np.mgrid[j0:j1, i0:i1]
        inside = _inside((ii + x0).astype(float), (jj + n0).astype(float), list(zip(xs, ns)))
        core = binary_erosion(inside, iterations=1)
        if core.sum() < 4:
            core = inside
        D = np.asarray(dem[j0:j1, i0:i1]); C = np.asarray(chm[j0:j1, i0:i1])
        ring = binary_dilation(inside, iterations=2) & ~inside
        roof = (D + C)[core]
        if core.sum() < 4 or np.percentile(C[core], 50) < 2.0:
            continue
        p20, p50, p90 = np.percentile(roof, [20, 50, 90])
        ridge = min(p90, p50 + 4.5)
        b["grade"] = [round(float(D[ring].min()), 2), round(float(D[ring].max()), 2)]
        b["roofTop"] = round(float(ridge), 2)
        b["eave"] = round(float(p20 if ridge - p20 > 1.2 else ridge), 2)
        b["roofForm"] = "pitched" if ridge - p20 > 1.2 else "flat"
        footprint_source = "NAIP" if b["id"] == PATROL["id"] else "OSM"
        b["heightSource"] = f"2016 USGS lidar first returns inside the {footprint_source} footprint"


def apply(resort):
    for b in resort["buildings"]:
        if b["id"] in OVERRIDES:
            b.update(OVERRIDES[b["id"]])
    b = next((b for b in resort["buildings"] if b["id"] == LODGE["id"]), None)
    if b is None:
        b = {}; resort["buildings"].append(b)
    b.update(LODGE)
    patrol = next((p for p in resort["buildings"] if p["id"] == PATROL["id"]), None)
    if patrol is None:
        patrol = {}; resort["buildings"].append(patrol)
    patrol.update(PATROL)
    meta = json.loads((PROC / "hi_1m.json").read_text())
    dem = np.load(PROC / "hi_1m.npy", mmap_mode="r")
    chm = np.load(PROC / "chm_1m.npy", mmap_mode="r")
    points = np.array(b["points"])
    heights = map_coordinates(dem, [-points[:, 1] - meta["n0"], points[:, 0] - meta["x0"]], order=1, mode="nearest")
    b["base"] = round(float(heights.min()), 2)
    j0, j1 = int(956-meta["n0"]), int(969-meta["n0"])
    i0, i1 = int(112-meta["x0"]), int(118-meta["x0"])
    roof = dem[j0:j1, i0:i1] + chm[j0:j1, i0:i1]
    b["roofElevation"] = round(float(np.median(roof)), 3)
    b["roofSampleRange"] = [round(float(v), 3) for v in np.percentile(roof, [10, 90])]
    lidar_massing(resort, dem, chm, meta)
    return resort

if __name__ == "__main__":
    path = PUBLIC / "resort.json"
    resort = apply(json.loads(path.read_text()))
    path.write_text(json.dumps(resort, separators=(",", ":")))
    print("Reference-checked structures:", [b["name"] for b in resort["buildings"] if b.get("style")])
