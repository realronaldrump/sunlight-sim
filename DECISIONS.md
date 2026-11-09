# Decisions

Clarifications and choices made by the agents. Append new entries; do not delete old ones (mark superseded instead).

## D1. Coordinate system
- Projected CRS: NAD83 / UTM zone 13N (EPSG:26913). Heights are NAVD88 meters from USGS 3DEP.
- Local game origin: UTM E 298500.5, N 4362800.5 (a 1 m DEM pixel center, so mesh vertices coincide with DEM samples) (middle of the ski area). Game axes: +x = east, +y = up, -z = north (Three.js convention, so z = -(N - ORIGIN_N)).
- Earth curvature (with standard refraction, R_eff = 7/6 * 6371 km) is applied in the terrain vertex shader relative to the viewer so distant peaks sit at the correct apparent height. Physics ignores curvature (drop is under 1 mm within 100 m).

## D2. Data sources actually used
- 1 m bare-earth DEM: USGS 3DEP 1 m, project CO_Central_Western_2016 (tiles x29y437, x30y437), the same lidar flight as the point cloud. The 2020 SanLuisJuanMiguel 1 m tiles only partially cover the area and are used to fill gaps if any.
- Lidar: USGS LPC CO_Central_and_WesternCO_2016_A16 LAZ tiles over the resort plus margin.
- Regional terrain: 3DEP ImageServer (1/3 arc-second, about 10 m native) resampled to an 8 m grid over 32 x 32 km.
- Far terrain: 3DEP ImageServer resampled to a 32 m grid over 131 x 131 km (includes Mount Sopris, the Elk Range, Flat Tops edge).
- OSM via Overpass API for runs, lifts, pylons, buildings, roads, parking.

## D3. Official trail map wins
Run list and difficulty come from the official 2024-25 Sunlight trail map and the East Ridge map (sunlightmtn.com, viewed for reference only, not shipped). OSM geometry is used for location; names/difficulty are corrected to the official map. Unnamed OSM ways are matched to official names by location. See `pipeline/official_runs.py`.

## D4. Lifts (2025-26 season configuration)
- Primo: new Leitner-Poma fixed-grip quad (2025), replaced the 1966 Riblet double on the same alignment.
- Segundo: fixed-grip triple (ex Arapahoe Basin Lenawee lift), replaced the 1954 Riblet double in 2025.
- Tercero: fixed-grip triple (1987, ex Snowmass), beginner area.
- Exact speeds are not published. Used typical fixed-grip values: Primo 2.3 m/s, Segundo 2.3 m/s, Tercero 1.8 m/s (beginner lift). Lengths and vertical come from OSM geometry + DEM. Capacities: Primo ~1400/h (reported), Segundo ~1200/h, Tercero ~1000/h; chair spacing derived from capacity = seats * speed * 3600 / spacing.

## D5. Rendering
Three.js WebGPURenderer (three/webgpu) with TSL node materials. It runs on WebGPU where available and automatically falls back to its WebGL2 backend. No GLSL ShaderMaterial is used because it is not supported by WebGPURenderer.

## D6. Terrain LOD
Chunked quadtree LOD. Height data is a pyramid of 256x256-cell tiles (259x259 samples incl. 1-sample border) at resolutions 2^L meters (L0 = 1 m). L0-L2 come from the 1 m DEM (resort + ~1 km margin), L3-L4 from the 8 m regional grid (with the 1 m data composited in), L5+ from the 32 m far grid. Render chunks are 64x64 quads; chunk geometry is built on the CPU with skirts to hide LOD cracks. Tiles are stored as gzip-compressed, plane-predicted uint16 with per-tile offset and scale, decompressed in the browser with DecompressionStream.

## D7. TypeScript and TSL
Files that are mostly TSL shader graphs start with `// @ts-nocheck` because the @types/three node typings reject valid TSL. Everything else is strict TypeScript.

