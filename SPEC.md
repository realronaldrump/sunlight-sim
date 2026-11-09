# Sunlight Mountain Simulator: Build Spec

## 0. Read this first: how you work on this project

You are one of several AI coding agents (Claude Code and OpenAI Codex) that will take turns building this project. Only one agent runs at a time. Any session can end without warning when a usage limit is hit, and the next agent picks up from wherever the repo is.

**You are fully autonomous.** The owner will not answer questions, approve plans, review phases, gather data, download files, or test builds. Never stop to ask. Never wait for confirmation. Never end a session with "let me know if you want me to continue." If something is ambiguous, make the best decision, record it in `DECISIONS.md`, and keep going. If a tool or data source fails, find another one. If you finish a task, start the next one. The project is done only when every item in Section 9 (Definition of Done) is met.

### Session start ritual (every session, every agent)
1. Read `SPEC.md` (this file), `PROGRESS.md`, `DECISIONS.md`, and the last 30 entries of `git log`.
2. Run the build and tests. If anything is broken, fixing it is your first job.
3. Continue from "Next steps" in `PROGRESS.md`.

### Working rules
- **Commit early and often** (at least every meaningful step, roughly every 20 to 30 minutes of work) with descriptive messages. Assume you can be cut off at any second. Uncommitted work is lost work.
- **Update `PROGRESS.md` before every commit**: what's done, what's in progress, exact next steps, known bugs. Write it so a different agent with zero context can continue immediately.
- `SPEC.md` is the source of intent. Do not weaken it. You may append clarifications to `DECISIONS.md`.
- On the very first session, create `AGENTS.md` and `CLAUDE.md`, each containing only: "Read SPEC.md Section 0 before doing anything. You are autonomous. Never ask the owner for anything." Also create `PROGRESS.md` and `DECISIONS.md`.
- Install any tools you need yourself (Homebrew, npm, pip, conda, GDAL, PDAL, etc.). Prefer tools that need no account or API key. If a source requires signup, use an alternative.
- Large raw data goes in `data/raw/` and is gitignored. The pipeline that produces game-ready assets must be scripted and rerunnable (`npm run data` or similar) so any agent can regenerate everything from scratch. Processed, game-ready assets that are reasonably sized can be committed or regenerated; document which.
- Never use em dashes in any user-facing text, UI strings, or docs.

## 1. Goal

A browser-based, open-world, multiplayer ski simulator of **one mountain: Sunlight Mountain Resort, Glenwood Springs, Colorado.** The purpose is to let a beginner skier learn what the real mountain looks and feels like before skiing it: which runs go where, how steep each section really is, where lifts load and unload, and what the views look like.

Reference point: bonvo.ski models 6,000+ resorts in the browser at modest fidelity. This project models one resort, so spend every bit of that saved effort on accuracy and realism for Sunlight alone. It should be clearly better than Bonvo for Sunlight in terrain accuracy, visual quality, and ski feel.

No scores, timers, races, or achievements. Open world: spawn, ski anywhere, ride lifts, ski with a friend.

## 2. Platform and stack

- Runs in a desktop browser (Chrome and Safari on macOS are the primary targets; Windows Chrome should also work). No install for players.
- TypeScript, Vite, Three.js. Use the WebGPU renderer where supported with a WebGL2 fallback.
- Physics: custom ski physics on the terrain heightfield (Section 6). Use Rapier (WASM) or equivalent for collisions with trees, lift towers, buildings, and other players.
- Multiplayer: a small Node.js WebSocket server (Colyseus or plain `ws`, your choice, record it in `DECISIONS.md`). Server is authoritative for player positions and lift chair state.
- Performance target: 60 fps at 1440p on an Apple Silicon MacBook (M1 or newer, 16 GB) in Chrome. Initial load under 30 seconds on a typical home connection. Stream terrain and textures by tile/LOD rather than loading everything up front.
- One command to run everything locally (`npm install && npm run dev`) and one to build for production. Include deploy configs (static client on Vercel or Netlify; multiplayer server on Fly.io, Render, or Cloudflare Durable Objects). Deploy only if CLI credentials are already present on the machine; otherwise write exact deploy steps in `README.md` and move on.

## 3. Data: gather all of it yourself

Find, download, and process everything. Verify the actual extents; the resort boundary is the area covered by its runs and lifts in OpenStreetMap plus a margin.

