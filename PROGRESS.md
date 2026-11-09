# Progress

## Lift mechanics audit (November 8, 2026, in progress)
- Owner requested verification of boarding/riding, accurate Sunlight timing/physics, documentation and deployment.
- Starting production build, 30 existing unit tests, 3 pipeline checks and 6 browser scenarios passed. Two then-untracked skier-rendering tests initially failed during concurrent character implementation; those now pass with that implementation. Preserve other chats' character/building/snow/interface work.
- Reproduced estimated-speed mismatch and incorrect ride-time endpoints with failing tests before changing shared lift timing. Published specs and uncertainty are documented in D15. Updated all three speeds and installed chair counts in the rerunnable pipeline and resort data.
- Added physical/rendered snow loading pads and exit ramps, shared seat transforms, actual swept chair pickup, upright/slow/uphill eligibility, same-lane unloading at chair speed, suspension recovery and cable-distance countdowns.
- Server now validates the skier as well as the chair, assigns distinct seats, rejects full/invalid requests without losing reservations, and releases seats at the unload line. Removed optimistic boarding and prevented ambient riders overlapping player chairs.
- Current working-tree validation: 53 unit tests and production build passed. New tests simulate complete real-time rides on all three lifts, slow frames, a full-loop suspension, snow-grid consistency, bad boarding requests, full-chair behavior, shared seat coordinates and natural unloading. No live deploy has been made for this lift change yet.
- Next: browser boarding/riding/unloading and close-up visual review on each lift, regenerate ACCURACY.md from the shared path, finish release validation, deploy, verify the public alias, and record the result here.

## U.S. units update (November 8, 2026)
- Owner requested U.S. units throughout the game and deployment when complete.
- Updated the HUD to mph and feet, and both lift guidance and trail-map run lengths to feet or miles. Shared display helpers use exact conversions and U.S. number formatting; simulation and world data remain in SI units. See D14.
- Starting working-tree validation: production build, all 32 unit tests, and all 3 pipeline checks passed.
- Existing uncommitted character-model and pipeline work is present in the checkout. The units release was packaged from committed source; ongoing art work was preserved in the working tree.
- Release commit `8ea628a`: production build and all 30 committed unit tests passed. All 6 browser scenarios passed, including gameplay, multiplayer, viewpoints, performance, and Chromium/WebKit smoke checks.
- Verified the built client and production site in a browser using a German locale: speed is correctly converted to mph, elevation to feet with U.S. separators, and near/far lift guidance to feet/miles. Checked real map tooltips for Grizzly Road (1.6 mi) and Zephyr (2,159 ft). No browser errors.
- Visual review: HUD and both tooltip formats are readable without clipping. Local and production screenshots are saved as `screenshots/units-{local,live}-{hud,map-feet,map-miles}.png` (gitignored).
- Deployed to https://sunlight-sim.vercel.app. Vercel deployment `dpl_xByfiq7MbmMZ96bnqZBF5knvs8Qb` is READY in production, with the public alias verified. This request is complete; the realism work below remains separate.

## Status (session 2, Codex, in progress)
Core systems are implemented and the session-start build, 30 unit tests, 3 pipeline checks, and 6 browser scenarios pass. Visual fidelity is still in progress. The owner explicitly prioritized realism and detail over FPS on November 8, 2026. Do not treat the earlier completed checklist as proof of polished or accurate art.
Live client (solo): https://sunlight-sim.vercel.app (multiplayer server not hosted: no Fly/Render credentials; see README).

## Owner's current priorities
- Realistic human skiers, with anatomical proportions, articulated bodies, believable clothing and ski equipment. Replace the capsule/blob appearance. Freely licensed internet assets and custom models are both authorized.
- Realism across the entire experience, including loading, sitting on a chair, riding, and unloading.
- Sunlight's actual buildings and terminals, based on references and footprints. Repeated generic windows and placeholder boxes are not an acceptable final result.
- Prioritize visual accuracy and polish over FPS optimization in this phase.