## D8. Ski physics values (shared/skiPhysics.ts)
Real-world reference values used:
- Ski-snow kinetic friction: 0.02 to 0.10 depending on speed and snow (Colbeck 1992, "A review of the processes that control snow friction"; Buhl et al. 2001). Model: mu = 0.045 + (0.10 - 0.045) * exp(-v / 5 m/s) on groomed snow, +0.05 on ungroomed snow, +0.02 in moguls, plus a velocity-proportional ploughing drag off-piste.
- Aerodynamic drag area CdA: about 0.6 m^2 standing tall, 0.3 m^2 in a recreational tuck (elite downhill racers 0.15 to 0.25; Barelle et al. 2004, Elfmark and Bardal 2016). Air density 0.96 kg/m^3 at 2700 m and -5 C.
- Sidecut radius 14 m (typical all-mountain/rental ski). Carved turn radius = R_sidecut * cos(edge angle) (Howe, "The New Skiing Mechanics").
- Lateral edge grip 0.32 (flat ski) to 1.05 (edged, hard groomed snow) times the normal force; hockey stop 0.75.
- Snowplow braking 0.32 times the normal force at full wedge: enough to stop on greens (about 10 deg) but not on steep blacks, as in reality.
- Measured recreational speeds for comparison: Shealy et al. 2005 radar study, mean about 43 km/h for adults, beginners well below 25 km/h. Spec target: cautious beginner on a green 10 to 25 km/h.
Harness results (tests/harness/runBots.ts, see PROGRESS.md): beginner bot 15 to 21 km/h average, 25 to 29 km/h max on greens/blues; intermediate 27 to 44 km/h average; straight-line tuck 80 to 120 km/h max on long blues.
- The harness nudges a bot forward if it is stuck for 15 s (OSM centerlines sometimes cross road-cut banks in the summer bare-earth DEM). This is test-only; players navigate themselves.

## D9. Collisions
Collisions use a purpose-built spatial hash of vertical cylinders (trees, towers) and oriented boxes (buildings, stations) in shared/skiPhysics.ts rather than Rapier. Reason: the only dynamic body is the skier (players collide as cylinders too), every obstacle is static and simple, and a deterministic dependency-free module runs identically in the browser, the Node test harness and the server. This is the "or equivalent" option in the spec.

## D10. Multiplayer
- Plain `ws` WebSocket server (server/src), JSON messages (shared/protocol.ts), 15 Hz snapshots, rooms by 5-character code, max 8 players.
- Authority: the server owns the canonical player list and positions. Clients simulate their own skier for responsiveness and send state; the server validates (finite numbers, speed cap 70 m/s, implausible jumps rejected with a `correct` message unless the client flags an explicit teleport such as map travel), clamps velocity, and broadcasts its snapshot. While a player rides a chair, the server derives their position from the lift clock (server time) and seat, ignoring client positions.
- Lift chairs: chair positions are a pure function of server time (shared/lifts.ts). Clients sync their lift clock to the server with ping/pong (best RTT). Boarding is requested from the server, which checks the chair is at the load line and assigns a free seat on that chair (friends in the load zone together share a chair).
- Remote skiers are rendered 120 ms in the past with linear interpolation between snapshots; remote riders are placed exactly on their chair seat by the shared lift clock.
- Player-player contact is a cylinder test on the client; a hard hit makes the local player fall.
- Dev server port: `--port 8787` (the preview launcher sets PORT for Vite). In production `$PORT` is used.

## D11. Quality presets
Low/Medium/High/Ultra change pixel ratio, shadow maps and cascades, terrain LOD split distance and tree near/far distances. Auto-detect: High on desktop with WebGPU and 8+ cores, Medium on WebGL2 fallback or fewer cores, Low on mobile. Changing quality in the start menu reloads the page.

## D12. Deployment
- Client deployed to Vercel (CLI credentials were present): https://sunlight-sim.vercel.app, project `sunlight-sim`. Use `npx vercel@latest` (the globally installed CLI is too old for the deploy endpoint).
- No Fly.io/Render credentials on the machine, so the multiplayer server is not hosted; exact steps are in README.md (`hosting/fly.toml`, `hosting/render.yaml`, `server/Dockerfile`). Server deploy files live in `hosting/` because the new Vercel CLI auto-detects `fly.toml`/`render.yaml` at the repo root as extra services and refuses to deploy.
- The deployed client falls back to solo play with a toast when the server is unreachable.

