# Sunlight Mountain Simulator

A browser-based, open-world, multiplayer ski simulator of one mountain: **Sunlight Mountain Resort, Glenwood Springs, Colorado**. Built so a beginner can learn the real mountain before skiing it: which runs go where, how steep each section really is, where lifts load and unload, and what the views look like.

- Terrain from the USGS 1 m lidar DEM across the resort, real surrounding terrain out to 65 km (Mount Sopris, the Elk Range, the Roaring Fork and Colorado River valleys).
- About 244,000 trees placed from the lidar canopy height model, species from aerial imagery (spruce/fir, Douglas-fir, bare aspen, Gambel oak).
- All 75 runs on the official trail map with official names and difficulty, run boundaries from the lidar tree gaps, signs at every run entrance.
- Primo, Segundo and Tercero chairlifts on their real lines with OSM tower positions, moving chairs, real-time rides.
- Physically based ski model (edging and sidecut carving, skidding, snowplow, tuck, drag, falls).
- Multiplayer rooms by link, shared chairs, chat, trail map with other players.
- All in-game measurements use U.S. units: speed in mph, elevation in feet, and lift distances and trail lengths in feet or miles.

**Play now:** https://sunlight-sim.vercel.app. Desktop skiing and iPhone drone exploration share the same multiplayer rooms.

## Run it locally

Requirements: Node 20.19+ (or 22+). A browser with WebGPU or WebGL2. Desktop browsers support skiing and drone flight; iPhones launch in drone-only mode.

```bash
npm install && npm run dev
```

