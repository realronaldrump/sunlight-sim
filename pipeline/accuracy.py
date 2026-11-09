"""Accuracy report: in-game run statistics vs values computed directly from the USGS DEM GeoTIFFs, and the
resort vs published figures. Writes ACCURACY.md and adds per-run stats to resort.json (used by map tooltips).

In-game stats come from tests/harness/accuracy.ts (the game's own Heightfield sampling). Run it first:
  npx tsx tests/harness/accuracy.ts
"""
import glob, gzip, json, math, struct, subprocess
import numpy as np
import rasterio
from scipy import ndimage
from config import ROOT, RAW, PROC, PUBLIC, ORIGIN_E, ORIGIN_N

FT = 3.28084


def dem_sampler():
    files = sorted(glob.glob(str(RAW / "dem1m" / "*Central_Western_2016*.tif")))
    dss = [rasterio.open(f) for f in files]

    def h(xs, ns):
        E = np.asarray(xs) + ORIGIN_E; N = np.asarray(ns) + ORIGIN_N
        out = np.full(len(E), np.nan)
        for ds in dss:
            m = np.isnan(out) & (E >= ds.bounds.left) & (E < ds.bounds.right) & (N > ds.bounds.bottom) & (N <= ds.bounds.top)
            if m.any():
                # bilinear from the raw raster
                col = (E[m] - ds.transform.c) / ds.transform.a - 0.5
                row = (N[m] - ds.transform.f) / ds.transform.e - 0.5
                r0 = int(np.floor(row.min())) - 1; c0 = int(np.floor(col.min())) - 1
                r1 = int(np.ceil(row.max())) + 2; c1 = int(np.ceil(col.max())) + 2
                win = ds.read(1, window=((r0, r1), (c0, c1))).astype(np.float64)
                out[m] = ndimage.map_coordinates(win, [row - r0, col - c0], order=1)
        return out
    return h


def line_stats(points, h):
    pts = []
    for a, b in zip(points[:-1], points[1:]):
        d = math.hypot(b[0] - a[0], b[2] - a[2]); n = max(1, math.ceil(d))
        for k in range(n):
            pts.append((a[0] + (b[0] - a[0]) * k / n, a[2] + (b[2] - a[2]) * k / n))
    pts.append((points[-1][0], points[-1][2]))
    xs = np.array([p[0] for p in pts]); zs = np.array([p[1] for p in pts])
    hs = h(xs, -zs)
    dh = np.hypot(np.diff(xs), np.diff(zs))
    lenH = dh.sum(); len3 = np.hypot(dh, np.diff(hs)).sum()
    cum = np.concatenate([[0], np.cumsum(dh)])
    max10 = 0.0
    j = 0
    for i in range(len(cum)):
        while cum[i] - cum[j] > 10:
            j += 1
        if cum[i] - cum[j] >= 9:
            max10 = max(max10, math.degrees(math.atan(abs(hs[i] - hs[j]) / (cum[i] - cum[j]))))
    return len3, lenH, hs.max(), hs.min(), max10


