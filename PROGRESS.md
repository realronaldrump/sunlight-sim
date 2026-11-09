# Progress

## Mount Sopris detail (November 8, 2026, release verification pending)
- Owner requested accurate Sopris geometry while retaining the existing roughness of other distant mountains. Other agents are actively editing this checkout; their work is preserved.
- Starting build, 72 unit tests and 4 pipeline checks passed. The original summit-view mesh used 64 to 128 m spacing around Sopris; captured `screenshots/sopris-before-{summit,detail}.png`.
- Added 37 tiles from pinned 1 m USGS CO_SanLuisJuanMiguel_2020_D20 data: 4 m summit geometry, 8 m upper slopes, 16 m apron. Complete native coverage over the summit and upper slopes; source gaps in the northern valley retain existing regional terrain. Total patch size is 2.97 MiB. Rebuild and independent native-source validation are scripted; repeated output is byte-identical.
- The renderer retains this detail from Sunlight on every preset, keeps its tiles cached, waits for tile requests before reporting idle, and versions asset URLs to prevent stale browser caches mixing the old and new model.
- Independent 8,192-point source comparison: median height error 0.0396 m, p95 0.3050 m, maximum 5.188 m on an isolated steep feature. Both rendered summits are within 0.14 m of native DEM maxima. These are mesh-vs-DEM differences, not absolute survey claims. ACCURACY.md, source/accuracy manifests, README, CREDITS and DECISIONS record the evidence and seasonal appearance limits.
- Retrieved and inspected Davis's October 2020 Sunlight photo on r/Colorado; he confirmed authorship. Compared it with the normal and 16-degree detail views. The formerly smoothed ridge now resolves the summit shoulders, rock ribs, gullies and cirques. The current live webcam is dark and was not used for silhouette validation.
- Validation: production build, all 85 current unit tests and 5 pipeline checks pass. Immutable preview passes 4 browser cases: Chromium smoke, Sopris on WebGPU, Sopris on WebGL2, and Safari smoke. Screenshot paths: `screenshots/sopris-{webgpu,webgl2}-{summit,detail}.png`. Both backends render the actual summit mesh at L2 and retain it through cache eviction with no page/terrain-fetch errors.
- Sopris release isolation caught a concurrent API mismatch: the committed game passes the camera to `LiftSystem.update`, while the matching chair implementation is still uncommitted. Added only the backward-compatible optional camera parameter to the committed interface; left the active chair geometry changes untouched. Rechecking the frozen release before deployment.
- Some initial renderer/pipeline edits were included by another agent in shared checkpoint `2d2d062`. This commit completes the assets, source checks, cache revision and documentation. Next: verify the committed release snapshot, push main and publish/verify the existing Vercel project. Other agents' ongoing chair work remains outside this change.

## Lift mechanics audit (November 8, 2026, in progress)
- Owner requested verification of boarding/riding, accurate Sunlight timing/physics, documentation and deployment.
- Starting production build, 30 existing unit tests, 3 pipeline checks and 6 browser scenarios passed. Two then-untracked skier-rendering tests initially failed during concurrent character implementation; those now pass with that implementation. Preserve other chats' character/building/snow/interface work.
- Reproduced estimated-speed mismatch and incorrect ride-time endpoints with failing tests before changing shared lift timing. Published specs and uncertainty are documented in D15. Updated all three speeds and installed chair counts in the rerunnable pipeline and resort data.
- Added physical/rendered snow loading pads and exit ramps, shared seat transforms, actual swept chair pickup, upright/slow/uphill eligibility, same-lane unloading at chair speed, suspension recovery and cable-distance countdowns.
- Server now validates the skier as well as the chair, assigns distinct seats, rejects full/invalid requests without losing reservations, and releases seats at the unload line. Removed optimistic boarding and prevented ambient riders overlapping player chairs.
- Current working-tree validation: 53 unit tests and production build passed. New tests simulate complete real-time rides on all three lifts, slow frames, a full-loop suspension, snow-grid consistency, bad boarding requests, full-chair behavior, shared seat coordinates and natural unloading. No live deploy has been made for this lift change yet.
- Follow-up browser review caught a genuine Segundo outer-seat runout stall on the DEM ridge. Reproduced it in the real Player/terrain test, then raised only estimated cable/terminal clearance and added a downhill snow exit above the unchanged DEM. All 27 lift/ride/room tests now pass, including every seat lane clearing the next chair.
- Primo and Tercero browser loading, seating, midpoint timing, ambient-chair occupancy and natural unloading passed. The full gameplay scenario also passed; repeat Segundo and the two-client case on the final fixed snapshot after the ramp change. An initial gameplay attempt was transiently slow during concurrent GPU tests; a focused replay reproduced normal skiing.
- Owner expanded scope to detailed, realistic chair graphics. Close-up Primo/Segundo March 2026 and Tercero 2016 references are cached in data/raw/reference/lifts. Original curved-frame, grip, upholstery, numbering and restraint models are being built; no external photos ship.
- Next: finish chair graphics and close-up reviews, run the full release checks from a fixed source snapshot, deploy, verify the public alias, and record the result here.

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
0. Human replacement and detailed ski gear are implemented and reviewed. Further character polish: varied appearances, cloth detail, fall/recovery motion and ambient skier behavior.
1. Main lodge and Brettelberg have distinct models from aerial/OSM footprints and photos. Continue the same treatment for outlying lodgings and service buildings; exact facade dimensions remain estimates.
2. Review lift seats, restraint bars, terminal machinery, load lines and unload paths at human scale. Prevent ambient riders from overlapping player seats.
3. Improve tree shapes, tree wells, wind-scoured ridge shading, and canopy occlusion without altering measured terrain elevations.
4. Character/building release `6429651` is deployed and verified at https://sunlight-sim.vercel.app. Later drone, detailed Mount Sopris and lift refinements should be validated and released from their own committed-source snapshots, preserving this work.
5. Host the multiplayer server only if deployment credentials are available (Fly.io config in hosting/); otherwise retain exact deploy instructions.