## D13. Realism-first art pass (owner direction, November 8, 2026)
- The owner explicitly prioritized realism and detail over FPS tuning. Preserve functioning gameplay while improving human characters, ski equipment, lift rides and geographically accurate buildings.
- Use freely redistributable anatomical assets when they improve realism. Model ski clothing and equipment specifically for skiing, with articulated poses and contact with skis/chairs.
- Building footprint fidelity alone is insufficient. Facade, roof, massing, lodge decks and terminal appearance must be checked against Sunlight photo references. Record estimated dimensions as estimates, not measured facts.
- Completion of mechanics tests does not imply that placeholder art meets the visual Definition of Done.

## D14. U.S. display units (owner direction, November 8, 2026)
- The game displays speed only in mph, elevation only in feet, and lift distances and trail-map run lengths in feet below one mile or miles at and above one mile. Number formatting uses U.S. separators.
- All player-facing measurement conversions are centralized in `client/src/ui/units.ts`. Slope angles remain in degrees.
- Terrain data, physics, lift movement and multiplayer coordinates retain their existing SI units for accuracy and compatibility. Convert only at the display boundary; do not retune movement or relabel metric values as U.S. values.

## Snow surface realism (November 8, 2026)

- Use the CC0 Poly Haven Snow 02 scan as linear height/grain/roughness/occlusion data. Two world-anchored projections at 2 m and about 7.3 m prevent a single obvious repeat; macro variation is procedural. The enlarged layer is an artistic wind-deposition approximation, not a surveyed snow depth.
- Corduroy uses signed distance to resampled, lightly smoothed groomed run centerlines. The old dot(world position, varying fall-line direction) introduced origin-dependent distortion. Ridges use estimated 32 mm spacing, about 1.7 mm shading relief, and subtle 4.8 m grooming-pass overlaps. These are visual estimates, not measurements of Sunlight grooming equipment.
- Crystal glints extend Three.js PhysicalLightingModel.direct and multiply the actual light color after shadow attenuation. They vary continuously with view and sun directions, fade below pixel resolution and have no emissive term. Grazing scattering is a bounded visual approximation, not a volumetric snow simulation.
- Preserve DEM heights and ski physics. Snow detail changes material normals only; ski grooves sit 8 to 20 mm above the heightfield to avoid z-fighting and represent compacted trough shading and displaced shoulders. Powder spray is transient visual geometry and has no collision.
- Keep this pass scoped to terrain material, snow weather, ski tracks and spray. Other agents concurrently own character, lift, building and interface changes.

## D15. Skiing minimap (owner request, November 8, 2026)
- Add a persistent, player-centered minimap alongside the existing full trail map. It stays north-up so the terrain does not rotate during turns; the cyan skier arrow follows the physics heading, including while riding a lift. The full map keeps its independent orientation, pan, zoom and teleport behavior.
- Reuse the game's DEM/lidar hillshade, run geometry and official difficulty metadata. Cache the static terrain/trails in a canvas, then update nearby labels, lift lines and multiplayer markers at 12 Hz. No new map service, account, dependency, copyrighted trail-map image or world-data download is needed.
- Default to a 3,000 ft map width, with 1,500 ft and 6,000 ft zoom options, a ground-distance scale and north indicator. Format all measurements through the shared U.S. units helpers, following D14; projection coordinates remain in meters. Show the current run or lift persistently; avoid overlapping labels and limit nearby run names to five. Remote players use jacket colors; the local arrow remains cyan for visibility.
- Place the panel in the upper left, below multiplayer room controls, with smaller layouts for short windows. V or the compact button hides/restores it. Remember visibility and zoom locally, and retain vector trails if the hillshade fails to load. Opening the full map hides the minimap until the full map closes.
- The original checkout contains active, unfinished skier-model work. Implement and validate this bounded request in a managed worktree based on `1efa79e`, without copying the unrelated draft tests or art changes. Deploy the verified minimap revision to the existing `sunlight-sim` Vercel project.
- Before release, merge the committed U.S. units and snow improvements from master so deployment preserves concurrent completed work. The initial metric minimap labels are superseded by the U.S. display decision above.