| What | Source (use these or better free equivalents) | Use |
|---|---|---|
| Bare-earth elevation, 1 m | USGS 3DEP 1-meter DEM via The National Map API (TNM Access), or OpenTopography if no key needed | Core terrain for the resort area plus ~1 km margin |
| Lidar point cloud | USGS 3DEP LAZ tiles for the same area | Canopy height model (first returns minus bare earth) to place every tree at its real position and height; also cliffs, rock bands |
| Surrounding terrain, 10 m or 30 m | USGS 3DEP 1/3 arc-second | Distant mountains to the horizon so views are real (Mount Sopris, the Roaring Fork and Colorado River valleys, etc.) |
| Aerial imagery | NAIP (USDA, ~0.6 m) via Microsoft Planetary Computer STAC (no key) or USGS | Ground truth for where open runs, tree lines, buildings, roads, parking are; landcover classification; summer ground colors where snow is thin is NOT the goal, so use it as a guide, not a texture |
| Runs, lifts, buildings | OpenStreetMap via Overpass API: `piste:type`, `piste:difficulty`, `piste:grooming`, `aerialway=*`, `aerialway=pylon`, `building`, roads, parking | Run polygons/centerlines, names, difficulty, lift lines, tower positions, station locations |
| Ski-specific map data | OpenSkiMap data exports | Cross-check runs and lifts |
| Official trail map and resort info | sunlightmtn.com (trail map, lift specs, run list) | Verify every run name, difficulty, and lift. Where OSM and the official map disagree, the official map wins. Use for reference only; do not ship copyrighted images in the game |
| Public photos | Any publicly viewable photos of Sunlight (resort site, Google results, webcams) | Reference only, to judge whether the game looks right (tree species mix, lodge look, lift style). Do not ship them |
| Textures, models, HDRIs | Poly Haven, ambientCG (CC0), and other clearly CC0/CC-BY assets | Snow, rock, bark, conifer and aspen models, sky. Record every asset and license in `CREDITS.md` |

Build a scripted pipeline (Python with GDAL/PDAL/rasterio, or Node, your choice) that turns raw data into game-ready tiles: heightmap tiles with LOD, normal maps, slope maps, a tree instance list (position, height, species guess), run and lift geometry in local game coordinates, and a metadata file. Use a single local coordinate system in meters centered on the resort.

Accuracy rule: terrain heights in the game must come from the DEM, not from art. Do not smooth or exaggerate terrain beyond what's needed to remove lidar noise.

## 4. World content

- **Terrain:** 1 m resolution in the skiable area, lower LOD with distance, real surrounding terrain to the horizon.
- **Snow surface:** groomed runs show corduroy texture and look smooth; ungroomed runs and glades look natural and slightly uneven; tree wells and wind effects are a bonus. Snow should look like real Colorado snow in sun and shade (sparkle, subsurface blue in shadow), not white plastic.
- **Trees:** every tree from the canopy height model, instanced. Sunlight has a mix of conifers (spruce, fir) and aspen groves, plus scrub oak at lower elevations; use NAIP and reference photos to decide which areas get which. Bare aspens in winter. Trees must have collision.
- **Runs:** every run on the official trail map, with correct boundaries, names, and difficulty. Trail signs at run entrances with the name and difficulty symbol (green circle, blue square, black diamond, double black). Rope lines/boundary markers where appropriate.
- **Lifts:** every lift (chairlifts and any surface lift) along its real line with towers at real positions (OSM pylons where available, otherwise interpolated to match reference photos), bull wheels, load and unload stations, cable with realistic sag, chairs at realistic spacing and speed. Look up each lift's real specs (type, length, capacity, speed) and use them.
- **Buildings:** base lodge, ticket area, patrol shacks, and any mid-mountain structures, modeled to match footprint and rough look from imagery and reference photos. Parking lot at the base.
- **Sky and light:** physically based sky, sun position for a winter day at Sunlight's latitude (default 11:00 AM in January), cascaded shadows, atmospheric haze/aerial perspective so distant mountains read correctly. Optional time-of-day slider.
- **Weather:** clear by default; optional light snowfall toggle.
- **Audio:** wind that scales with speed, ski-on-snow sounds that differ for groomed vs powder and carving vs skidding, lift machinery hum near stations, chair creak on the lift. CC0 sources only.

## 5. Player experience

