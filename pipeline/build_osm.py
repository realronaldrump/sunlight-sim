"""Convert OSM runs, lifts, buildings and roads into game coordinates with DEM heights.

Output: client/public/world/resort.json
Game coords: x = E - ORIGIN_E, z = -(N - ORIGIN_N), y = NAVD88 meters.
"""
import json, math
import numpy as np
from scipy import ndimage
from pyproj import Transformer
from config import RAW, PROC, PUBLIC, ORIGIN_E, ORIGIN_N
from official_runs import OFFICIAL, RENAME, BY_ID

T = Transformer.from_crs(4326, 26913, always_xy=True)

# Lift Blog's firsthand Sunlight inventory, checked 2026-11-08 (DECISIONS.md D15).
# Convert feet/minute to SI exactly. Published capacity is nominal; installed chair count
# and the model's measured rope loop determine actual headway, not the capacity label.
LIFT_SPECS = {
    "Primo": {"seats": 4, "speed": 2.286, "capacity": 1800, "chairCount": 115, "lengthFt": 5126, "verticalFt": 1464, "rideMinutes": 11.4, "towers": 17, "type": "Fixed-grip quad chair (Leitner-Poma, 2025)"},
    "Segundo": {"seats": 3, "speed": 2.54, "capacity": 1400, "chairCount": 140, "lengthFt": 4492, "verticalFt": 1160, "rideMinutes": 9, "towers": 16, "type": "Fixed-grip triple chair (ex Arapahoe Basin, 2025)"},
    "Tercero": {"seats": 3, "speed": 1.524, "capacity": 1200, "chairCount": 110, "lengthFt": 2983, "verticalFt": 500, "rideMinutes": 9.9, "towers": 20, "type": "Fixed-grip triple chair (Riblet, 1987)"},
}
STATION_CABLE_H = 3.6     # cable height above ground at bull wheels (m); seat ~0.6 m above snow at load
MIN_CLEAR = 7.5           # minimum cable height above ground along spans (m)
SAG_FRAC = 0.018          # midspan sag as fraction of span length


class DEM:
    def __init__(self):
        self.a = np.load(PROC / "hi_1m.npy")
        m = json.loads((PROC / "hi_1m.json").read_text())
        self.x0, self.n0 = m["x0"], m["n0"]

    def h(self, x, n):
        x = np.atleast_1d(np.asarray(x, float)); n = np.atleast_1d(np.asarray(n, float))
        r = ndimage.map_coordinates(self.a, [n - self.n0, x - self.x0], order=1, mode="nearest")
        return r if r.size > 1 else r[0]


