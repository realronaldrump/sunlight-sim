# Credits and licenses

Every data source and asset used by Sunlight Mountain Simulator. Official resort photographs and trail-map images are reference only and are not shipped.

## Data (processed into client/public/world)

| Data | Source | License | Use |
|---|---|---|---|
| 1 m bare-earth DEM (CO_Central_Western_2016, tiles x29y437 and x30y437) | U.S. Geological Survey, 3D Elevation Program, via The National Map (TNM Access API) | Public domain (U.S. Government work) | Terrain within the resort plus about 1 km margin |
| Mount Sopris 1 m bare-earth DEM (CO_SanLuisJuanMiguel_2020_D20, x30y435, x30y436, x31y435, x31y436) | [USGS 3DEP](https://www.usgs.gov/3d-elevation-program), [summit tile metadata](https://www.sciencebase.gov/catalog/item/62172161d34ec739b2dbf6f4) | Public domain (U.S. Government work) | Dedicated measured summit, ridges and gullies; source URLs and SHA-256 hashes in `client/public/world/terrain/sopris.json` |
| Lidar point cloud (USGS_LPC_CO_Central_Western_2016) | USGS 3DEP via the public Entwine Point Tile copy on AWS (s3://usgs-lidar-public) | Public domain | Canopy height model, every tree position and height |
| 1/3 arc-second (about 10 m) elevation | USGS 3DEP ImageServer (elevation.nationalmap.gov) | Public domain | Regional and far terrain to the horizon |
| NAIP aerial imagery 2023 (Colorado, 0.3 m) | USDA Farm Service Agency, via Microsoft Planetary Computer | Public domain | Guide only: tree species (aspen vs conifer), parking lots. Not used as a texture |
| ESA WorldCover 10 m 2021 v200 | European Space Agency (esa-worldcover on AWS) | CC BY 4.0, "ESA WorldCover project 2021 / Contains modified Copernicus Sentinel data (2021) processed by ESA WorldCover consortium" | Forest cover on distant terrain |
| Runs, lifts, pylons, buildings, roads, ski area boundary, peaks | OpenStreetMap contributors, via the Overpass API | ODbL 1.0, "© OpenStreetMap contributors" | Geometry and positions |
| Official trail map and East Ridge map 2024-25 | Sunlight Mountain Resort (sunlightmtn.com) | Copyright Sunlight Mountain Resort. Reference only, not shipped | Verifying run names, difficulty, lifts |
| Lift history and specs | sunlightmtn.com, Post Independent, liftblog.com, SnowBrains (news articles) | Reference only | Lift types (Primo quad, Segundo and Tercero triples) |

## Code libraries

| Library | License |
|---|---|
| three.js 0.187 (WebGPURenderer, TSL, SkyMesh, CSMShadowNode, BufferGeometryUtils) | MIT |
| ws 8 | MIT |
| Vite, TypeScript, tsx, concurrently, Vitest, Playwright | MIT / Apache-2.0 |
| Python: numpy, scipy, rasterio (GDAL), pyproj, shapely, laspy + lazrs, scikit-image, Pillow, requests | BSD / MIT / Apache-2.0 |

## Art and audio

- Skier anatomy: [Human base mesh with editable 53-bone rig](https://www.innerscene.com/tools/library/3d-parts/human-base-mesh-with-editable-53-bone-rig-8e7c8ab1), built by Innerscene from MakeHuman/MPFB assets, [CC0 1.0](https://creativecommons.org/publicdomain/zero/1.0/). The derived winter-clothed body is in `client/public/models/skier-human.json.gz`, with its license beside it. Source SHA-256 is pinned in `pipeline/build_skier.ts`; rebuild with `npm run data:skier`.
- Ski clothing modifications, helmets, goggles, boots, skis, bindings, poles, chairlifts, towers, buildings, signs, conifer/aspen/oak models, branch and impostor textures: original procedural work in this repository.
- Sky: three.js SkyMesh (Preetham analytic daylight model), MIT.
- Audio: CC0 field-recorded textures and original procedural airflow/contact Foley, detailed below.

## Mount Sopris reference

Mount Sopris silhouette reference: [Davis's photograph from Sunlight, posted to r/Colorado on October 7, 2020](https://www.reddit.com/r/Colorado/comments/j6qz9a/the_peak_of_mt_sopris_from_sunlight_mountain/). Davis confirmed authorship in this work session. Reference only, not shipped or used as a texture.

## Building reference material

- Main lodge roof outline: USDA NAIP 2023 (public domain), traced in the local resort coordinate system. Roof elevation comes from the existing public-domain USGS lidar canopy-plus-ground surface. The trace and sampling bounds are in `pipeline/build_structures.py`.
- Main lodge facade and deck: [Sunlight Mountain Resort venue photographs](https://www.eventective.com/glenwood-springs-co/sunlight-mountain-resort-117597.html), [Sunlight Mountain exterior](https://www.lugaresdenieve.com/?q=es/estacion/sunlight-mountain), and the [resort's dining page](https://sunlightmtn.com/explore/glenwood-springs-dining/). Copyright remains with the photographers/publishers. Reference only; no photographs are distributed.
- Brettelberg facade and galleries: [Brettelberg's property history and photos](https://www.brettelberg.com/about), cross-checked with [Colorado Ski Authority's lodging photos](https://coloradoskiauthority.com/sunlight-mountain/lodging/). Copyright remains with the owners. Reference only; geometry and materials are authored in code.

## Snow surface assets

- Snow 02 by Rob Tuytel, [Poly Haven](https://polyhaven.com/a/snow_02), [CC0 1.0](https://polyhaven.com/license). The 2 m scan supplies displacement, bump, roughness and ambient-occlusion data. `pipeline/build_snow.py` losslessly packs the four 2K source maps into `client/public/textures/snow/snow-detail.webp`; provenance and SHA-256 hashes are in `source.json` alongside it. Rebuild with `npm run data:snow`. The terrain uses these as shading detail only.
- Corduroy, grooming overlaps, wind relief, snow crystal reflections, ski grooves, ski spray and snowfall: original procedural code in this repository.

## Audio sources

All recordings below are [CC0 1.0](https://creativecommons.org/publicdomain/zero/1.0/), verified on their original pages on November 8, 2026. Freesound sources use the publicly available high-quality MP3 preview, not the login-only WAV. They are not recordings of Sunlight.

| Recording | Creator and source | Use and edits |
|---|---|---|
| Alpine_ski_POV - - Stereo Out.wav | [Lydmakeren](https://freesound.org/people/Lydmakeren/sounds/567839/) | Actual groomed-slope ski contact; filtered, overlapping short grains remove recorded turn timing; separate glide and edge beds |
| remontee mecanique ski moteur.wav | [indieground](https://freesound.org/people/indieground/sounds/223829/) | Lift terminal motor; mono crop, filtering, seamless wrap crossfade |
| ski_lift.wav | [13FPanska_Marval_Lukas](https://freesound.org/people/13FPanska_Marval_Lukas/sounds/379326/) | Mechanical cable texture close to stations; filtered, mono, crossfaded |
| Winter Snowstorm Ambience | [HECKFRICKER](https://freesound.org/people/HECKFRICKER/sounds/754256/) | A quiet stereo excerpt for winter air; rumble removed, crossfaded, mixed softly |
| 4 dry snow steps | [Iwan "qubodup" Gabovitch](https://opengameart.org/content/4-dry-snow-steps) | Real snow compression for landings/falls and granular soft-snow displacement; trimmed and filtered |

- Original seeded chair contacts, friction creaks and procedural airflow are dedicated to CC0. No voice or music assets are used.
- `pipeline/build_audio.py` rebuilds 14 PCM WAVs with NumPy, SciPy and FFmpeg. Run `npm run data:audio`; macOS needs `brew install ffmpeg` if it is not installed. Source downloads are cached in gitignored `data/raw/audio/`. Committed game-ready audio is 5.73 MiB and is fetched only after the audio gesture, independently of world loading.
- Places (November 9, 2026): the lodge's room tone, conversation, cups, register, grinder and steam wand, ski boots on wooden floors, aspen branch knocks and the ridge whistle are original deterministic synthesis in `client/src/audio/ambienceSynth.ts` (formant-filtered talkers, inharmonic partials, resonant noise), dedicated CC0. Snowcats reuse the CC0 lift-machinery recording, pitched down. They are designed approximations, not recordings of Sunlight's lodge.
- `client/public/audio/sources.json` records source URLs, author, license, SHA-256, crop/processing steps, output hashes, duration, RMS and peak. The transformed textures preserve source detail but are artistic approximations of snow and machinery, not measurements of this resort's acoustics.

## Camera drone
- Quadcopter body, arms, motors, two-blade propellers, gimbal, lens, landing feet, LEDs and flight-boundary graphics: original procedural geometry in `client/src/drone/`. No third-party drone model, texture, logo or recording is shipped.
- Motor and propeller Foley: original Web Audio synthesis in `client/src/drone/droneAudio.ts`, using RPM-dependent blade-passage harmonics and seeded stereo noise. Existing environmental recordings retain their credits above.
- Reference only: DJI Mini 4 Pro official specifications, https://www.dji.com/mini-4-pro/specs (normal/sport/vertical speed envelope; consulted November 8, 2026). The in-game aircraft is an original generic model, not a branded replica. Three.js and Web Audio APIs retain the existing software licenses.

## Lift chair reconstruction
- Chair geometry, numbered plates, zinc/vinyl surface textures and restraint animation are original procedural assets generated by this project in `client/src/lifts/chairModel.ts`.
- Reference only, not redistributed: Peter Landsman's Lift Blog Sunlight inventory and chair photographs. [Primo, March 2026](https://liftblog.com/primo-sunlight-co-2/), [Segundo, March 2026](https://liftblog.com/segundo-sunlight-co-2/), [Tercero, September 2016](https://liftblog.com/tercero-sunlight-co/), [specification inventory](https://liftblog.com/sunlight-co/). Sunlight's [official lift replacement announcement](https://sunlightmtn.com/blog/lift-replacement-project/) confirms the modern Primo/Segundo configuration.

## Winter trees
- Aspen bark, twig sprig cards, impostor drawings and all tree geometry are original procedural assets generated by this project in `client/src/trees/aspen.ts` and `client/src/trees/treeAssets.ts`. No third-party tree models or textures are shipped.
- Reference only: Sunlight lift photographs cached under `data/raw/reference/` (aspen and conifer mix, winter crown colour). General species form follows USDA Forest Service Fire Effects Information System descriptions of Populus tremuloides.

## Lift towers, terminals and operator huts
- All tower, terminal, bullwheel, sheave and hut geometry and textures are original procedural assets in `client/src/lifts/liftStructures.ts`. Logo end caps use a generic red mark, not a manufacturer logo.
- Reference only, not redistributed: Lift Blog photo surveys of [Primo](https://liftblog.com/primo-sunlight-co-2/) and [Segundo](https://liftblog.com/segundo-sunlight-co-2/) (March 2026) and [Tercero](https://liftblog.com/tercero-sunlight-co/) (September 2016).

## Base-area crowds
- `client/public/models/skier-human-crowd.json.gz` is a simplification of the CC0 MakeHuman/MPFB winter human already credited above, produced by `pipeline/build_crowd_human.ts` with [meshoptimizer](https://github.com/zeux/meshoptimizer) 1.1.1 (MIT licence, build-time only). The CC0 dedication of the character is unchanged.
- Crowd behaviour, knit beanies, lift-maze posts and ropes are original code in `client/src/world/`.
- The lodge sign walker uses the CC0 anatomical rig with original clothing, hair, glasses and boots. The in-game sign is vector artwork traced from an owner-supplied photo and checked against the second reference. The photos are reference material only.

## Lift structural follow-up
- Original procedural rope, bullwheel channels, sheave alignment, Riblet tension carriage/counterweight and drive-vault exterior. Dimensions are estimated from reference imagery, not factory models.
- Reference only: [Lift Blog's Tercero survey](https://liftblog.com/tercero-sunlight-co/), especially the top station, counterweight and lower vault drive photos. Images are cached privately for comparison and are not redistributed with the app.
