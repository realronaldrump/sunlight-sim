# Progress

## Status (session 1, Claude Code)
Core game is playable: real terrain, lidar trees, runs, lifts with riding, ski physics, HUD, trail map, slope overlay, camera modes, multiplayer rooms with chat. Remaining work is listed under Next steps.

## How to run
- `npm install && npm run dev` then open http://localhost:5173 (client) ; multiplayer server on :8787.
- Data pipeline (needs Python venv): `npm run data` (see pipeline/run_all.sh). Processed world assets are committed in client/public/world so the pipeline is only needed to regenerate.
- Tests: `npm test` (vitest unit), `npx playwright test` (e2e: viewpoints screenshots, multiplayer).
- Physics harness: `npx tsx tests/harness/runBots.ts [run names]`.

## Done
- Data: OSM (Overpass), USGS 3DEP 1 m DEM (CO_Central_Western_2016), 3DEP 1/3 arc-second regional (8 m grid, 32 km) and far (32 m grid, 131 km), lidar point cloud (EPT on AWS, 104 M points), NAIP 2023 (in progress / optional).
- Terrain pyramid L0 (1 m) to L8; quadtree chunk LOD renderer with skirts and earth curvature; TSL snow material (groomed corduroy, moguls, sparkle, slope overlay, forest shading).
- Canopy height model, 244k trees detected with species (spruce/fir, Douglas-fir, aspen, Gambel oak), instanced near meshes + far impostors, tree collisions.
- Runs: all 75 official trail map names present (OSM geometry, official names/difficulty; unnamed OSM ways matched by location). Run boundaries from lidar tree gaps. Surface masks: groomed, piste, canopy, moguls. Run signs at entrances. Ski area boundary poles.
- Lifts: Primo (quad), Segundo (triple), Tercero (triple) at OSM positions with OSM pylons, cable sag, computed tower heights, bull wheels, huts, moving chairs on a shared clock, load/unload, ride in real time, skip with F.
- Ski physics (shared/skiPhysics.ts) + bot harness; beginner 15-21 km/h avg on greens/blues.
- Procedural rigged skier with IK and poses (turning, wedge, tuck, fall, get up, sitting).
- HUD (speed, slope, altitude, run name), help panel, trail map overlay (click run to teleport), slope overlay (O), chase/first/side cameras (C).
- Multiplayer: ws server with rooms, start menu (name, jacket colour, room), invite link, interpolation, shared chairs, chat, players on map. e2e test passes.
- Quality presets with auto-detect.

## Visual reviews
- Review 1 (screenshots/01..07): Sopris correctly placed and recognizable from the summit; trail map works. Problems: conifers look like pale paper cones (too much snow, flat layers); distant mountains lack forest darkening; sun halo oversized; slope overlay too faint; lift huts float on slopes. Fixed so far: sky params, overlay strength, mid-distance canopy shading, impostor coverage, hut placement. Still to fix: conifer model, far landcover forest.
- Review 2 (08 multiplayer chair): two skiers seated on one chair, correct.

## Next steps
1. Audio (wind, ski-on-snow groomed/powder/carve/skid, lift hum, chair creak) with CC0 or synthesized sounds.
2. Buildings: base lodge, ticket area, patrol shack, Brettelberg condos, parking lot (from OSM footprints + NAIP).
3. Better conifer model (branch cards with needle texture), far landcover forest from ESA WorldCover.
4. Unit tests (pipeline codec, physics, lifts, rooms). `pipeline/run_all.sh`.
5. ACCURACY.md (run lengths, vertical, slopes vs DEM and published figures), README.md, CREDITS.md.
6. Performance profiling against 60 fps at 1440p on High.
7. Deploy client to Vercel (CLI is logged in) and document server deploy (Fly.io/Render).

## Known bugs
- Run label shows while riding a lift (cosmetic).
- NAIP fetch is slow; tree species currently from heuristics if naip_1m.tif is missing.
