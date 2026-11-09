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


def test_sopris_source_and_detail():
    idx = json.loads((PUBLIC / "terrain" / "index.json").read_text())
    regions = [r for r in idx.get("detailRegions", []) if r["name"] == "Mount Sopris"]
    assert {r["maxLevel"] for r in regions} == {2, 3, 4}
    manifest = json.loads((PUBLIC / "terrain" / "sopris.json").read_text())
    assert manifest["sourceResolutionM"] == 1
    assert len(manifest["summits"]) == 2
    for level in ("2", "3"):
        assert manifest["coverage"][level]["missingSourceSamples"] == 0


def test_reference_structures():
    resort = json.loads((PUBLIC / "resort.json").read_text())
    lodges = [b for b in resort["buildings"] if b.get("style") == "sunlight_lodge"]
    assert len(lodges) == 1, "The main lodge must be present once, including after a pipeline rerun"
    lodge = lodges[0]
    assert 2492.9 < lodge["roofElevation"] < 2493.2, lodge["roofElevation"]
    assert all(90 < x < 135 and -985 < z < -935 for x, z in lodge["points"])
    condos = [b for b in resort["buildings"] if b.get("style") == "brettelberg"]
    assert len(condos) == 1 and condos[0]["id"] == 789090241
    measured = [b for b in resort["buildings"] if b.get("heightSource")]
    assert len(measured) >= 12, "generic buildings take eave/ridge heights from lidar"
    for b in measured:
        assert b["grade"][0] - 1 < b["eave"] <= b["roofTop"] < b["grade"][1] + 16, b
        assert b["roofForm"] in ("pitched", "flat")


if __name__ == "__main__":
    for name, fn in list(globals().items()):
        if name.startswith("test_"):
            fn(); print("ok", name)
