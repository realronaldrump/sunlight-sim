"""Debug plot: OSM downhill runs and lifts with way IDs over a hillshade (for matching to the trail map)."""
import json, numpy as np
from PIL import Image, ImageDraw, ImageFont
from pyproj import Transformer
from config import RAW, PROC, ORIGIN_E, ORIGIN_N

hi = np.load(PROC / "hi_1m.npy"); meta = json.loads((PROC / "hi_1m.json").read_text())
x0, n0 = meta["x0"], meta["n0"]
# crop to resort area
cx0, cx1, cn0, cn1 = -1300, 1300, -1300, 1300
sub = hi[int(cn0 - n0):int(cn1 - n0), int(cx0 - x0):int(cx1 - x0)]
gy, gx = np.gradient(sub)
shade = np.clip(0.5 + (-gx * 0.7 + gy * 0.7) * 1.5, 0, 1)[::-1]
img = Image.fromarray((shade * 200 + 40).astype(np.uint8)).convert("RGB").resize((2600 // 1, 2600 // 1))
d = ImageDraw.Draw(img)
t = Transformer.from_crs(4326, 26913, always_xy=True)
osm = json.load(open(RAW / "osm.json"))
nodes = {e["id"]: e for e in osm["elements"] if e["type"] == "node"}
col = {"novice": (0, 160, 0), "easy": (0, 160, 0), "intermediate": (0, 60, 255), "advanced": (0, 0, 0), "expert": (200, 0, 0)}
def P(nid):
    nd = nodes[nid]; e, n = t.transform(nd["lon"], nd["lat"])
    return (e - ORIGIN_E - cx0, (cn1 - (n - ORIGIN_N)))
try:
    font = ImageFont.truetype("/System/Library/Fonts/Helvetica.ttc", 18)
except Exception:
    font = None
for w in osm["elements"]:
    if w["type"] != "way": continue
    tg = w.get("tags", {})
    if tg.get("piste:type") in ("downhill", "hike") or "aerialway" in tg:
        pts = [P(n) for n in w["nodes"]]
        c = (220, 0, 120) if "aerialway" in tg else col.get(tg.get("piste:difficulty"), (128, 128, 0))
        d.line(pts, fill=c, width=4 if "aerialway" in tg else 3)
        m = pts[len(pts) // 2]
        d.text((m[0] + 4, m[1]), f"{w['id'] % 100000}:{tg.get('name','?')}", fill=c, font=font)
img.save(PROC / "osm_debug.png")
print("saved")
