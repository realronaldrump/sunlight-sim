"""Shared configuration for the Sunlight data pipeline."""
import pathlib
ROOT = pathlib.Path(__file__).resolve().parent.parent
RAW = ROOT / "data" / "raw"
PROC = ROOT / "data" / "processed"
PUBLIC = ROOT / "client" / "public" / "world"

# Projected CRS: NAD83 / UTM zone 13N (meters). All game coordinates are local offsets from ORIGIN.
CRS = "EPSG:26913"
# Local origin (UTM 13N easting, northing) near the middle of the ski area, rounded.
ORIGIN_E = 298500.0
ORIGIN_N = 4362800.0

# 1 m area: resort (runs + lifts) extent plus ~1 km margin, in UTM, snapped to 256 m tiles around origin.
# Resort extent (OSM downhill+lifts): E 297550..299548, N 4361798..4363906
HI_MIN_E = ORIGIN_E - 2048 - 256   # 296196
HI_MAX_E = ORIGIN_E + 2048         # 300548
HI_MIN_N = ORIGIN_N - 2048         # 4360752
HI_MAX_N = ORIGIN_N + 2048 + 256   # 4365104

# Lidar query bbox (lon/lat)
LIDAR_BBOX = (-107.372, 39.364, -107.302, 39.418)
# Regional 10 m area half-size (m) and far 30 m area half-size (m) around origin
REGION_HALF = 16384
FAR_HALF = 65536