"Join friend" map travel is already implemented and passed the multiplayer browser scenario again in session 2.

## Character and building verification checkpoint (November 8, 2026)
- Character commit `adbb728`: anatomical human bodies and detailed ski gear for the player, friends, ambient skiers and seated chair passengers. The source hash, license and reproducible pipeline are committed. Building and startup work was included by the concurrent repository checkpoint `2d2d062`.
- Added the missing main lodge footprint from NAIP. Its roof is anchored at 2493.065 m NAVD88 from 78 lidar-plus-DEM cells. Added its cream facade, window wall, deck, access stairs and roof service block. Added Brettelberg's timber framing, gable and exterior galleries, and corrected three base support buildings to one story. Exclude false vegetation candidates inside building polygons.
- Production build and four pipeline checks pass. A frozen production snapshot passed character/building visual checks, full skiing/fall/recovery/lift gameplay, Chromium smoke, Safari smoke and all required viewpoints. Inspected character poses, lodge/condos, base area, all lift tops, Ute, Midway, Beaujolais, Sun King, The Heathen, Grizzly Road and Mount Sopris.
- Traced the second-client startup stall to `detectQuality()`: the browser's WebGPU `requestAdapter()` never returned. Capability checks now time out after 4 s, renderer initialization after 5 s, then use the existing WebGL2 renderer. The synthetic never-resolving GPU browser regression passes.
- Two clients passed startup, movement, exact same-chair boarding in different seats, unload, map travel and chat against the frozen matching server on port 8796. A later boarding failure with the shared dev server was caused by using older cached lift data with a newer frozen client; it disappeared with matching snapshots.
- Fidelity is improved, not survey-perfect. Non-roof building dimensions, outlying generic structures, exact post-2025 lift tower locations and a clean High-preset performance measurement remain open. FPS tuning is deferred by owner instruction.

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

## Audio realism pass (Codex, November 8, 2026, complete)
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

### Audio release complete (November 8, 2026)
- Audio commits: `c431aad` (CC0 bank and responsive engine) and `a28deee` (mix balance, nearby skiers and browser verification). All audio changes and licensing/provenance are committed.
- Built and tested an immutable archive of `a28deee997040efd64c31e8b97835cd2b52e312f`: production build, all 70 unit tests and all 3 committed pipeline checks passed. Seven browser scenarios passed: Chromium gameplay with skiing/fall/recovery/lift/audio, audio rendering/fallback in Chromium and WebKit, and smoke checks in both engines.
- Promoted Vercel production deployment `dpl_FmZY3oz25k9CSzKqjpbCnEW9UxDE` to https://sunlight-sim.vercel.app. Verified READY state, the public alias, exact tested `index-w9ef6Ac9.js` bundle and matching 14-asset provenance manifest.
- All six public-site Chromium/WebKit audio and smoke scenarios passed. Each engine rendered 16 acoustic cases, checked direction/surface/airborne behavior, mute and zero-volume silence, missing-sample fallback, bounded transient voices and disposal. Test clips/levels are generated by `tests/e2e/audio.spec.ts`; final live measurements are also saved in ignored `data/processed/audio-final-review/`.
- The protected-stage verification CLI automatically created one automation-bypass secret. Revoked that exact task-created secret after checking the staged files, and verified deployment protection was unchanged. Public-site tests required no bypass.
- This audio request is complete. The released source is the exact commit above; later parallel source checkpoints and ongoing drone/building/lift/terrain work need their own verification and subsequent release. Previously noted multiplayer startup and graphics performance limitations were not reclassified by the audio checks.

