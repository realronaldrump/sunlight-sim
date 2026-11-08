"""Download USGS 3DEP 1 m DEM tiles and lidar LAZ tiles covering the resort (TNM Access API, no key)."""
import json, sys, pathlib, requests, concurrent.futures as cf
from config import RAW, LIDAR_BBOX

TNM = "https://tnmaccess.nationalmap.gov/api/v1/products"

def query(dataset, bbox, max_items=500):
    r = requests.get(TNM, params={"datasets": dataset, "bbox": ",".join(map(str, bbox)),
                                   "outputFormat": "JSON", "max": max_items}, timeout=120)
    r.raise_for_status()
    return r.json()["items"]

def download(url, dest: pathlib.Path):
    if dest.exists() and dest.stat().st_size > 0:
        return dest, "cached"
    tmp = dest.with_suffix(dest.suffix + ".part")
    with requests.get(url, stream=True, timeout=600) as r:
        r.raise_for_status()
        with open(tmp, "wb") as f:
            for chunk in r.iter_content(1 << 20):
                f.write(chunk)
    tmp.rename(dest)
    return dest, "downloaded"

def main():
    what = sys.argv[1:] or ["dem", "lidar"]
    jobs = []
    if "dem" in what:
        d = RAW / "dem1m"; d.mkdir(parents=True, exist_ok=True)
        items = query("Digital Elevation Model (DEM) 1 meter", (-107.37, 39.37, -107.31, 39.41))
        for it in items:
            if "y437" in it["downloadURL"] and ("Central_Western_2016" in it["downloadURL"] or "SanLuisJuanMiguel_2020" in it["downloadURL"]):
                jobs.append((it["downloadURL"], d / it["downloadURL"].split("/")[-1]))
    if "lidar" in what:
        d = RAW / "laz"; d.mkdir(parents=True, exist_ok=True)
        items = query("Lidar Point Cloud (LPC)", LIDAR_BBOX)
        for it in items:
            if "CO_Central_and_WesternCO_2016" in it["downloadURL"]:
                jobs.append((it["downloadURL"], d / it["downloadURL"].split("/")[-1]))
    print(f"{len(jobs)} files to fetch")
    (RAW / "usgs_manifest.json").write_text(json.dumps([j[0] for j in jobs], indent=1))
    with cf.ThreadPoolExecutor(6) as ex:
        for dest, status in ex.map(lambda j: download(*j), jobs):
            print(status, dest.name, flush=True)

if __name__ == "__main__":
    main()
