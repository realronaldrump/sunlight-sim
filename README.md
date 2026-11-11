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

An iPhone always starts as a drone in first-person view. Skiing, walking and lift boarding are unavailable, including with an attached keyboard or gamepad. Portrait and landscape both work.

- **Drag one finger** anywhere on the scenery to aim.
- **Add a second finger** while aiming to fly forward. Aim up to climb or down to descend.
- **Touch with two fingers together** to fly backward. Lift either finger to hover.
- The small **⋯** menu contains map, view, chat, sharing, recall and settings.
- Changing orientation, leaving the page, opening a panel or losing the room connection clears the gesture.

Flight follows the viewing direction at up to 6 m/s (about 13 mph), with the existing terrain and altitude limits.

Graphics use a phone-sized rendering budget, antialiasing, shorter tree detail range and no shadows. The hidden minimap does not repaint. Real terrain and Mount Sopris detail remain. Browser emulation verifies controls and layout, not physical iPhone GPU or thermal performance.

## Desktop controls

Start on skis just west of the main lodge deck, beside a ski rack. Press W to push off, then ski down to Segundo or Tercero. Use **Teleport to base** in the pause menu to return to the racks. Primo loads farther up the mountain.

| Key | Action |
|---|---|
| A / D or arrow keys | Edge and turn (weight shift, so turns build up) |
| S | Snowplow (pizza) to slow down |
| W | Push off on flats; tuck when fast |
| Space | Hockey stop. On a chairlift: stand up on the unload ramp at the top (too early warns once, then you jump off and fall) |
| R | Get up after a fall |
| C | Camera: chase, first person, side profile (best for judging steepness) |
| G | Launch a camera drone / return to skiing |
| M | View the trail map |
| O | Slope angle overlay (green < 15, blue 15-25, black 25-35, orange 35-45, red > 45 degrees) |
| F | Cycle the occupied lift through 1×, 2×, 4×, 8× and 16× speed |
| L | Tag along with the Snowriders' Club lesson when you are near them (again to leave) |
| 1 / 2 | Wave / point downhill (friends see it and are told which run you point down) |
| Q / right click | Toss a snowball. Look toward a nearby skier for a little aim assist |
| K | Step out of / click into your skis; at a lodge ski rack, leave or pick up your skis |
| E | On foot: sit at a free table or bench, or stand up |
| Esc / P | Pause menu: ski log, teleport destinations, clock, weather and options |
| T | Chat (multiplayer) |
| N | Sound on/off |
| H | Show/hide help |

Gamepad: left stick steers (up tucks, down brakes), A hockey stop, B get up, Y camera, LB throws a snowball, Start opens the pause menu.

**Snowball fights happen wherever you ski.** Press Q, right click, or tap LB to toss one at a friend or an ordinary NPC skier. The small ring shows who you are aiming at. Snowballs arc through the air and break against snow, trees, walls or skiers. A hit sends the skier tumbling into a yard sale, with skis and poles flying and skittering across the snow. Your downhill momentum carries you into the slide. Once you stop, press R to get up and gather your gear. NPCs recover by themselves and may boop you right back. There is a brief packing pause between throws, unlimited snow and no score or match to join. In multiplayer everyone shares the same slope NPCs, throws and knockdowns. Lift riders, people on foot and drone pilots sit out the fight.

Teleportation is available only in the pause menu: return to base, choose a run or friend on the travel map, or recall your drone. B has no binding. The normal map is for navigation and inspection.

Listen for sleigh bells and look for gold flecks in Santa's ski tracks. When he hangs a star, lights climb the fir's branches and stay lit for 25 minutes of world time. His tracks last 15 minutes. Walk or ski near a decorated fir to hear it chime, and press **1** when prompted to wave to Santa. He can slow to a stop on gentle snow and tip his hat back.

**Show Santa on map** in the pause menu or iPhone Flight menu adds his live position, recent tracks and decorated firs. It starts off and saves in your browser. A close, clear in-world sighting earns the Santa Sighting badge.

In drone mode, **Show my skier** adds an optional marker that tracks your skier on the moving chair, with distance and an off-screen direction cue. Toggle it off for an unobstructed view.

To ride a lift, enter the loading approach facing uphill. The arriving chair picks you up when its seat reaches the backs of your legs; you do not have to snap to the red stripe or release a particular key. Your skier bends into the seat, keeps the skis on the snow until they have clearance, then rides in real time. Nominal rides take about 11:34 on Primo, 9:00 on Segundo and 9:35 on Tercero at the published line speeds; actual duration depends on where contact occurs. You unload onto the snow ramp and ski clear. Choose 1×, 2×, 4×, 8× or 16× in the lift-speed controls, or press F to cycle through them. Only the occupied lift speeds up: other lifts, skiers, drone flight, scenery and daylight keep their normal timing. Speed resets at unloading, on pause, and on focus loss. In multiplayer the selected lift is shared, so its chairs and all riders stay synchronized. See ACCURACY.md for the remaining geometry and operating-speed limitations.

## A living resort