## Drone mode implementation (November 8, 2026, in progress)
- Added player-facing drone launch/exit (G and a visible button), stabilized acceleration/hover/braking, keyboard and gamepad flight, drag/pointer-lock/arrow look, precision/fast modes, FPV/chase cameras and recall above the skier.
- Original real-scale quadcopter has four counter-rotating rotors, motor/arm detail, gimbal camera, optical sensors, landing feet and navigation lights. Four independent RPM-driven rotor voices share mute/volume behavior. Environmental audio follows the drone without ski contact.
- Bound flight to the actual resort polygon plus a 60 m apron, 120 m above local terrain, with a visible proximity grid. Added fine-terrain streaming holds, ground clearance and tree/tower/building collision checks. Minimap follows the drone and shows the parked skier.
- Skier/seat state remains separate; occupied chairs continue riding/unloading. Multiplayer transports and validates optional drone state, rendering remote aircraft while preserving skier authority. Map travel exits flight, and ski input is cleared on transitions/focus loss.
- Starting build, 72 unit tests and four pipeline checks passed. Current build and all eight new drone tests pass; 80 tests passed overall, with four failures solely in another agent's then-untracked Sopris tests whose data generation is still running. Do not modify that agent's work to hide failures.
- Concurrent checkpoint `2d2d062` already included the first drone physics/model/audio/input files along with the other active work. This checkpoint commits the remaining drone integration and docs; no unrelated files are staged by this task.
- Next: frozen-build browser controls, graphics, audio, both render backends and multiplayer checks; fix observed issues; validate committed source; deploy to the existing Sunlight Vercel project and verify the public alias. No drone deployment yet.

## Main-only deployment policy (November 8, 2026)
- Owner requires `main` as the only local and GitHub branch, and every deployment to include `git push origin main`. Added this policy to AGENTS.md.
- The minimap feature files already match their integrated versions on main. Preserve the former branch history with an ancestry-only merge, retaining the current implementation, then detach its clean checkout and remove the obsolete local branch. GitHub already has only main.
- Validation: production build, all 84 unit tests and all five pipeline checks passed. Other chats' ongoing source/data/document edits remain unstaged.

## Live character and architecture release (November 8, 2026)
- Released committed snapshot `6429651` to https://sunlight-sim.vercel.app, Vercel deployment `dpl_HQAGYrZLgmQ8wkmyDUhLzp4SPPmq`, READY. Used a staged production build, verified its bundle and character license, then promoted that exact build. The local snapshot is `tests/scratch/realism-release/` (ignored).
- Exact release checks: production build, all 72 unit tests, all four pipeline tests and 10 browser scenarios passed. Browser coverage includes character/building views, full skiing/fall/recovery/audio gameplay, natural load/ride/unload on all three lifts, same-chair multiplayer, a never-resolving GPU startup fallback, Chromium and Safari smoke checks, and the full fixed-viewpoint sweep.
- Public browser verification loaded in 8.45 seconds on this connection, used WebGPU, found the 53-bone human, the lodge's 2493.065 m roof and named Brettelberg model, and produced no browser errors. Live captures: `screenshots/realism_live_base.png` and `screenshots/realism_live_lodge.png`.
- Ran `git push origin main` and verified `6429651` is an ancestor of `origin/main`, following the updated AGENTS.md deployment policy. Subsequent parallel commits remain on main and were not silently folded into this tested deployment.
- This is a verified realism release, not a claim that the complete visual/performance Definition of Done is now satisfied. Continue reference-based outlying buildings, character variety/cloth/fall polish, exact modern lift geometry, and the remaining realism tasks above. The historical 60 fps result predates these art additions; High-preset performance still needs a clean later pass, as the owner explicitly deferred FPS tuning.
