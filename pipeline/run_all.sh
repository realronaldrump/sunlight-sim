#!/usr/bin/env bash
# Rebuild every game asset from raw public data. Safe to rerun: downloads are cached in data/raw/.
# Requires: Python 3.12 venv at .venv with pipeline/requirements.txt (see README.md).
set -euo pipefail
cd "$(dirname "$0")"
PY=../.venv/bin/python
if [ ! -x "$PY" ]; then
  echo "Creating Python venv (.venv) ..."
  (cd .. && (command -v uv >/dev/null && uv venv --python 3.12 .venv || python3 -m venv .venv))
  (cd .. && (command -v uv >/dev/null && uv pip install --python .venv/bin/python -r pipeline/requirements.txt || .venv/bin/pip install -r pipeline/requirements.txt))
fi
echo "== 1. OpenStreetMap (Overpass)";            $PY fetch_osm.py
echo "== 2. USGS 1 m DEM tiles (TNM)";            $PY fetch_usgs.py dem
echo "== 3. Regional/far elevation (3DEP)";      $PY fetch_regional.py
echo "== 4. Lidar point cloud (USGS EPT on AWS)"; $PY fetch_ept.py
echo "== 5. NAIP imagery (Planetary Computer)";  $PY fetch_naip.py
echo "== 6. Terrain tile pyramid";               $PY build_terrain.py
echo "== Mount Sopris 1 m elevation detail";       $PY build_sopris.py
echo "== 7. Runs, lifts, buildings";             $PY build_osm.py
echo "== 8. Canopy height model";                $PY build_chm.py
$PY build_structures.py
echo "== 9. Trees + species";                    $PY build_trees.py
echo "== 10. Surface masks + run boundaries";    $PY build_surface.py
echo "== 11. Trail map + boundary";              $PY build_map.py
$PY build_trail_board.py
echo "== 12. Base area roads/parking";           $PY build_base.py
echo "== 13. Distant forest cover (WorldCover)"; $PY build_landcover.py
echo "== 14. Accuracy report";                   $PY accuracy.py
echo "== Snow surface materials (CC0)";           $PY build_snow.py
echo "== Audio textures and Foley (CC0)";         $PY build_audio.py
echo "== 15. Self-tests";                        $PY test_pipeline.py
(cd .. && npm run data:skier && npm run data:crowd)
echo "Done. Assets are in client/public/world/"