## Session 2 verification and findings
- Character implementation checkpoint: anatomical player/friend/ambient models, ski equipment, slope alignment and seated instancing are ready for commit. Combined working-tree production build and 53 unit tests pass. Concurrent lift/tree refinements and the new building models remain in progress; run the final browser scenarios again after those changes settle.
- `npm run build`, `npm test`, `npm run test:pipeline`, and `npx playwright test`: all passed at the starting commit `16ebdec`.
- Fresh 1440p High measurements were 51 to 59 fps on this M3 Pro, lower than the earlier recorded results. FPS work is deferred by owner instruction.
- Reviewed base, Sun King, multiplayer chair and ambient skier screenshots. Terrain layout works, but characters are visibly assembled from primitive shapes, buildings have repetitive generic facades, and trees are too uniformly pale/striped.
- Reviewed official Sunlight winter photos from https://sunlightmtn.com/ for comparison. Cached references remain in gitignored `data/raw/reference/`.
- Replaced capsule characters with a CC0 MakeHuman/MPFB anatomical human and 53-bone rig, repackaged by Innerscene. Added fitted winter clothing, articulated fingers, helmet/goggles, buckled boots, shaped skis, bindings and poles. The 1.9 MB derived asset and license ship under `client/public/models/`; rebuild with `npm run data:skier`.
- Character regression tests pass: real skinned topology, no capsule limbs, finite standing/carving/wedge/tuck/fall/seated poses, and sub-millimeter attachment after translation to mountain coordinates. Gameplay, two-client multiplayer and Chromium/WebKit smoke scenarios passed with the new body. Terrain alignment and final gear refinements are being checked with the current combined tree.
- Close-up visual review 6 (`27` through `32`): face and proportions now read as human; corrected open hands, hard seams, reversed ski/goggle faces, helmet/goggle intersections and boot alignment when seated. These are original renders, not generated mockups.
- Found the main lodge was missing from OSM imports. A 2023 NAIP roof trace is now in `pipeline/build_structures.py`; custom lodge and Brettelberg models are in progress and have a first visual review (`33` through `36`). Heights, window modules and deck dimensions are photo estimates. Continue refining before claiming accurate replicas.

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
4. Repeat required viewpoints and relevant gameplay tests, update CREDITS.md/ACCURACY.md, then deploy with the existing Vercel project credentials. The live site includes committed ambient skiers/riders and the U.S. units update; uncommitted character-model work has not been deployed.
5. Host the multiplayer server only if deployment credentials are available (Fly.io config in hosting/); otherwise retain exact deploy instructions.

"Join friend" map travel is already implemented and passed the multiplayer browser scenario again in session 2.

## Known bugs / limitations
- Tree species are a k-means split of fall NAIP colours (74% deciduous); no ground truth. Aspen share may be overestimated.
- OSM centerlines sometimes cross road-cut banks of the summer DEM (bare earth has no snow fill), giving short steep lips.
- The headless test browser caps at 60 fps; uncapped numbers come from a separate run with --disable-gpu-vsync.

## Snow realism pass (Codex, November 8, 2026)
- Replaced weak procedural snow with a CC0 scanned material: powder grain, shallow drift relief, variable roughness, cavity shelter, and subtle wind packing. All relief is in shading; DEM heights and physics are unchanged.
- Fixed corduroy coordinates to follow groomed run centerlines without world-origin distortion. Added fine 32 mm ridges and subdued grooming overlaps with pixel-footprint filtering.
- Replaced emissive square glitter with continuous crystal reflections in the actual direct-light/shadow calculation. Snow responds to time of day and overcast illumination.
- Ski tracks now conform across sloped terrain, have connected feathered shoulders and compacted troughs, break on teleports/air/lifts, and fade. Added short ballistic powder spray from the ski edges.
- Falling snow now uses softly shaped flakes with varied size, settling and wind drift, with fades at the lens and particle-volume edges.
- Rebuild committed texture with `npm run data:snow`; full data pipeline includes it. Source URLs, author, CC0 license and hashes are recorded in CREDITS.md and the texture source manifest. Packed texture is 6.46 MiB.
- Verification: build passed; 7 new grooming/track unit tests plus 5 existing terrain tests passed; all 3 pipeline checks passed. Fixed production-snapshot browser review passed 4 scenarios: Chromium smoke, WebGPU snow, WebGL2 snow, Safari smoke. Inspected screenshots `snow_webgpu_midway_11.png`, `snow_webgpu_midway_15.5.png`, `snow_webgpu_segundo_11.png`, `snow_webgpu_falling.png`, and `snow_webgpu_tracks.png`.
- Parallel-work caveat: a shared-checkout full unit run caught a lift-spacing failure during another agent's active lift refactor. A dev-server browser run was also interrupted by concurrent hot reload. Snow-specific checks pass; use a frozen production preview for reliable visual review while agents edit the shared checkout.
- Next in this graphics pass: improve the stretched sheet-like conifer branches and snow distribution, then review the required scenery viewpoints. Character, lift and building changes remain owned by the other active work.

