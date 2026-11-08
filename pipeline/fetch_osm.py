"""Fetch OpenStreetMap ski data around Sunlight Mountain Resort via Overpass API."""
import json, sys, time, pathlib, requests

OUT = pathlib.Path(__file__).resolve().parent.parent / "data" / "raw" / "osm.json"
# Generous bbox (S, W, N, E) around Sunlight Mountain Resort, Glenwood Springs, CO
BBOX = (39.36, -107.39, 39.43, -107.30)
Q = f"""
[out:json][timeout:120];
(
  way["piste:type"]({BBOX[0]},{BBOX[1]},{BBOX[2]},{BBOX[3]});
  relation["piste:type"]({BBOX[0]},{BBOX[1]},{BBOX[2]},{BBOX[3]});
  way["aerialway"]({BBOX[0]},{BBOX[1]},{BBOX[2]},{BBOX[3]});
  node["aerialway"]({BBOX[0]},{BBOX[1]},{BBOX[2]},{BBOX[3]});
  way["landuse"="winter_sports"]({BBOX[0]},{BBOX[1]},{BBOX[2]},{BBOX[3]});
  relation["landuse"="winter_sports"]({BBOX[0]},{BBOX[1]},{BBOX[2]},{BBOX[3]});
  way["building"]({BBOX[0]},{BBOX[1]},{BBOX[2]},{BBOX[3]});
  way["highway"]({BBOX[0]},{BBOX[1]},{BBOX[2]},{BBOX[3]});
  way["amenity"="parking"]({BBOX[0]},{BBOX[1]},{BBOX[2]},{BBOX[3]});
  node["natural"="peak"](39.0,-107.9,39.8,-106.8);
);
(._;>;);
out body;
"""
ENDPOINTS = [
    "https://overpass-api.de/api/interpreter",
    "https://overpass.kumi.systems/api/interpreter",
    "https://overpass.private.coffee/api/interpreter",
]

def main():
    OUT.parent.mkdir(parents=True, exist_ok=True)
    last = None
    for ep in ENDPOINTS:
        try:
            r = requests.post(ep, data={"data": Q}, timeout=180,
                              headers={"User-Agent": "sunlight-sim-pipeline/1.0"})
            r.raise_for_status()
            data = r.json()
            OUT.write_text(json.dumps(data))
            print(f"OSM: {len(data['elements'])} elements from {ep}")
            return
        except Exception as e:  # try next mirror
            last = e
            print(f"Overpass {ep} failed: {e}", file=sys.stderr)
            time.sleep(2)
    raise SystemExit(f"All Overpass endpoints failed: {last}")

if __name__ == "__main__":
    main()