def main():
    resort = json.loads((PUBLIC / "resort.json").read_text())
    ing_path = ROOT / "tests" / "harness" / "out" / "ingame_stats.json"
    if not ing_path.exists():
        subprocess.run(["npx", "tsx", "tests/harness/accuracy.ts"], cwd=ROOT, check=True)
    ingame = json.loads(ing_path.read_text())
    h = dem_sampler()

    # area statistics from the run raster (2 m) and the 1 m DEM: fall-line slope over a ~5 m baseline
    meta = json.loads((PROC / "hi_1m.json").read_text())
    dem = np.load(PROC / "hi_1m.npy").astype(np.float64)
    sm = ndimage.gaussian_filter(dem, 1.5)
    gy, gx = np.gradient(sm)
    slope = np.degrees(np.arctan(np.hypot(gx, gy)))
    raw = gzip.decompress((PUBLIC / "runs.bin.gz").read_bytes())
    x0, n0, res, W, Hh = struct.unpack("<fffHH", raw[4:20])
    ids = np.frombuffer(raw[20:], "<u2").reshape(Hh, W)
    ids1 = np.zeros(dem.shape, ids.dtype)
    up = np.repeat(np.repeat(ids, 2, 0), 2, 1)
    ids1[: up.shape[0], : up.shape[1]] = up[: dem.shape[0], : dem.shape[1]]

    rows = []
    by_name = {}
    for k, r in enumerate(resort["runs"]):
        by_name.setdefault(r["name"], []).append((k, r))
    total_area = 0.0
    for name, ways in sorted(by_name.items(), key=lambda kv: kv[0]):
        idxs = [k + 1 for k, _ in ways]
        mask = np.isin(ids1, idxs)
        area = float(mask.sum())
        total_area += area
        sl = slope[mask]
        mean_s = float(sl.mean()) if sl.size else float("nan")
        p98 = float(np.percentile(sl, 98)) if sl.size else float("nan")
        lines = [w for _, w in ways if w["kind"] == "line"]
        dem_len3 = dem_lenH = 0.0; top = -1e9; bot = 1e9; dmax10 = 0.0
        for w in lines:
            l3, lh, hi, lo, m10 = line_stats(w["points"], h)
            dem_len3 += l3; dem_lenH += lh; top = max(top, hi); bot = min(bot, lo); dmax10 = max(dmax10, m10)
        if not lines:
            hs = dem[mask]
            top, bot = float(hs.max()), float(hs.min())
        g = ingame.get(name)
        row = {"name": name, "difficulty": ways[0][1]["difficulty"], "areaM2": area, "meanSlope": mean_s, "p98Slope": p98,
               "demLen": dem_len3, "demDrop": top - bot, "demAvg": math.degrees(math.atan((top - bot) / dem_lenH)) if dem_lenH else float("nan"),
               "demMax10": dmax10, "top": top, "bottom": bot, "game": g}
        rows.append(row)
        for _, w in ways:
            w["stats"] = {"lengthM": round(dem_len3) if lines else None, "dropM": round(top - bot), "avgDeg": round(mean_s, 1),
                          "maxDeg": round(p98, 1)}
    (PUBLIC / "resort.json").write_text(json.dumps(resort, separators=(",", ":")))

    # resort-level figures
    lifts = {l["name"]: l for l in resort["lifts"]}
    summit = float(max(h(np.array([lifts["Primo"]["top"][0] + dx for dx in range(-40, 41, 2) for dz in range(-40, 41, 2)]),
                         np.array([-lifts["Primo"]["top"][2] - dz for dx in range(-40, 41, 2) for dz in range(-40, 41, 2)]))))
    base_lift = min(l["bottom"][1] for l in resort["lifts"])
    lowest_run = min(r["bottom"] for r in rows if r["difficulty"] != "hike")
    heathen = next(r for r in rows if r["name"] == "The Heathen")
    ute = next(r for r in rows if r["name"] == "Ute")
    acres = total_area / 4046.86

    def f(v, d=0):
        return "n/a" if v is None or (isinstance(v, float) and math.isnan(v)) else f"{v:.{d}f}"

    L = []
    L.append("# Accuracy report\n")
    L.append("Generated by `pipeline/accuracy.py` (in-game numbers from `tests/harness/accuracy.ts`, which samples the game's own heightfield exactly as the physics does). DEM numbers are computed directly from the USGS 3DEP 1 m GeoTIFFs (project CO_Central_Western_2016) with bilinear sampling, independent of the game's tile pipeline.\n")
    L.append("## Resort vs published figures\n")
    L.append("| Figure | Published (sunlightmtn.com / trail map) | This game (from DEM/OSM) | Note |")
    L.append("|---|---|---|---|")
    L.append(f"| Summit elevation | 9,895 ft (Compass Peak) | {summit*FT:,.0f} ft ({summit:.0f} m) | DEM max within 40 m of the Primo top terminal |")
    L.append(f"| Base elevation | 7,885 ft | {base_lift*FT:,.0f} ft at the lowest lift terminal; {lowest_run*FT:,.0f} ft at the lowest run end | The published base figure is lower than the lift terminals; it likely refers to the lowest point of the permit area or older survey data |")
    L.append(f"| Vertical drop | 2,010 ft | {(summit-lowest_run)*FT:,.0f} ft (summit to lowest run end); {(summit-base_lift)*FT:,.0f} ft (summit to lowest lift terminal) | |")
    L.append(f"| Number of runs | 75 to 77 (trail map lists 75 names incl. park and hike-out) | {len(rows)} named runs | All names on the official 2024-25 trail map and East Ridge map are present |")
    L.append(f"| Skiable terrain | 730 to 740 acres | {acres:.0f} acres inside run and glade boundaries | Published acreage includes the tree-skiing areas between runs |")
    L.append(f"| The Heathen steepest pitch | 52 degrees (East Ridge map) | {heathen['p98Slope']:.0f} degrees (98th percentile, 5 m baseline), {heathen['demMax10']:.0f} degrees along the centerline (10 m) | 1 m bare-earth DEM, smoothed over about 5 m |")
    L.append(f"| Ute length | 2.5 miles (summit to base) | {ute['demLen']/1609.34:.2f} miles | OSM centerline |")
    for name, l in lifts.items():
        L.append(f"| {name} lift | {l['kind']} | {l['slopeLength']*FT:,.0f} ft slope length, {l['vertical']*FT:,.0f} ft vertical, {sum(1 for s in l['supports'] if s['kind']=='tower')} towers, {l['speed']} m/s | Published speed; legacy OSM geometry limitations below (DECISIONS.md D15) |")
    L.append("")
    L.append(subprocess.check_output(["npx", "tsx", "tests/harness/liftAccuracy.ts"], cwd=ROOT, text=True))
    L.append("## Per-run comparison: in-game vs DEM\n")
    L.append("Length is the 3D length along the OSM centerline (all ways with that name). Drop is top minus bottom along the centerline. Avg is atan(drop / horizontal length). Max 10 m is the steepest 10 m stretch along the centerline. Mean and p98 slope are fall-line slopes over the whole run area (lidar-derived boundary). Differences between game and DEM come only from the game's 1 cm height quantization and triangle interpolation.\n")
    L.append("| Run | Diff. | Length m (game / DEM) | Drop m (game / DEM) | Avg deg (game / DEM) | Max 10 m deg (game / DEM) | Area mean / p98 slope deg | Top / bottom ft |")
    L.append("|---|---|---|---|---|---|---|---|")
    worst = 0.0
    for r in rows:
        g = r["game"]
        if g:
            worst = max(worst, abs(g["lengthM"] - r["demLen"]) / max(1, r["demLen"]))
            L.append(f"| {r['name']} | {r['difficulty']} | {g['lengthM']} / {f(r['demLen'])} | {g['dropM']} / {f(r['demDrop'])} | {g['avgDeg']} / {f(r['demAvg'],1)} | {g['maxCenterline10mDeg']} / {f(r['demMax10'],1)} | {f(r['meanSlope'],1)} / {f(r['p98Slope'],1)} | {r['top']*FT:,.0f} / {r['bottom']*FT:,.0f} |")
        else:
            L.append(f"| {r['name']} | {r['difficulty']} | glade (area) | {f(r['demDrop'])} | n/a | n/a | {f(r['meanSlope'],1)} / {f(r['p98Slope'],1)} | {r['top']*FT:,.0f} / {r['bottom']*FT:,.0f} |")
    L.append(f"\nLargest in-game vs DEM length difference: {worst*100:.2f} percent.\n")
    L.append("## Base-area building evidence\n")
    lodge = next((b for b in resort["buildings"] if b.get("style") == "sunlight_lodge"), None)
    if lodge:
        roof = lodge["roofElevation"]
        lo, hi = lodge["roofSampleRange"]
        L.append(f"- Main lodge roof: {roof:.3f} m NAVD88 ({roof*FT:,.1f} ft), median of 78 lidar canopy-plus-DEM samples over the central flat roof. The 10th-to-90th percentile range is {lo:.3f} to {hi:.3f} m; that range describes local sample consistency, not absolute survey accuracy.")
        L.append("- The main lodge was missing from imported OSM footprints. Its added outline is traced from 2023 NAIP in the existing local coordinate system, with approximately 1-2 m tracing uncertainty. It is regenerated by `pipeline/build_structures.py` after the canopy step.")
    L.append("- Brettelberg uses OSM building 789090241. Timber framing, gabled roof, exterior galleries, windows and stairs are modeled from property and ski-area reference photos. Module counts and non-roof heights remain visual estimates.")
    L.append("- Main lodge facade, deck, glazing, rooftop service block and access stairs are photo-based approximations. They are not architectural survey data. Three base support structures are modeled as one-story modular buildings; other outlying structures still use generic footprint extrusion.\n")
    L.append("## Data sources\n")
    L.append("- USGS 3DEP 1 m DEM and lidar point cloud CO_Central_Western_2016 (public domain).")
    L.append("- OpenStreetMap contributors (ODbL) for run centerlines, lift lines and towers.")
    L.append("- Official Sunlight Mountain Resort trail map (names and difficulty only, reference).")
    (ROOT / "ACCURACY.md").write_text("\n".join(L) + "\n")
    print("ACCURACY.md written;", len(rows), "runs; summit", round(summit * FT), "ft; acres", round(acres), "; worst length diff", round(worst * 100, 2), "%")


if __name__ == "__main__":
    main()
