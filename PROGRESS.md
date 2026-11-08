# Progress

## Status (end of session 1 work so far, Claude Code)
All Definition of Done items are implemented and verified except where noted below. Now in the "keep improving realism" phase.
Live client (solo): https://sunlight-sim.vercel.app (multiplayer server not hosted: no Fly/Render credentials; see README).

## Definition of Done checklist
1. `npm install && npm run dev` starts client (5173) and multiplayer server (8787); the page loads Sunlight. VERIFIED (Playwright webServer uses exactly `npm run dev`).
2. Terrain from real 1 m lidar DEM over the resort + ~1 km margin, 8 m regional (32 km) and 32 m far (131 km) terrain to the horizon. VERIFIED (screenshots 03, 04; unit tests terrain.test.ts).
3. All 75 official run names with official difficulty, lidar-derived boundaries, signs at entrances. VERIFIED (resort.test.ts, screenshots 04, trail map 07).
4. Primo, Segundo, Tercero at OSM positions with OSM towers, stations, moving chairs, working ride. VERIFIED (lifts.test.ts, gameplay.spec.ts rides Tercero, multiplayer.spec.ts rides Segundo).
5. 244k trees from the lidar canopy model, species from NAIP 2023 fall imagery (k-means), collisions. VERIFIED (gameplay.spec.ts falls into a tree; resort.test.ts species counts).
6. Ski physics harness passes (tests/harness/runBots.ts; physics.test.ts): beginner 15 to 21 km/h on greens/blues.
7. Two clients join one room by link, ski, ride one chair, see each other on the map, chat. VERIFIED (tests/e2e/multiplayer.spec.ts).
8. Map overlay, slope overlay, first/third/side cameras, quality presets, audio (WebAudio, synthesized) work. VERIFIED (gameplay.spec.ts checks audio context running and wind gain while moving).
9. Performance on High at 2560x1440: 60 fps vsync-capped in all scenes; uncapped 147 to 188 fps (6.7 ms/frame, CPU ~6.3 ms) on an M3 Pro. Estimated base M1 (about 2.5x less GPU): ~60 to 75 fps. Measured by tests/e2e/performance.spec.ts. Not measured on real M1 hardware (none available).
10. README.md, CREDITS.md, ACCURACY.md, DECISIONS.md complete.
11. Final visual review pass: done (review 4 below). Continue reviewing after every visual change.

## How to run / test
- `npm install && npm run dev`, open http://localhost:5173.
- `npm test` (30 unit tests), `npm run test:pipeline`, `npx playwright test` (viewpoints, gameplay, multiplayer, performance; needs `npm run dev` free ports or reuses a running dev server).
- Physics harness: `npx tsx tests/harness/runBots.ts Midway "Sun King"`.
- Data pipeline: `npm run data` (pipeline/run_all.sh). Raw data in data/raw (gitignored, ~4 GB). Processed world assets committed in client/public/world (~65 MB).
- Accuracy: `npx tsx tests/harness/accuracy.ts && .venv/bin/python pipeline/accuracy.py`.

## Visual reviews
- Review 1 (01..07): Sopris placement correct; trail map works. Problems: paper-cone conifers, white distant mountains, big sun halo, faint slope overlay, floating huts. All fixed in later commits.
- Review 2 (08): two players seated on one chair, correct.
- Review 3 (after branch-card conifers, WorldCover): conifers read as snowy spruce; distant ranges show forest with snowy openings under haze; aspens were feather-like (fixed: branches built in normalized radius space) and too white (darkened).
- Review 4 (01..14, final pass): base area with buildings, parking and plowed roads; lift terminals with bull wheel hoods; signs now two-post; Gambel oak thickets replace balloon shapes; trail map now oriented like the official map (view from the base, toggle to north-up); snowfall and late-afternoon light look right; side camera avoids buildings.

## Next steps (realism improvements, in priority order)
1. Moguls as real geometry on mogul runs (shared height function used by the renderer and physics).
2. Patrol HQ at the summit (red cross on the trail map), ticket booth, unload ramps at top terminals.
3. Skier model polish (proportions, jacket shape, ski boots), pole plants in turns.
4. Snow surface micro detail: wind ripples, ski tracks on groomed runs, tree wells.
5. Mid-distance tree shadows / ambient occlusion under the canopy.
6. Host the multiplayer server when credentials become available (Fly.io config in hosting/).

## Known bugs / limitations
- Tree species are a k-means split of fall NAIP colours (74% deciduous); no ground truth. Aspen share may be overestimated.
- OSM centerlines sometimes cross road-cut banks of the summer DEM (bare earth has no snow fill), giving short steep lips.
- The headless test browser caps at 60 fps; uncapped numbers come from a separate run with --disable-gpu-vsync.