## Audio realism pass (Codex, November 8, 2026, in progress)
- Scope: audio only. Other active agents own characters, lifts, buildings and scenery; preserve their changes in the shared checkout.
- Starting checks: production build and all 3 pipeline checks passed. Unit suite: 49 passed, 1 failed in the concurrently edited lift skip/unload behavior (`liftRiding.test.ts`). Recheck after that agent's work settles.
- Audited the old audio: 3-second correlated noise loops, fixed oscillator motor, resonant noise creaks, frame-triggered tower bursts, and no landing or camera-relative machinery placement.
- Verified CC0 field recordings for alpine ski contact (Lydmakeren), lift motor (indieground), lift machinery (13FPanska_Marval_Lukas), winter wind (HECKFRICKER), and dry snow compression (qubodup). Raw source downloads and license pages are cached under gitignored `data/raw/audio/`.
- In progress: reproducible compact sample bank, responsive snow and wind mix, spatial lift sounds, bounded event scheduling, and browser audio renders for validation. Sources and transformations will be recorded in CREDITS.md and a committed asset manifest.

## Winter forest and snow review (Codex, November 8, 2026)
- Rebuilt conifer boughs in physical meter space before normalizing for lidar instancing. This removes the exaggerated vertical droop and sheet-like branches caused by rotating geometry in a space where height and crown radius had different scales.
- Replaced uniform white branch coverage with coherent needle fans, irregular branch tiers, small snow caps and darker bark. Corrected the same cross-section stretching on bare aspen and oak branches, refined aspen bark marks, and normalized all near-tree heights to the measured instance height.
- Reviewed the base, all lift tops, signature runs and Mount Sopris. Conifers now read as individual branching trees; aspens have fine dark branches instead of thick white feathers. Remaining species classification uncertainty still applies.
- Refined ski spray into finer, less opaque grains after reviewing the first plume close-up. Tracks sample the shared physical surface probe, so they follow the concurrently added lift snow ramps as well as the DEM.
- Validation: build and 9 focused graphics tests pass. Snow, weather and track scenarios pass on WebGPU and WebGL2; Chromium and Safari smoke tests pass. The complete fixed-viewpoint sweep passed again after the last tree geometry corrections. Screenshots remain in the ignored `screenshots/` directory.
- Other agents continue building, lift and audio work. Commit only graphics-owned files/hunks. Use an immutable committed-source snapshot for final combined validation; do not publish arbitrary uncommitted parallel work.

## Minimap implementation and release (November 8, 2026)
- Added the skiing minimap from tested branch `codex/skiing-minimap`, release revision `8bfe7d0`. It follows the skier, shows heading, nearby runs with difficulty symbols, lifts and friends, and retains the independent full trail map. V hides/restores it; zoom and visibility persist.
- Map widths are 1,500 / 3,000 / 6,000 ft with shared U.S. display conversions. Static terrain/trails are cached, dynamic painting is limited to 12 Hz, and the smaller layout clears the speed HUD. See D16 for decisions.
- Validation on the isolated release source (including committed U.S. units and snow work through `2f49035`): build, 42 unit tests, all 3 pipeline checks and all 12 Chromium/WebKit browser scenarios passed. These results do not claim validation of the separate, ongoing character/building/audio work in this checkout.
- Inspected skiing, compact-window and lift screenshots. Tests cover movement, heading correctness, zoom limits, saved settings, full-map transitions, lift rides, multiplayer, chat input, missing hillshade and corrupt local settings.
- RELEASE COMPLETE: promoted the exact tested build `8bfe7d0` / `dpl_CYDURad3C2f56tMGqqYuBFR2oqKY` to https://sunlight-sim.vercel.app. Vercel resolves the public alias to that READY deployment; its HTML serves the expected `index-DS4vd5br.js` bundle.
- Production checks: Chromium minimap, fallback and smoke passed. WebKit fallback and smoke passed; its first skiing scenario completed all interactions but reported one `TypeError: Load failed`. Added failed-request/stack context and repeated the same live scenario twice, both clean. The initial error's root cause is unconfirmed and documented rather than suppressed. The normal start menu → Ski solo → visible minimap flow also passed with no page errors.
- Inspected live screenshots in both browser engines, copied to `screenshots/minimap-live-*.png` (gitignored). Names, scale, player heading, run/lift context and compact controls are readable. The release includes the already committed U.S. units and snow changes, while later realism work remains separate.
- The combined release's High-preset 1440p measurements were 37.4 to 60.1 fps across the four standard scenes. These include the snow changes and do not isolate minimap cost or establish new M1 hardware measurements. Runtime error/fatal logs returned no records; browser checks are the primary evidence for this static client.
- The minimap code is integrated on master in `d5a6251`, and README/DECISIONS.md D16 document its controls and design. This request is complete.
- Integration preserved all existing unstaged work; only the minimap hunks and these notes were staged. Future deployments from master retain this feature.

