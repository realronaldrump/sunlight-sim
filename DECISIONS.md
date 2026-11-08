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
