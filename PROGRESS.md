# Progress

## Minimap session (Codex, November 8, 2026)
- Owner requested a minimap usable while skiing, implementation plus deployment, and explicit documentation following this repo's conventions.
- Work is isolated on `codex/skiing-minimap` in a managed worktree based on `1efa79e`. The original checkout has active, unfinished character work and two failing draft skier-model tests. Those changes are preserved and are not part of this feature or its deployment.
- Implemented a north-up minimap in the upper left using the existing hillshade and run data. It follows the player during skiing and chairlift rides, highlights the current run, labels nearby runs/lifts, shows friends, and keeps a cyan heading marker centered.
- Added three zoom levels, a scale bar, north arrow, persistent run/lift heading, saved zoom/visibility, V to collapse/restore, and a Full map button. The full map retains its independent controls. Static map data is cached and dynamic painting runs at 12 Hz; hidden/collapsed maps do not repaint.
- Added geometry tests and browser coverage for movement, heading convention, lift riding, zoom limits, persistence, full-map access, short windows, missing hillshade, corrupt settings and multiplayer map presence. `E2E_BASE_URL` supports testing an isolated server or a deployed build.
- Verification: clean baseline build, 30 baseline unit tests and all 3 pipeline checks passed. Feature build and all 35 unit tests passed. All 10 Chromium/WebKit browser scenarios passed, including gameplay, multiplayer, viewpoints and performance. After compact-control polish, all 5 affected minimap/multiplayer scenarios passed again, including chat typing without accidentally toggling the minimap.
- Visual review: inspected `screenshots/minimap_skiing_chromium.png`, `screenshots/minimap_compact_chromium.png` and the lift screenshots. Player/terrain positions and nearby Midway labels are readable, north stays up, and the map clears the skier and speed HUD. Compact controls now stay on one line, including at 800x480; the compact legend is omitted to preserve space. Base-area context is distinct from off-piste context.
- High preset at 2560x1440 with the minimap enabled: 60.0 to 60.2 fps across base, Sun King, Sopris view and east-ridge forest on this machine. Measurements are in `tests/harness/out/perf.json`; these are not new M1 hardware measurements.
- Release reconciliation: production advanced to the U.S. units release (`8ea628a` / deployment `dpl_xByfiq7MbmMZ96bnqZBF5knvs8Qb`) during implementation, and committed snow improvements are now on master. Merge those committed changes, align the minimap display with the units helpers, and reverify the combined revision before deployment. Preserve uncommitted character work.
- Next: reconcile committed work as above, verify production, and record the URL and revision here. Resume the separate realism priorities below after this bounded task.

## Status (session 2, Codex, in progress)
Core systems are implemented and the session-start build, 30 unit tests, 3 pipeline checks, and 6 browser scenarios pass. Visual fidelity is still in progress. The owner explicitly prioritized realism and detail over FPS on November 8, 2026. Do not treat the earlier completed checklist as proof of polished or accurate art.
Live client (solo): https://sunlight-sim.vercel.app (multiplayer server not hosted: no Fly/Render credentials; see README).

## Owner's current priorities
- Realistic human skiers, with anatomical proportions, articulated bodies, believable clothing and ski equipment. Replace the capsule/blob appearance. Freely licensed internet assets and custom models are both authorized.
- Realism across the entire experience, including loading, sitting on a chair, riding, and unloading.
- Sunlight's actual buildings and terminals, based on references and footprints. Repeated generic windows and placeholder boxes are not an acceptable final result.
- Prioritize visual accuracy and polish over FPS optimization in this phase.

## Session 2 verification and findings
- `npm run build`, `npm test`, `npm run test:pipeline`, and `npx playwright test`: all passed at the starting commit `16ebdec`.
- Fresh 1440p High measurements were 51 to 59 fps on this M3 Pro, lower than the earlier recorded results. FPS work is deferred by owner instruction.
- Reviewed base, Sun King, multiplayer chair and ambient skier screenshots. Terrain layout works, but characters are visibly assembled from primitive shapes, buildings have repetitive generic facades, and trees are too uniformly pale/striped.
- Reviewed official Sunlight winter photos from https://sunlightmtn.com/ for comparison. Cached references remain in gitignored `data/raw/reference/`.
- Found and downloaded a CC0 MakeHuman/MPFB anatomical human with a 53-bone rig, repackaged by Innerscene: https://www.innerscene.com/tools/library/3d-parts/human-base-mesh-with-editable-53-bone-rig-8e7c8ab1. Source is in `data/raw/characters/`; no character asset is shipped yet.
- An uncommitted `tests/unit/skierModel.test.ts` was started for a skinned-character replacement and currently fails until that replacement is implemented. Do not confuse it with a pre-existing failure.