def main(lifts_only=False):
    dem = DEM()
    osm = json.load(open(RAW / "osm.json"))
    nodes = {e["id"]: e for e in osm["elements"] if e["type"] == "node"}

    def loc(nid):
        nd = nodes[nid]
        e, n = T.transform(nd["lon"], nd["lat"])
        return e - ORIGIN_E, n - ORIGIN_N

    out = {"origin": {"E": ORIGIN_E, "N": ORIGIN_N, "crs": "EPSG:26913"}, "lifts": [], "runs": [],
           "buildings": [], "roads": [], "peaks": []}

    # ---------------- lifts ----------------
    for w in osm["elements"]:
        if w["type"] != "way" or "aerialway" not in w.get("tags", {}):
            continue
        name = w["tags"]["name"]
        spec = LIFT_SPECS[name]
        pts = [loc(n) for n in w["nodes"]]
        is_pylon = [nodes[n].get("tags", {}).get("aerialway") == "pylon" for n in w["nodes"]]
        hs = [float(dem.h(x, n)) for x, n in pts]
        if hs[0] > hs[-1]:
            pts, is_pylon, hs = pts[::-1], is_pylon[::-1], hs[::-1]
        A = np.array(pts[0]); B = np.array(pts[-1])
        axis = (B - A) / np.linalg.norm(B - A)
        horiz = float(np.linalg.norm(B - A))
        # supports: stations + pylons, projected onto the straight line
        sup = [(0.0, "bottom")]
        for p, pyl in zip(pts[1:-1], is_pylon[1:-1]):
            if pyl:
                sup.append((float(np.dot(np.array(p) - A, axis)), "tower"))
        sup.append((horiz, "top"))
        sup.sort()
        s = np.array([d for d, _ in sup])
        ground = dem.h(A[0] + axis[0] * s, A[1] + axis[1] * s)
        top = ground + np.where([k == "tower" for _, k in sup], 9.0, STATION_CABLE_H)
        for _ in range(200):
            changed = False
            for i in range(len(s) - 1):
                L = s[i + 1] - s[i]
                ts = np.linspace(0, 1, max(3, int(L / 2)))
                gx = A[0] + axis[0] * (s[i] + ts * L); gn = A[1] + axis[1] * (s[i] + ts * L)
                g = dem.h(gx, gn)
                cab = top[i] + (top[i + 1] - top[i]) * ts - 4 * SAG_FRAC * L * ts * (1 - ts)
                # near stations the cable comes down to load/unload height
                dstation = np.minimum(s[i] + ts * L, horiz - (s[i] + ts * L))
                need = STATION_CABLE_H + (MIN_CLEAR - STATION_CABLE_H) * np.clip(dstation / 45.0, 0, 1)
                deficit = float(np.max(need - (cab - g)))
                if deficit > 0.05:
                    for k in (i, i + 1):
                        if sup[k][1] == "tower" and top[k] - ground[k] < 28:
                            top[k] += deficit * 0.6
                            changed = True
            if not changed:
                break
        # Winter unload pad: maintain a gentle downhill exit over the summer DEM's
        # ridge rather than making outer-seat riders climb a bare-earth lip. Terminal
        # and tower heights are modeling estimates, not surveyed hardware dimensions.
        unload_h = horiz - 6.5
        exit_h = np.arange(unload_h, horiz + 8.01, 0.5)
        right = np.array([axis[1], -axis[0]])
        required_floor = -float("inf")
        for seat in range(spec["seats"]):
            across = 2.6 + (seat - (spec["seats"] - 1) / 2) * 0.6
            ex = A[0] + axis[0] * exit_h + right[0] * across
            en = A[1] + axis[1] * exit_h + right[1] * across
            required_floor = max(required_floor, float(np.max(dem.h(ex, en) + 0.08 * (exit_h - unload_h))) + 0.05)
        i = int(np.searchsorted(s, unload_h) - 1)
        t = (unload_h - s[i]) / (s[i + 1] - s[i])
        cable = top[i] + (top[i + 1] - top[i]) * t - 4 * SAG_FRAC * (s[i + 1] - s[i]) * t * (1 - t)
        raise_by = max(0, required_floor - (cable - 3.0 + 0.035 - 0.52))
        top[i:] += raise_by
        slope_len = float(sum(math.hypot(s[i + 1] - s[i], top[i + 1] - top[i]) for i in range(len(s) - 1)))
        spacing = spec["seats"] * spec["speed"] * 3600 / spec["capacity"]
        out["lifts"].append({
            "name": name, "osmId": w["id"], "kind": spec["type"], "seats": spec["seats"], "speed": spec["speed"],
            "capacity": spec["capacity"], "chairSpacing": round(spacing, 2), "chairCount": spec["chairCount"],
            "reference": {"url": "https://liftblog.com/sunlight-co/", **{k: spec[k] for k in ("lengthFt", "verticalFt", "rideMinutes", "towers")}},
            "bottom": [round(A[0], 2), round(float(ground[0]), 2), round(-A[1], 2)],
            "top": [round(B[0], 2), round(float(ground[-1]), 2), round(-B[1], 2)],
            "horizontalLength": round(horiz, 1), "slopeLength": round(slope_len, 1),
            "vertical": round(float(ground[-1] - ground[0]), 1),
            "supports": [{"s": round(float(si), 2), "kind": k, "ground": round(float(gi), 2), "cable": round(float(ti), 2)}
                         for (si, k), gi, ti in zip(zip(s, [k for _, k in sup]), ground, top)],
        })
        print(f"lift {name}: horiz {horiz:.0f} m, slope {slope_len:.0f} m, vertical {ground[-1]-ground[0]:.0f} m, "
              f"{sum(1 for _, k in sup if k == 'tower')} towers, tower heights {np.round(top - ground, 1)[1:-1].tolist()}")

    if lifts_only:
        existing = json.loads((PUBLIC / "resort.json").read_text())
        existing["lifts"] = out["lifts"]
        (PUBLIC / "resort.json").write_text(json.dumps(existing, separators=(",", ":")))
        return

    # ---------------- runs ----------------
    seen = set()
    for w in osm["elements"]:
        if w["type"] != "way":
            continue
        tg = w.get("tags", {})
        if tg.get("piste:type") not in ("downhill", "hike"):
            continue
        name = BY_ID.get(w["id"]) or RENAME.get(tg.get("name"), tg.get("name"))
        if name is None:
            print("WARNING unnamed run", w["id"]); continue
        diff = OFFICIAL.get(name)
        if diff is None:
            print("WARNING run not on official map:", name, w["id"]); diff = {"easy": "green", "intermediate": "blue", "advanced": "black", "expert": "double"}.get(tg.get("piste:difficulty"), "blue")
        pts = [loc(n) for n in w["nodes"]]
        closed = w["nodes"][0] == w["nodes"][-1] and len(pts) > 3
        area = closed and (tg.get("area") == "yes" or "Glades" in name or tg.get("piste:type") == "downhill" and closed)
        hs = dem.h([p[0] for p in pts], [p[1] for p in pts])
        if not area and hs[0] < hs[-1] and diff != "hike":
            pts = pts[::-1]; hs = hs[::-1]
        groom = tg.get("piste:grooming", "")
        grooming = "glade" if area else ("moguls" if "mogul" in groom and "classic" not in groom else
                                         "mixed" if "mogul" in groom else "groomed")
        if diff == "park":
            grooming = "groomed"
        out["runs"].append({
            "id": w["id"], "name": name, "difficulty": diff, "grooming": grooming,
            "kind": "area" if area else "line",
            "points": [[round(p[0], 1), round(float(h), 1), round(-p[1], 1)] for p, h in zip(pts, hs)],
        })
        seen.add(name)
    missing = sorted(set(OFFICIAL) - seen)
    print(f"runs: {len(out['runs'])} ways, {len(seen)} official names present; missing: {missing}")
    out["missingOfficialRuns"] = missing

    # ---------------- buildings, roads ----------------
    for w in osm["elements"]:
        if w["type"] != "way":
            continue
        tg = w.get("tags", {})
        pts = [loc(n) for n in w["nodes"]]
        if not pts:
            continue
        cx = sum(p[0] for p in pts) / len(pts); cn = sum(p[1] for p in pts) / len(pts)
        if abs(cx) > 2000 or abs(cn) > 2100:
            continue
        if "building" in tg:
            hs = dem.h([p[0] for p in pts], [p[1] for p in pts])
            out["buildings"].append({"id": w["id"], "name": tg.get("name", ""), "levels": int(tg.get("building:levels", 2)),
                                     "base": round(float(np.min(hs)), 2),
                                     "points": [[round(p[0], 2), round(-p[1], 2)] for p in pts[:-1]]})
        elif tg.get("highway") in ("tertiary", "unclassified", "service", "residential", "track"):
            out["roads"].append({"id": w["id"], "type": tg["highway"], "name": tg.get("name", ""),
                                 "points": [[round(p[0], 1), round(-p[1], 1)] for p in pts]})
    for e in osm["elements"]:
        if e["type"] == "node" and e.get("tags", {}).get("natural") == "peak" and e["tags"].get("name"):
            x, n = loc(e["id"])
            ele = e["tags"].get("ele")
            try:
                ele = float(ele)
            except (TypeError, ValueError):
                ele = None
            out["peaks"].append({"name": e["tags"]["name"], "x": round(x), "z": round(-n), "ele": ele})

    PUBLIC.mkdir(parents=True, exist_ok=True)
    (PUBLIC / "resort.json").write_text(json.dumps(out, separators=(",", ":")))
    print("wrote resort.json", len(out["lifts"]), "lifts", len(out["runs"]), "runs", len(out["buildings"]), "buildings")


if __name__ == "__main__":
    import sys
    main(lifts_only="--lifts-only" in sys.argv)