- **The same people everywhere.** The people waiting in a lift line board the chairs you watch, ride up in their own jackets and helmets, ski off the top and line up again after their run.
- **Snowriders' Club.** An instructor and five kids in numbered orange bibs line up by the lodge, take Segundo and ski Segundo Road and Ute home, stopping to regroup. Press L near them to tag along: a panel shows where the group is headed, the instructor's tips appear as captions and the trail map draws the route. Solo, they wait for you if you fall behind.
- **Mountain status board** by the lesson line-up: snowfall, base, lifts, overnight grooming and when the lesson leaves.
- **Snow that remembers.** Everyone's tracks last across laps, busy groomed lines wear to polished, slightly faster hardpack while their edges stay soft, new snow fills tracks and hides wear, and snowcats with headlights restore corduroy after last chair. The snow is saved in your browser: come back the same day and your tracks are there; come back after a night and the groomers (and any storm) have been.
- **Resort Day or Free Explore** (pause menu, Clock). Free Explore keeps the time you choose and runs the lifts at any hour. Resort Day runs a shared day (an hour every six minutes): lifts load 9 AM to 4 PM, the crowd follows the hour, ski patrol sweeps at closing and ropes off the runs, and the cats come out at dusk under a moonlit, starry sky.
- **Weather** (pause menu): Changing sends snow squalls drifting through on the shared clock; one can hide Mount Sopris from the summit and later reveal it, and when one passes over you the sky greys and it snows. Clear and Light snow are also available.
- **With friends.** Rack your skis, sit together on the deck, wave and point downhill. Friends see you walking in ski boots or seated at the table.
- **Snowball fights.** Boop a friend or slope skier with Q, right click or LB. Hits cause a tumble and a flying yard sale. NPCs can recover and throw back.
- **Get off the lift yourself.** Press Space (or the Stand up button) on the unload ramp at the top. Stay seated and the skis clip the missed-unload gate, the chair whirls you twice round the bull wheel and flings you into a yard sale. Press too early and, after one warning, you jump off and fall. Auto disembark is an option in the pause menu.
- **Sound of a place.** The lodge has room tone, conversation, cups and the espresso machine; aspen groves hush the wind; exposed ridges gust.
- **Ski log** (pause menu): session, today and all-time distance, vertical, time skiing and on lifts, speeds and ski days; every descent with its line and an elevation and speed profile; and a mountain map of trails not yet skied, partly skied and completed, with laps.

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

Deploy a committed source snapshot containing the package manifests, TypeScript config, `shared/`, `server/`, `hosting/compose.yaml` and the world and terrain files listed in `server/Dockerfile`. The Compose volume saves the roaming guest's room state across restarts. Then run on the mini-PC:

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

The service relies on the mini-PC and its internet connection being available. Clients automatically reconnect after an interruption. The roaming skier resumes from the saved room checkpoint, even after the room empties. Existing alternatives below can host the same server.

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

Choose **Map only** to hide the header, trail key and zoom controls while keeping the live map on screen. Choose **Details** to bring them back. **V** hides or restores the whole minimap. **+** and **−** select map widths of 1,500 ft, 3,000 ft or 6,000 ft (shown as 1.1 mi). Settings persist in this browser. **M** opens the full trail map. Use the pause menu for teleport destinations. Clicking the minimap itself does not teleport you.

## Chairlift easter egg

On a chair, WASD or the arrow keys shift your weight. A small lean settles; repeated rocking in time with the swing can make you lose your seat. The chair creaks under motion, and a fall carries your momentum into freefall and the terrain landing. Once you stop sliding, press **R** to get up and ski from there. Chair motion and falls are visible in multiplayer. The fall threshold and recovery are gameplay approximations.

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
| Esc / P | Pause menu, including drone recall and teleport destinations |
| G | Return to skiing |

Gamepad: left stick moves, right stick looks, RT climbs, LT descends, A brakes, Y changes camera, LB selects precision speed and RB selects fast speed. Menus, chat and loss of focus suspend flight input. Choose teleport destinations through the pause menu; travel to a run exits desktop drone mode.

Flight stays inside the resort boundary plus a 197 ft viewing apron, with a 394 ft ceiling above local terrain. An amber grid and HUD message warn when you approach the flight limit. Snow clearance and tree, tower and building collision volumes prevent flying through the modeled terrain and solid obstacles. Distant mountain scenery remains visible from the ski area.

The original quadcopter includes counter-rotating rotors, a stabilized camera gimbal and navigation lights. Four synthesized motor/propeller voices follow rotor RPM; the existing N mute and Options volume apply to drone sound too. Speeds and clearances use the same U.S. display units as skiing. No batteries, scores or time limits interrupt exploration.

### Rebuild the Santa portrait asset

The game ships the generated head mesh and textures. To recreate them from the pinned sources with Python 3.12:

```bash
python3.12 -m venv data/raw/santa-likeness/.venv
data/raw/santa-likeness/.venv/bin/pip install -r pipeline/requirements-santa.txt
data/raw/santa-likeness/.venv/bin/python pipeline/build_santa_likeness.py
```
