# Progress

## Status
Session 1 (Claude Code): project bootstrapped. Data download in progress.

## Done
- Repo scaffold, AGENTS.md, CLAUDE.md, DECISIONS.md, package.json, tsconfig.
- Python venv (`uv venv --python 3.12 .venv`; packages in `pipeline/requirements.txt`).
- `pipeline/fetch_osm.py` (Overpass), `pipeline/fetch_usgs.py` (1 m DEM + LAZ), `pipeline/fetch_regional.py` (8 m and 32 m grids).

## In progress
- Terrain tile pyramid builder.

## Next steps
1. Build terrain pyramid (`pipeline/build_terrain.py`).
2. Client terrain renderer.

## Known bugs
- none yet
