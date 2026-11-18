"""Winter ski line and open snow at the start of Grizzly Road, in local (x, z) meters.

Sections follow the ridge visible in the 2023 NAIP orthophoto and 2016 USGS
one-meter terrain/canopy. The March 2025 skier footage corroborates the rollover,
pinch and opening onto the opposite shoulder. These are representative ski and
grooming lines. All elevations come from the DEM. See the Grizzly Road section in ACCURACY.md.
"""
import numpy as np

OSM_WAY = 99606386

# Center, skier's left, skier's right. Keep the shared Ute and Little Max junctions.
SECTIONS = [
    ((18.3, 956.3), (12.4, 947.0), (24.2, 965.6)),
    ((43.1, 939.4), (33.5, 924.2), (49.5, 949.5)),
    ((70.0, 923.5), (65.2, 915.9), (74.3, 930.3)),
    ((89.5, 913.6), (84.7, 901.5), (92.1, 920.1)),
    ((108.0, 906.1), (105.1, 898.7), (111.4, 914.5)),
    ((123.7, 899.7), (119.7, 890.5), (127.7, 908.8)),
    ((144.1, 886.4), (140.1, 877.2), (149.3, 898.3)),
    ((156.6, 877.7), (153.9, 871.2), (163.8, 894.2)),
    ((166.0, 874.1), (163.8, 869.1), (173.4, 891.1)),
    ((177.8, 873.3), (174.3, 868.4), (185.9, 884.8)),
    ((191.5, 868.5), (189.2, 865.2), (196.2, 875.0)),
    ((206.0, 859.5), (202.0, 853.8), (210.6, 866.0)),
    ((219.9, 849.7), (216.4, 844.8), (225.1, 857.0)),
    ((232.1, 840.8), (226.2, 834.0), (236.7, 846.1)),
    ((242.7, 831.7), (234.2, 821.9), (247.9, 837.7)),
    ((249.8, 821.6), (241.9, 812.5), (257.0, 829.9)),
    ((256.3, 810.7), (249.7, 803.1), (266.1, 822.0)),
    ((265.0, 797.8), (258.4, 790.3), (276.8, 811.4)),
    ((277.9, 786.7), (269.8, 775.3), (290.0, 803.9)),
    ((293.5, 779.4), (280.8, 761.4), (307.4, 799.0)),
    ((312.9, 770.5), (296.8, 747.6), (325.7, 788.5)),
    ((343.6, 753.7), (325.1, 727.6), (354.0, 768.4)),
]

# The groomed opening tapers back to the ordinary road along its existing line.
LEFT_EDGE = [s[1] for s in SECTIONS] + [(352.5, 730.4), (373.1, 719.5)]
RIGHT_EDGE = [s[2] for s in SECTIONS] + [(367.8, 750.2), (384.1, 733.8)]
OPENING = LEFT_EDGE + RIGHT_EDGE[::-1]

# Common snow between the modeled Primo exit and the signed Ute / Grizzly fork.
SUMMIT_APRON = [(-4, 1005), (4, 1010), (12, 1001), (18, 985), (25, 964),
                (35, 948), (18, 939), (4, 958), (-1, 978), (-4, 994)]


def refine_centerline(points, height):
    centers = np.array([s[0] for s in SECTIONS])
    mapped = np.array(points)[:, [0, 2]]
    distance = np.linalg.norm(mapped - centers[-1], axis=1)
    join = int(np.argmin(distance))
    if distance[join] > 2 or np.linalg.norm(mapped[0] - centers[0]) > 2:
        raise ValueError("Grizzly Road junction moved in the imported map; reconcile the ridge trace")
    elevations = height(centers[:, 0], -centers[:, 1])
    ridge = [[float(x), round(float(y), 1), float(z)] for (x, z), y in zip(centers, elevations)]
    return ridge + points[join + 1:]


def accuracy_section(samples, height):
    x, z, game = np.array([[s["x"], s["z"], s["height"]] for s in samples]).T
    native = height(x, -z)
    pitch = lambda h: np.degrees(np.arctan((h[10:] - h[:-10]) / 10))
    # Windows identify the first saddle and the crest immediately beyond it.
    bottom = 220 + np.argmin(native[220:280])
    crest = bottom + np.argmax(native[bottom:330])
    brow = np.argmin(np.hypot(x - 156.6, z - 877.7))
    game_angle, native_angle = pitch(game), pitch(native)
    lines = [
        "## Grizzly Road below the Primo summit\n",
        "Horizontal distances start at the signed Ute / Grizzly Road fork. The line follows the open shoulder into the narrow saddle, then climbs back onto the ridge. The lower line along the side of the clearing is also skiable. The shared approach from the Primo unload is packed snow.\n",
        "| On the ski line | Distance from fork | Game elevation | Native USGS elevation |",
        "|---|---:|---:|---:|",
    ]
    for label, i in [("Trail fork", 0), ("Roll above the saddle", brow), ("Low point", bottom), ("Return crest", crest)]:
        lines.append(f"| {label} | {i} m | {game[i]:.2f} m | {native[i]:.2f} m |")
    down = -native_angle[brow:bottom].min()
    up = native_angle[bottom:crest].max()
    lines += [
        f"\nFrom the roll to the low point the line drops {native[brow]-native[bottom]:.1f} m, then rises {native[crest]-native[bottom]:.1f} m. The steepest full 10 m on these faces measure {down:.1f}° downhill and {up:.1f}° uphill.",
        f"The maximum difference between the game and the native raster at {len(game)} one-meter stations is {np.abs(game-native).max():.3f} m in elevation and {np.abs(game_angle-native_angle).max():.2f}° in signed 10 m pitch.",
        "The ski line and grooming limits are estimates from the 2023 NAIP clearing and lidar canopy. Seasonal snow depth and the winter groomer's exact line are unmeasured. [USGS 1 m elevation tile](https://www.sciencebase.gov/catalog/item/5eaa4a5c82cefae35a21f08c) · [USDA NAIP aerial imagery](https://planetarycomputer.microsoft.com/dataset/naip) · [Sunlight trail map](https://sunlightmtn.com/explore/trail-maps/) · [March 2025 skier footage, 0:54 to 1:12](https://www.youtube.com/watch?v=3abiGYPLiOU&t=54s)\n",
    ]
    return lines