- On desktop, spawn on skis beside the main lodge's ski racks, with room to ski down to either base lift.
- Third-person camera by default, first-person toggle. Camera must make slope steepness readable (this matters most for a beginner preparing for real runs).
- Controls: keyboard (WASD/arrows) and gamepad. Simple to learn: steer, speed control (snowplow/pizza for braking), tuck, stop, and a key to stand back up after a fall.
- **Lifts work for real:** ski into the loading zone, the chair arrives and picks you up, you ride the full lift at real speed with the real view, and you unload at the top. Option to skip the ride (fast-forward) but default is real time.
- **Map:** a toggleable trail map overlay (generated from the game's own data, not the copyrighted official map image) showing your position, other players, run names, and difficulty colors. Click a run on the map to teleport to its top.
- **Beginner tools (no scoring):** a toggleable slope-angle overlay that tints terrain by steepness, a readout of current slope angle and speed, and a run name label when you enter a run.
- Graphics quality presets (Low/Medium/High/Ultra) with auto-detection.

## 6. Ski physics

This is the hardest and most important system. It must feel like skiing, not sliding on ice and not driving a car.

- Model the skier as a body on two skis with: gravity component along the slope, snow friction that varies by grooming and speed, aerodynamic drag that depends on stance (tuck vs upright), edge angle and carving based on sidecut radius, skidding vs carving transition, and snowplow braking.
- Turning comes from edging and weight shift, not instant yaw.
- Real speeds: a cautious beginner on a green run should go roughly 10 to 25 km/h; a tuck on a steep blue should reach realistic speeds. Look up real-world values and document them in `DECISIONS.md`.
- Collisions with trees, towers, and buildings cause a fall; falling and getting up are animated.
- Terrain sampling uses the same 1 m heightfield as rendering so what you see is what you ski.
- Rigged skier character with animations for skiing stances, turns, snowplow, tuck, falling, getting up, and sitting on the lift. Use CC0 or freely licensed models/animations (Mixamo-style rigs are fine if license allows) and record them in `CREDITS.md`.
- Build a physics test harness: scripted skiers that descend specific runs, logging speed and path, so you can tune without a human.

## 7. Multiplayer

- Up to 8 players per room; the main use is 2.
- Join by shareable link with a room code. No accounts, no login. Players enter a display name and pick a jacket color.
- Players see each other's skiers with smooth interpolation, can ride the same chair together, and see each other on the map.
- Optional simple text chat or quick emotes. No voice needed.
- Works across the internet once deployed, and on localhost/LAN for testing.

## 8. Self-verification (you have no human tester)

- Automated tests for the data pipeline, physics, lift system, and networking.
- Use Playwright with a headless browser to load the game, run scripted scenarios (spawn, ski a run, ride a lift, two clients in one room), and capture screenshots from fixed viewpoints: base area, top of each lift, several signature runs, a view toward Mount Sopris.
- **Look at your own screenshots** and compare against the reference photos and trail map. If something looks fake, wrong, or ugly, fix it. Log each visual review in `PROGRESS.md`.
- Accuracy checks: compare each run's in-game length, vertical drop, and max/average slope against values computed directly from the DEM, and against any published figures for Sunlight (summit elevation, vertical drop, run count). Write these into `ACCURACY.md`.
- Performance profiling against the target in Section 2.

## 9. Definition of Done

All of the following, verified by you and recorded in `PROGRESS.md`:

1. `npm install && npm run dev` starts the client and multiplayer server; a browser at the printed URL loads Sunlight.
2. Terrain from real 1 m lidar DEM across the whole resort, real surrounding terrain to the horizon.
3. Every run on the official trail map is present with correct name, boundaries, and difficulty, with signs.
4. Every lift is present at its real location with towers, stations, moving chairs, and a working ride up.
5. Trees placed from lidar canopy data with correct species mix by area and collision.
6. Ski physics passes the test harness and feels realistic per Section 6.
7. Two browser clients can join one room by link, ski together, ride a chair together, and see each other on the map.
8. Map overlay, slope overlay, first/third person, quality presets, audio all work.
9. Meets the performance target on High preset.
10. `README.md` (how to run, how to deploy, how to share a link), `CREDITS.md` (every data source and asset with license), `ACCURACY.md`, and `DECISIONS.md` are complete.
11. A final visual review pass of all screenshot viewpoints with fixes applied.

After Done, keep improving realism (snow detail, lighting, animation, sound) and log each improvement, until the session ends.