### Audio implementation checkpoint
- Built 14 local PCM WAVs (5.73 MiB) from the verified CC0 sources plus original chair Foley. `npm run data:audio` regenerates the bank and provenance manifest; the full data pipeline includes it.
- Replaced the correlated short-loop synth with a layered sample/fallback engine. Ski contact is gated by actual contact and responds to grooming, edge, skid and plow. Added softer fallen sliding, impact-dependent landings, stereo winter air, tuck-dependent airflow, spatial terminal recordings and lift-speed-scaled roller contacts.
- Added travel-aware event tracking: teleports, initial spawn and skipped rides cannot trigger a string of tower hits or a fake landing. Queued events use the audio clock and are cancelled on mute/hidden tabs or discontinuous travel.
- Typecheck passed. Added focused state/transition tests; next: actual Chromium/Safari audio renders, gain/silence/asset failure checks, waveform inspection, final full build/tests and committed-source release validation.

## Graphics pass final validation (November 8, 2026)
- Graphics commits: `2f49035` (snow material/weather/tracks/spray) and `0220f2b` (winter tree proportions, snow contact and refinements). The commits contain only graphics-owned changes and required integration hunks; other agents' uncommitted work was preserved.
- Validated an immutable `git archive 0220f2b` copy with its own preview and multiplayer server. Production build, all 55 unit tests, and all 3 pipeline checks passed.
- Browser results on that snapshot: 6 of 8 passed. Passing: gameplay with skiing/fall/recovery/lift/audio, Chromium smoke, WebGPU snow/weather/tracks, WebGL2 snow/weather/tracks, every fixed viewpoint, and Safari smoke. Personally reviewed the close-ups and the base/lift/run/Sopris views.
- Broader checks remain open: the second multiplayer browser timed out waiting for startup, and the 1440p High performance test measured 10.9 fps at spawn (other views 24.1 to 30 fps). Multiple other agents' GPU/browser tests were running simultaneously, so these are not clean isolated performance measurements. A diagnostic rerun still stalled the second client's startup; the cause was not established. Do not describe the full suite or 60 fps target as passing.
- Stable visual evidence copied to `screenshots/graphics_final_snow.png`, `screenshots/graphics_final_winter_forest.png`, and `screenshots/graphics_final_ski_tracks.png` (ignored generated screenshots).
- Next shared verification: repeat two-client startup and performance after the active lift, seated-character and audio changes settle. This graphics chat did not promote a deployment; its commits are available to the parallel release work.

### Audio render review and final tuning
- Rendered the real Web Audio graph in Chromium and WebKit, including quiet snow, gliding, loaded carving, braking, powder, airborne movement, both terminal bearings, distant machinery, tower rollers, lift skips, falls, landings, mute and zero volume. Each check writes PCM clips and level evidence under the ignored browser output directory.
- The first render exposed excess ambient masking. Reduced the background breeze and helmet turbulence so snow grain and machinery direction remain clear. Separated tower traversal from the terminal-distance test: roller contact is attached to the occupied chair and must remain close even when its station is far away.
- Added a four-skier spatial sound pool for visible ambient and multiplayer skiers. It follows actual movement, surface and view direction; stopped/airborne/lift riders are silent. Remote contacts use transmitted movement mode, velocity and plow, without changing the multiplayer protocol.
- Limited asset fetching to four concurrent requests while terrain streams. Invalid/missing recordings retain procedural fallback and expose diagnostic state. Repeated mute/unmute and voice disposal are checked in real browsers.
- Verification so far: full working-tree suite passed 70 tests before the nearby-skier addition; the 10 audio/asset tests and production build now pass. Audio bank regeneration produced byte-identical outputs. Final nearby-skier version passed all four Chromium/WebKit cases, rendering 16 acoustic scenarios per engine. Peak output was 0.549 (below full scale); mute/zero-volume tails were silent. Next: committed-source gameplay/smoke tests and release.

## Public GitHub publication (November 8, 2026)
- Owner requested all current app work on a public GitHub repository with `main` as the default branch. No Git remote or matching repository existed in the owner's account.
- Publish to https://github.com/realronaldrump/sunlight-sim, preserving the existing commit history and current source, tests, documentation and processed assets. Existing minimap feature files match the integrated versions; retain the separate local worktree.
- Pre-publication checks: production build, 72 unit tests and four pipeline checks passed. Environment files, raw downloads, dependencies and local deployment credentials remain ignored.
- Other chats are actively editing this shared checkout. Publication is a source checkpoint, not a claim that all ongoing realism, drone or terrain work is complete or deployed. Continue the existing feature-specific verification and release work after this checkpoint.
