"""Add reference-checked base structures missing from OSM; preserve all run/lift data.

The lodge roof outline is traced from the already downloaded 2023 NAIP, in the same local CRS.
See DECISIONS.md and CREDITS.md for photo references and uncertainty. Run after build_osm.py.
"""
import json
import numpy as np
from scipy.ndimage import map_coordinates
from config import PROC, PUBLIC

LODGE = {
    "id": -1001, "name": "Sunlight Mountain Main Lodge", "style": "sunlight_lodge", "levels": 2,
    "points": [[112, -978], [127, -974], [119, -944], [104, -948], [107, -960], [99, -962], [102, -972], [110, -970]],
    "provenance": "Roof footprint traced from USDA NAIP 2023, about 1-2 m uncertainty. Main roof elevation from 2016 USGS lidar returns. Facade, floor, deck and roof-plant details from photos and estimates.",
}
OVERRIDES = {
    789090241: {"name": "Brettelberg Condominiums", "style": "brettelberg", "levels": 2},
    789088639: {"name": "Base area modular building", "style": "base_modular", "levels": 1},
    789101612: {"name": "Base area service building", "style": "base_modular", "levels": 1},
    789106639: {"name": "Base lift operations building", "style": "base_modular", "levels": 1},
}

def apply(resort):
    for b in resort["buildings"]:
        if b["id"] in OVERRIDES:
            b.update(OVERRIDES[b["id"]])
    b = next((b for b in resort["buildings"] if b["id"] == LODGE["id"]), None)
    if b is None:
        b = {}; resort["buildings"].append(b)
    b.update(LODGE)
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
    return resort

if __name__ == "__main__":
    path = PUBLIC / "resort.json"
    resort = apply(json.loads(path.read_text()))
    path.write_text(json.dumps(resort, separators=(",", ":")))
    print("Reference-checked structures:", [b["name"] for b in resort["buildings"] if b.get("style")])
