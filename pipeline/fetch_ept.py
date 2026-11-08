"""Fetch USGS 3DEP lidar (CO_Central_Western_2016) for the resort area from the public Entwine Point
Tile (EPT) copy on AWS (s3://usgs-lidar-public, no key). Downloads every octree node that intersects
the lidar bbox at every depth (the union is the full-density point cloud)."""
import json, sys, time, concurrent.futures as cf
import requests
from pyproj import Transformer
from config import RAW, LIDAR_BBOX

BASE = "https://s3-us-west-2.amazonaws.com/usgs-lidar-public/USGS_LPC_CO_Central_Western_2016_LAS_2018"
OUT = RAW / "ept"
S = requests.Session()


def get(url, binary=False):
    for a in range(8):
        try:
            r = S.get(url, timeout=120)
            r.raise_for_status()
            return r.content if binary else r.json()
        except Exception as e:
            print("retry", url, e, file=sys.stderr); time.sleep(2 * (a + 1))
    raise RuntimeError(url)


def main():
    OUT.mkdir(parents=True, exist_ok=True)
    meta = get(f"{BASE}/ept.json")
    (OUT / "ept.json").write_text(json.dumps(meta))
    b = meta["bounds"]
    t = Transformer.from_crs(4326, 3857, always_xy=True)
    x0, y0 = t.transform(LIDAR_BBOX[0], LIDAR_BBOX[1])
    x1, y1 = t.transform(LIDAR_BBOX[2], LIDAR_BBOX[3])
    size = b[3] - b[0]

    def intersects(d, x, y):
        s = size / 2 ** d
        nx0, ny0 = b[0] + x * s, b[1] + y * s
        return not (nx0 > x1 or nx0 + s < x0 or ny0 > y1 or ny0 + s < y0)

    keys = []
    def walk(hier, root):
        # breadth over keys in this hierarchy file
        todo = [root]
        while todo:
            k = todo.pop()
            if k not in hier:
                continue
            d, x, y, z = map(int, k.split("-"))
            if not intersects(d, x, y):
                continue
            cnt = hier[k]
            if cnt == -1:
                sub = get(f"{BASE}/ept-hierarchy/{k}.json")
                walk(sub, k)
                continue
            if cnt > 0:
                keys.append(k)
            for dx in (0, 1):
                for dy in (0, 1):
                    for dz in (0, 1):
                        todo.append(f"{d+1}-{2*x+dx}-{2*y+dy}-{2*z+dz}")
    walk(get(f"{BASE}/ept-hierarchy/0-0-0-0.json"), "0-0-0-0")
    print(f"{len(keys)} nodes intersect", flush=True)
    (OUT / "nodes.json").write_text(json.dumps(keys))

    def dl(k):
        p = OUT / f"{k}.laz"
        if p.exists() and p.stat().st_size > 0:
            return 0
        data = get(f"{BASE}/ept-data/{k}.laz", binary=True)
        p.write_bytes(data)
        return len(data)
    total = 0
    with cf.ThreadPoolExecutor(16) as ex:
        for i, n in enumerate(ex.map(dl, keys)):
            total += n
            if i % 50 == 0:
                print(f"{i}/{len(keys)} {total/1e6:.0f} MB", flush=True)
    print("done", total / 1e6, "MB")


if __name__ == "__main__":
    main()
