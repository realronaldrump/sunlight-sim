# Credits and licenses

Every data source and asset used by Sunlight Mountain Simulator. Nothing copyrighted is shipped: official resort materials were used for reference only.

## Data (processed into client/public/world)

| Data | Source | License | Use |
|---|---|---|---|
| 1 m bare-earth DEM (CO_Central_Western_2016, tiles x29y437 and x30y437) | U.S. Geological Survey, 3D Elevation Program, via The National Map (TNM Access API) | Public domain (U.S. Government work) | Terrain within the resort plus about 1 km margin |
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

- Skier character, chairlifts, towers, buildings, signs, conifer/aspen/oak models, branch and impostor textures: generated procedurally in code in this repository (no external assets).
- Sky: three.js SkyMesh (Preetham analytic daylight model), MIT.
- Audio: every sound (wind, ski on snow, lift hum, chair creak and clunk, falls) is synthesized at runtime with the WebAudio API from noise and oscillators. No recorded samples are used.

## Snow surface assets

- Snow 02 by Rob Tuytel, [Poly Haven](https://polyhaven.com/a/snow_02), [CC0 1.0](https://polyhaven.com/license). The 2 m scan supplies displacement, bump, roughness and ambient-occlusion data. `pipeline/build_snow.py` losslessly packs the four 2K source maps into `client/public/textures/snow/snow-detail.webp`; provenance and SHA-256 hashes are in `source.json` alongside it. Rebuild with `npm run data:snow`. The terrain uses these as shading detail only.
- Corduroy, grooming overlaps, wind relief, snow crystal reflections, ski grooves, ski spray and snowfall: original procedural code in this repository.