## Definition of Done checklist
1. `npm install && npm run dev` starts client (5173) and multiplayer server (8787); the page loads Sunlight. VERIFIED (Playwright webServer uses exactly `npm run dev`).
2. Terrain from real 1 m lidar DEM over the resort + ~1 km margin, 8 m regional (32 km) and 32 m far (131 km) terrain to the horizon. VERIFIED (screenshots 03, 04; unit tests terrain.test.ts).
3. All 75 official run names with official difficulty, lidar-derived boundaries, signs at entrances. VERIFIED (resort.test.ts, screenshots 04, trail map 07).
4. Primo, Segundo, Tercero at OSM positions with OSM towers, stations, moving chairs, working ride. VERIFIED (lifts.test.ts, gameplay.spec.ts rides Tercero, multiplayer.spec.ts rides Segundo).
5. 244k trees from the lidar canopy model, species from NAIP 2023 fall imagery (k-means), collisions. VERIFIED (gameplay.spec.ts falls into a tree; resort.test.ts species counts).
6. Ski physics harness passes (tests/harness/runBots.ts; physics.test.ts): beginner 15 to 21 km/h on greens/blues.
7. Two clients join one room by link, ski, ride one chair, see each other on the map, chat. VERIFIED (tests/e2e/multiplayer.spec.ts).
8. Map overlay, slope overlay, first/third/side cameras, quality presets, audio (WebAudio, synthesized) work. VERIFIED (gameplay.spec.ts checks audio context running and wind gain while moving).
9. Performance on High at 2560x1440: 60 fps vsync-capped in all scenes; uncapped 147 to 176 fps (about 6 ms/frame) on an M3 Pro after merging static geometry (draw calls ~1100 to 1300). Estimated base M1 (about 2.5x less GPU): ~60 to 75 fps. Measured by tests/e2e/performance.spec.ts (uncapped: tests/scratch config with --disable-gpu-vsync). Not measured on real M1 hardware (none available).
   Load: production site ready in 2.3 s with 8 MB downloaded; 12.9 MB once every tree tile has streamed in (well under 30 s on a typical connection).
10. README.md, CREDITS.md, ACCURACY.md, DECISIONS.md complete.
11. Final visual review pass: done (review 4 below). Continue reviewing after every visual change.

## Browser coverage
- Chromium (WebGPU and forced WebGL2 via `?webgl=1`) and WebKit (Safari engine, WebGPU) verified by tests/e2e/smoke.spec.ts and probes: 60 fps, no console errors. Windows Chrome not tested (no Windows machine); it uses the same Chromium code path.

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
- Review 5 (15..21): moguls visible on Segundo; snow close-up without moire; skier turn shows straight corduroy and tracks; start menu and first-person view correct.
- Review 4 (01..14, final pass): base area with buildings, parking and plowed roads; lift terminals with bull wheel hoods; signs now two-post; Gambel oak thickets replace balloon shapes; trail map now oriented like the official map (view from the base, toggle to north-up); snowfall and late-afternoon light look right; side camera avoids buildings.

## Improvements done after Definition of Done
- Real mogul geometry baked into 1 m/2 m tiles (render and physics agree); airtime off crests; compression falls.
- Ski patrol HQ at the summit, ticket booth at the base, lift huts with windows/doors and footings, bull wheel hoods.
- Skier polish (shoulders, collar, boots, pole baskets, pole plants at edge changes).
- Snow micro relief (wind ripples, grain, anti-aliased corduroy following a smoothed fall line), finer sparkles, ski tracks.
- Weather (light snowfall) and time-of-day slider in the options panel (P).
- HUD: run average and steepest pitch on entry; arrow and distance to the nearest lift load line.
- Draw calls cut ~35% by merging static geometry.
- Click a friend on the trail map to join them; ambient riders on a third of the chairs; 8 ambient AI skiers (client/src/world/ambient.ts, `?ambient=0` disables).
- Slope overlay partly self-lit so colours stay legible; rock exposure on steep distant peaks; WebKit + WebGL2 verified.

## Next steps (realism improvements, in priority order)
0. Replace primitive skiers with detailed human models and ski gear; review close-up skiing, wedge, tuck, fall, recovery, seated and multiplayer poses. Current work is in this step.
1. Research and model Sunlight's recognizable base lodge and lift buildings using exact footprints and photo evidence. Distinguish measured dimensions from visual estimates in DECISIONS.md.
2. Review lift seats, restraint bars, terminal machinery, load lines and unload paths at human scale. Prevent ambient riders from overlapping player seats.
3. Improve tree shapes, tree wells, wind-scoured ridge shading, and canopy occlusion without altering measured terrain elevations.
4. Repeat required viewpoints and relevant gameplay tests, update CREDITS.md/ACCURACY.md, then deploy with the existing Vercel project credentials. The live site still predates ambient skiers/riders.
5. Host the multiplayer server only if deployment credentials are available (Fly.io config in hosting/); otherwise retain exact deploy instructions.

"Join friend" map travel is already implemented and passed the multiplayer browser scenario again in session 2.

## Known bugs / limitations
- Tree species are a k-means split of fall NAIP colours (74% deciduous); no ground truth. Aspen share may be overestimated.
- OSM centerlines sometimes cross road-cut banks of the summer DEM (bare earth has no snow fill), giving short steep lips.
- The headless test browser caps at 60 fps; uncapped numbers come from a separate run with --disable-gpu-vsync.
