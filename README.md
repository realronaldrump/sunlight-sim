# Sunlight Mountain Simulator

A browser-based, open-world, multiplayer ski simulator of one mountain: **Sunlight Mountain Resort, Glenwood Springs, Colorado**. Built so a beginner can learn the real mountain before skiing it: which runs go where, how steep each section really is, where lifts load and unload, and what the views look like.

- Terrain from the USGS 1 m lidar DEM across the resort, real surrounding terrain out to 65 km (Mount Sopris, the Elk Range, the Roaring Fork and Colorado River valleys).
- About 244,000 trees placed from the lidar canopy height model, species from aerial imagery (spruce/fir, Douglas-fir, bare aspen, Gambel oak).
- All 75 runs on the official trail map with official names and difficulty, run boundaries from the lidar tree gaps, signs at every run entrance.
- Primo, Segundo and Tercero chairlifts on their real lines with OSM tower positions, moving chairs, real-time rides.
- Physically based ski model (edging and sidecut carving, skidding, snowplow, tuck, drag, falls).
- Multiplayer rooms by link, shared chairs, chat, trail map with other players.
- All in-game measurements use U.S. units: speed in mph, elevation in feet, and lift distances and trail lengths in feet or miles.

**Play now (solo):** https://sunlight-sim.vercel.app  (the multiplayer server is not hosted yet; see Deploy below. Multiplayer works locally and on a LAN.)

## Run it locally

Requirements: Node 20.19+ (or 22+). A desktop browser with WebGPU (Chrome or Safari on macOS) or WebGL2.

```bash
npm install && npm run dev
```

Open the printed URL (http://localhost:5173). `npm run dev` starts both the client (Vite, port 5173) and the multiplayer server (port 8787). On your LAN, friends can open `http://<your-ip>:5173`.

All game-ready world data is committed under `client/public/world`, so no data download is needed to play.

## Controls

| Key | Action |
|---|---|
| A / D or arrow keys | Edge and turn (weight shift, so turns build up) |
| S | Snowplow (pizza) to slow down |
| W | Push off on flats; tuck when fast |
| Space | Hockey stop |
| R | Get up after a fall |
| C | Camera: chase, first person, side profile (best for judging steepness) |
| M | Trail map; click a run to go to its top |
| O | Slope angle overlay (green < 15, blue 15-25, black 25-35, orange 35-45, red > 45 degrees) |
| F | Skip the rest of a lift ride |
| B | Back to the base area |
| T | Chat (multiplayer) |
| N | Sound on/off |
| H | Show/hide help |

Gamepad: left stick steers (up tucks, down brakes), A hockey stop, B get up, Y camera, RB skip lift, Start back to base.

To ride a lift, approach the red load line slowly, face uphill, release the push/turn controls, and wait. A short alignment assist places you in a seat lane. The next chair picks you up at its actual arrival; rides take about 11:34 on Primo, 9:00 on Segundo and 9:34 on Tercero at the published line speeds. You automatically stand onto the snow exit ramp at the top and ski clear. Press F only if you want to skip the ride. See ACCURACY.md for geometry and operating-speed limitations.

## Ski with a friend (share a link)

1. In the start menu enter a name, pick a jacket colour and press **Create room**.
2. Press **Copy invite link** (top left) and send the link (it contains `?room=CODE`).
3. Your friend opens the link and presses **Join**. Up to 8 players per room.

The client connects to the multiplayer server at `ws(s)://<page host>:8787` by default. Override with `?server=wss://your-server` or at build time with `VITE_SERVER_URL`.

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

### Multiplayer server on Fly.io

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

Characters are articulated CC0 human meshes dressed in custom winter clothing and ski equipment. Their asset, license and source hash are committed under `client/public/models`; `npm run data:skier` rebuilds the model without an account. The main lodge and Brettelberg have separate architecture based on aerial/OSM footprints and reference photos. `ACCURACY.md` distinguishes lidar measurements from estimated facade and deck details.

- `SPEC.md` the build spec. `PROGRESS.md` status and next steps. `DECISIONS.md` design decisions and real-world values. `ACCURACY.md` run statistics vs DEM and published figures. `CREDITS.md` sources and licenses.

## Minimap while skiing

The upper-left minimap follows your position while skiing and riding lifts. North stays up; the cyan arrow shows your ski heading, and nearby friends use their jacket colors. The header keeps your current run or lift visible. Difficulty-colored trails, run names, lifts and a distance scale help you choose a route.

Press **V** or click the compact minimap button to hide or restore it. **+** and **−** select map widths of 1,500 ft, 3,000 ft or 6,000 ft (shown as 1.1 mi). Settings persist in this browser. **Full map (M)** opens the existing trail map for overview and travel. Clicking the minimap itself does not teleport you.

## Audio

Sound starts after the first key press or click. N toggles sound; P opens the volume control. Ski contact responds to speed, edge pressure, braking, grooming and airborne state. Lift machinery has direction and distance, while chair rollers follow tower crossings. All source recordings are CC0; credits and exact processing are in `CREDITS.md` and `client/public/audio/sources.json`.

The committed audio bank works without external requests. Rebuild it with `npm run data:audio` (Python environment above and FFmpeg; on macOS `brew install ffmpeg`). Raw recordings are cached in `data/raw/audio/`. If an individual recording cannot load, procedural audio remains available. Audio output and state transitions have dedicated unit and browser-render checks.
