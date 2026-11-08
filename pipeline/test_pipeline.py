"""Pipeline self-tests (run: .venv/bin/python pipeline/test_pipeline.py)."""
import json, sys
import numpy as np
sys.path.insert(0, __import__("os").path.dirname(__file__))
from terrain_codec import encode, decode
from config import PUBLIC


def test_codec_roundtrip():
    rng = np.random.default_rng(0)
    h = (2500 + np.cumsum(np.cumsum(rng.normal(0, 0.3, (32, 32)), 0), 1)).astype(np.float32)
    d = decode(encode(h, 0.01))
    assert np.abs(d - h).max() <= 0.006, np.abs(d - h).max()


def test_resort_json():
    r = json.loads((PUBLIC / "resort.json").read_text())
    assert len(r["lifts"]) == 3
    names = {x["name"] for x in r["runs"]}
    assert len(names) == 75, len(names)
    assert r["missingOfficialRuns"] == []


def test_terrain_index():
    idx = json.loads((PUBLIC / "terrain" / "index.json").read_text())
    assert idx["tileSamples"] == 259 and idx["maxLevel"] == 8
    assert len(idx["levels"]["0"]["tiles"]) == 289


if __name__ == "__main__":
    for name, fn in list(globals().items()):
        if name.startswith("test_"):
            fn(); print("ok", name)