Open the printed URL (http://localhost:5173). `npm run dev` starts both the client (Vite, port 5173) and the multiplayer server (port 8787). On your LAN, friends can open `http://<your-ip>:5173`.

All game-ready world data is committed under `client/public/world`, so no data download is needed to play.

## iPhone controls

An iPhone always starts as a drone. Skiing, walking and lift boarding are unavailable, including with an attached keyboard or gamepad. Portrait and landscape both work.

- **Tap a destination** in the scenery to fly there. Tap the mountain to fly above it; tap the sky to climb toward it. The marker shows where you are heading.
- **Drag to look around.** Dragging pauses flight, so you can aim before choosing your next destination.
- **Hold** stops immediately. **Home** returns to your current launch point. **View** switches between chase and the drone camera.
- Choose **Gentle**, **Cruise** or **Fast**. Flight accelerates and slows smoothly, climbs for nearby terrain and obstacles, and stops with a message if the path stays blocked. Pick a closer or higher destination to go around dense obstacles.
- **Map** lets you tap a run or friend to fly there. Pinch to zoom and drag to pan. **Chat**, **Options** and **?** are available without a keyboard.
- Backgrounding Safari, losing focus, rotating, opening a panel or losing the multiplayer connection stops flight. Rejoining your room is automatic; movement does not resume by itself.

Graphics use a phone-sized rendering budget, antialiasing, shorter tree detail range and no shadows. Real terrain and Mount Sopris detail remain. Physical iPhone GPU performance still depends on the device and thermal state; browser emulation is not a hardware benchmark.

## Desktop controls

| Key | Action |
|---|---|
| A / D or arrow keys | Edge and turn (weight shift, so turns build up) |
| S | Snowplow (pizza) to slow down |
| W | Push off on flats; tuck when fast |
| Space | Hockey stop |
| R | Get up after a fall |
| C | Camera: chase, first person, side profile (best for judging steepness) |
| G | Launch a camera drone / return to skiing |
| M | Trail map; click a run to go to its top |
| O | Slope angle overlay (green < 15, blue 15-25, black 25-35, orange 35-45, red > 45 degrees) |
| F | Skip the rest of a lift ride |
| B | Back to the base area |
| T | Chat (multiplayer) |
| N | Sound on/off |
| H | Show/hide help |

Gamepad: left stick steers (up tucks, down brakes), A hockey stop, B get up, Y camera, RB skip lift, Start back to base.

To ride a lift, enter the loading approach facing uphill. The arriving chair picks you up when its seat reaches the backs of your legs; you do not have to snap to the red stripe or release a particular key. Your skier bends into the seat, keeps the skis on the snow until they have clearance, then rides in real time. Nominal rides take about 11:34 on Primo, 9:00 on Segundo and 9:35 on Tercero at the published line speeds; actual duration depends on where contact occurs. You unload onto the snow ramp and ski clear. Press F to skip the ride. See ACCURACY.md for the remaining geometry and operating-speed limitations.

## Explore with a friend (share a link)

1. In the start menu enter a name, pick a jacket colour and press **Create room**.
2. Press **Copy invite link**, or **Share invite** on iPhone, and send the link (it contains `?room=CODE`).
3. Your friend opens the link and presses **Join**. Up to 8 players per room.

The public client uses the hosted multiplayer service configured by `VITE_SERVER_URL`. Locally it defaults to `ws(s)://<page host>:8787`. Override with `?server=wss://your-server` or at build time with `VITE_SERVER_URL`. Drone pilots and desktop skiers share rooms; friends and map markers follow the aircraft while flying. Phone pilots do not leave a ghost skier behind.

## Build for production

```bash
npm run build          # typecheck + static client in dist/
npm run start:server   # multiplayer server (uses $PORT, default 8787)
```

## Deploy

### Client (static) on Vercel

`vercel.json` is included. With the Vercel CLI logged in:

```bash
npx vercel@latest link --project sunlight-sim
npx vercel@latest env add VITE_SERVER_URL production   # e.g. wss://sunlight-sim-server.fly.dev
npx vercel@latest deploy --prod
```

(or connect the GitHub repo in the Vercel dashboard with build command `npm run build` and output directory `dist`, and set the `VITE_SERVER_URL` environment variable).

### Multiplayer server on the mini-PC (production)

The production service is the isolated `sunlight-multiplayer` container from `hosting/compose.yaml`, listening only on `127.0.0.1:8787`. It restarts automatically. Its public WebSocket endpoint is `wss://davis-mini-pc-1.tail59b3f5.ts.net:10000/sunlight/`, through an added Tailscale Funnel path. The existing portal and other app routes remain separate.

Deploy a committed source snapshot (package manifests, tsconfig, shared, server, hosting/compose.yaml and client/public/world/resort.json), then on the mini-PC:

```bash
RELEASE_SHA=<full-commit-sha> docker compose -f hosting/compose.yaml up -d --build
# Run the host CLI through Docker when the SSH account has no passwordless sudo.
docker run --rm --network host --user 0 \
  --mount type=bind,src=/usr/bin/tailscale,dst=/usr/local/bin/tailscale,readonly \
  --mount type=bind,src=/var/run/tailscale/tailscaled.sock,dst=/var/run/tailscale/tailscaled.sock \
  sunlight-multiplayer:<full-commit-sha> /usr/local/bin/tailscale \
  funnel --bg --https=10000 --set-path=/sunlight http://127.0.0.1:8787
```

`GET https://davis-mini-pc-1.tail59b3f5.ts.net:10000/sunlight/health` reports the deployed source SHA, room/player counts and drone-only protocol support. Set the Vercel production `VITE_SERVER_URL` to the endpoint above before building the client. Verify the matching public client and server together. All deployments require committing changes, `git push origin main`, and verifying the deployed commit is on `origin/main`.

The service relies on the mini-PC and its internet connection being available. Rooms are ephemeral; clients automatically reconnect after an interruption. Existing alternatives below can host the same server.

### Alternative: Multiplayer server on Fly.io

`hosting/fly.toml` and `server/Dockerfile` are included.

```bash
brew install flyctl && fly auth login
fly launch --no-deploy --copy-config --config hosting/fly.toml --name sunlight-sim-server
fly deploy --config hosting/fly.toml
```

The server listens on `$PORT` and serves WebSocket connections on `/`. Health check: `GET /health`.

### Alternative: Render

`hosting/render.yaml` is included (Blueprint). Or create a Web Service from this repo with build command `npm install` and start command `npm run start:server`. Use the resulting `wss://<name>.onrender.com` as `VITE_SERVER_URL` for the client.

## Tests

```bash
npm test                 # unit tests: terrain data, physics, lifts, multiplayer rooms, resort data
npm run test:pipeline    # Python pipeline self-tests
npx playwright test      # browser tests: viewpoint screenshots (screenshots/), two-client multiplayer
npx tsx tests/harness/runBots.ts Midway "Sun King"   # physics harness: scripted skiers, speeds and paths
```

## Rebuild the world data

The pipeline downloads public data (about 4 GB raw, kept in `data/raw/`, gitignored) and rebuilds everything in `client/public/world`:

```bash
npm run data
```

It needs Python 3.12 (`uv` or `python3 -m venv`); `pipeline/run_all.sh` creates `.venv` and installs `pipeline/requirements.txt` if missing. No accounts or API keys are needed. Steps: OSM (Overpass), USGS 1 m DEM (TNM), 3DEP regional/far elevation, USGS lidar (EPT on AWS), NAIP (Planetary Computer), terrain pyramid, runs/lifts, canopy height model, trees, surface masks, trail map, base area, distant forest (ESA WorldCover), accuracy report.

## Project docs

Mount Sopris has a dedicated USGS 1 m elevation patch, rendered at 4 m spacing around both summits, 8 m on the upper slopes and 16 m at its apron. This detail stays enabled on every graphics preset, even from Sunlight's viewing distance. Other distant peaks retain the ordinary terrain LOD. No summit heights or ridge shapes are exaggerated. Winter snow coverage and rock coloring remain visual approximations.

Run `npm run data:sopris` to rebuild just this patch after the base terrain exists. It downloads four pinned public-domain DEM tiles (about 1 GB, cached in `data/raw/sopris/`). Run `npm run test:sopris` for asset/seam checks and independent comparisons against those native files; `.venv/bin/python pipeline/test_sopris.py --report` refreshes the numerical accuracy manifest. Committed assets include the terrain tiles, source manifest and accuracy report, so playing the game needs no USGS access.

Characters are articulated CC0 human meshes dressed in custom winter clothing and ski equipment. Their asset, license and source hash are committed under `client/public/models`; `npm run data:skier` rebuilds the model without an account. The main lodge and Brettelberg have separate architecture based on aerial/OSM footprints and reference photos. `ACCURACY.md` distinguishes lidar measurements from estimated facade and deck details.

- `SPEC.md` the build spec. `PROGRESS.md` status and next steps. `DECISIONS.md` design decisions and real-world values. `ACCURACY.md` run statistics vs DEM and published figures. `CREDITS.md` sources and licenses.

## Minimap while skiing

The upper-left minimap follows your position while skiing and riding lifts. North stays up; the cyan arrow shows your ski heading, and nearby friends use their jacket colors. The header keeps your current run or lift visible. Difficulty-colored trails, run names, lifts and a distance scale help you choose a route.

Press **V** or click the compact minimap button to hide or restore it. **+** and **−** select map widths of 1,500 ft, 3,000 ft or 6,000 ft (shown as 1.1 mi). Settings persist in this browser. **Full map (M)** opens the existing trail map for overview and travel. Clicking the minimap itself does not teleport you.

## Audio

Sound starts after the first key press or click. N toggles sound; P opens the volume control. Ski contact responds to speed, edge pressure, braking, grooming and airborne state. Lift machinery has direction and distance, while chair rollers follow tower crossings. All source recordings are CC0; credits and exact processing are in `CREDITS.md` and `client/public/audio/sources.json`.

The committed audio bank works without external requests. Rebuild it with `npm run data:audio` (Python environment above and FFmpeg; on macOS `brew install ffmpeg`). Raw recordings are cached in `data/raw/audio/`. If an individual recording cannot load, procedural audio remains available. Audio output and state transitions have dedicated unit and browser-render checks.

## Drone exploration

Click **Fly a drone** or press **G** (gamepad L3) to launch a small camera quadcopter above your skier. Press G again to return to skiing. Your skier stays parked; an occupied chair continues its normal ride and safely unloads while you explore. The minimap follows the drone and also marks your skier. Friends in a connected room can see your aircraft.

| Drone control | Action |
|---|---|
| W / A / S / D | Forward / left / back / right relative to the drone heading |
| E / Q | Climb / descend |
| Mouse drag, or arrow keys | Turn and tilt the camera |
| Double-click the game view | Capture mouse look; Escape releases it |
| Space | Brake into a stabilized hover |
| Shift / Ctrl | Fast / precision flight |
| C | Switch between stabilized FPV and chase views |
| R | Recall the drone above your skier |
| G | Return to skiing |

Gamepad: left stick moves, right stick looks, RT climbs, LT descends, A brakes, Y changes camera, B recalls, LB selects precision speed and RB selects fast speed. Menus, chat and loss of focus suspend flight input. Opening the full map still allows normal travel to a run; choosing a destination exits drone mode.

Flight stays inside the resort boundary plus a 197 ft viewing apron, with a 394 ft ceiling above local terrain. An amber grid and HUD message warn when you approach the flight limit. Snow clearance and tree, tower and building collision volumes prevent flying through the modeled terrain and solid obstacles. Distant mountain scenery remains visible from the ski area.

The original quadcopter includes counter-rotating rotors, a stabilized camera gimbal and navigation lights. Four synthesized motor/propeller voices follow rotor RPM; the existing N mute and Options volume apply to drone sound too. Speeds and clearances use the same U.S. display units as skiing. No batteries, scores or time limits interrupt exploration.
