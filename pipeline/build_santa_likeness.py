"""Bake the reference-fitted Santa head. Run with pipeline/requirements-santa.txt.

MediaPipe measures the portrait and supplies the base facial topology. The face
uses portrait UVs with low-frequency illumination removed. The scalp, posterior
skull and neck transition are modeled, with ears from the existing CC0 ski rig.
"""

import gzip
import hashlib
import json
import urllib.request
from pathlib import Path

import mediapipe as mp
import numpy as np
from PIL import Image, ImageDraw
from scipy.ndimage import distance_transform_edt, gaussian_filter

ROOT = Path(__file__).resolve().parents[1]
CACHE = ROOT / 'data/raw/santa-likeness'
OUT = ROOT / 'client/src/world/assets/santa-face'
PORTRAIT = (
    'https://www.whitehouse.gov/wp-content/uploads/2025/06/President-Donald-Trump-Official-Presidential-Portrait.png',
    '6a8c6ad2fae3ca32fd43454cc788a91683f513a0a830fa4539ecb405b661e562',
)
CANONICAL = (
    'https://raw.githubusercontent.com/google-ai-edge/mediapipe/v0.10.32/mediapipe/modules/face_geometry/data/canonical_face_model.obj',
    '8bac80443397e113f41a8b565ea72c59390bc031d9defab289dba7bc0c54e618',
)
LANDMARKER = (
    'https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task',
    '64184e229b263107bc2b804c6625db1341ff2bb731874b0bcc2fe6544e0bc9ff',
)

# MediaPipe face outline in perimeter order. Camera image: clockwise from the
# forehead down the subject's left side, around the chin and back to the top.
OUTLINE = [10, 338, 297, 332, 284, 251, 389, 356, 454, 323, 361, 288,
           397, 365, 379, 378, 400, 377, 152, 148, 176, 149, 150, 136,
           172, 58, 132, 93, 234, 127, 162, 21, 54, 103, 67, 109]
EYES = [
    [33, 246, 161, 160, 159, 158, 157, 173, 133, 155, 154, 153, 145, 144, 163, 7],
    [263, 466, 388, 387, 386, 385, 384, 398, 362, 382, 381, 380, 374, 373, 390, 249],
]


def source(name, spec):
    url, digest = spec
    path = CACHE / name
    if not path.exists():
        request = urllib.request.Request(url, headers={'User-Agent': 'Sunlight Simulator asset pipeline'})
        with urllib.request.urlopen(request, timeout=60) as response:
            path.write_bytes(response.read())
    if hashlib.sha256(path.read_bytes()).hexdigest() != digest:
        raise ValueError(f'{name} differs from the pinned reference')
    return path


def measure(image, task):
    options = mp.tasks.vision.FaceLandmarkerOptions(
        base_options=mp.tasks.BaseOptions(model_asset_path=str(task)),
        output_facial_transformation_matrixes=True,
    )
    with mp.tasks.vision.FaceLandmarker.create_from_options(options) as detector:
        result = detector.detect(mp.Image(image_format=mp.ImageFormat.SRGB, data=np.asarray(image)))
    if len(result.face_landmarks) != 1:
        raise ValueError('Expected one face in the portrait')
    raw = np.array([[p.x, p.y, p.z] for p in result.face_landmarks[0]])
    pixels = raw * [image.width, image.height, image.width]
    # Remove camera roll, tilt and small yaw in the model, retaining original
    # image coordinates as UVs. X and Z are flipped for the skier's -Z front.
    u, _, vh = np.linalg.svd(result.facial_transformation_matrixes[0][:3, :3])
    neutral = ((pixels - pixels[168]) * [1, -1, -1]) @ (u @ vh)
    scale = .211 / (neutral[10, 1] - neutral[152, 1])
    head = neutral * scale * [-1, 1, -1]
    head[:, 0] -= np.mean(head[[234, 454], 0]) * .75
    head[:, 1] += -.087 - head[152, 1]
    head[:, 2] += -.101 - np.mean(head[[468, 473], 2])
    return pixels[:468, :2], head[:468]


def read_triangles(path):
    return [tuple(int(word.split('/')[0]) - 1 for word in line.split()[1:])
            for line in path.read_text().splitlines() if line.startswith('f ')]


def smoothstep(a, b, values):
    t = np.clip((values - a) / (b - a), 0, 1)
    return t * t * (3 - 2 * t)


def linear(color):
    return np.where(color < .04045, color / 12.92, ((color + .055) / 1.055) ** 2.4)


def srgb(color):
    color = np.clip(color, 0, 1)
    return np.where(color < .0031308, color * 12.92, 1.055 * color ** (1 / 2.4) - .055)


def mask_at(points, outline, size):
    mask = Image.new('L', size)
    ImageDraw.Draw(mask).polygon([tuple(points[i]) for i in outline], fill=255)
    return np.asarray(mask) > 0


def bake_maps(image, pixels):
    low = np.floor(pixels.min(axis=0)).astype(int) - 9
    high = np.ceil(pixels.max(axis=0)).astype(int) + 9
    # A reserved, padded strip supplies the skin of the posterior skull.
    crop_size = (704, 768)
    crop = image.crop((*low, *high)).resize(crop_size, Image.Resampling.LANCZOS)
    mapped = (pixels - low) / (high - low) * crop_size
    mask = mask_at(mapped, OUTLINE, crop_size)
    eyelids = np.logical_or.reduce([mask_at(mapped, eye, crop_size) for eye in EYES])
    rgb = np.asarray(crop) / 255.
    luminance = linear(rgb) @ np.array([.2126, .7152, .0722])
    skin = mask & ~eyelids & (rgb[:, :, 0] > rgb[:, :, 1] + .02)
    weights = gaussian_filter(skin.astype(float), 41)
    incident = gaussian_filter(luminance * skin, 41) / np.maximum(weights, .001)
    center = np.median(incident[skin])
    # Correct the broad studio shadow while keeping folds, pores, brows and lip color.
    exposure = np.clip(center / np.maximum(incident, .025), .55, 3.3) ** .87
    albedo = np.clip(linear(rgb) * exposure[:, :, None] * 1.10, 0, 1)
    edge = distance_transform_edt(mask)
    surface = np.median(albedo[skin & (edge > 30)], axis=0)
    coverage = smoothstep(0, 46, edge)[:, :, None]
    albedo = albedo * coverage + surface * (1 - coverage)
    full = np.empty((768, 768, 3), dtype=np.uint8)
    full[:, :704] = (srgb(albedo) * 255 + .5).astype(np.uint8)
    full[:, 704:] = (srgb(surface) * 255 + .5).astype(np.uint8)
    Image.fromarray(full).save(OUT / 'albedo.webp', quality=91, method=6)
    roughness = np.full((768, 768), 174, dtype=np.uint8)
    roughness[:, :704] = np.uint8(174 - gaussian_filter(eyelids.astype(float), 1.35) * 103)
    Image.fromarray(roughness).save(OUT / 'roughness.webp', lossless=True, method=6)
    uv = np.column_stack((mapped[:, 0] / 768, 1 - mapped[:, 1] / 768))
    return uv, (srgb(surface) * 255 + .5).astype(int).tolist()


def add_posterior(positions, uvs, triangles):
    rim = np.array([positions[i] for i in OUTLINE])
    center = np.array([0, .047, .116])
    back_uv = [.953, .5]
    old = OUTLINE
    for theta in np.radians([14, 28, 42, 56, 69, 80]):
        ring = []
        weight = np.sin(theta)
        for origin in rim:
            v = center + (origin - center) * np.cos(theta)
            # Leave room for the occiput under the hat and taper the lower jaw.
            jaw = 1 - smoothstep(-.055, .035, origin[1])
            target_depth = center[2] - .022 * jaw * np.cos(theta)
            v[2] = origin[2] + (target_depth - origin[2]) * weight
            v[1] += .013 * weight * jaw
            # The highest landmark is on the forehead, below the actual crown.
            v[1] += .053 * np.sin(2 * theta) * smoothstep(.018, .122, origin[1])
            ring.append(len(positions))
            positions.append(v.tolist())
            uvs.append(back_uv)
        for i, j in zip(range(len(old)), list(range(1, len(old))) + [0]):
            triangles.extend(((old[i], old[j], ring[i]), (old[j], ring[j], ring[i])))
        old = ring
    pole = len(positions)
    positions.append(center.tolist())
    uvs.append(back_uv)
    triangles.extend((old[i], old[j], pole) for i, j in zip(range(len(old)), list(range(1, len(old))) + [0]))


def add_ears(positions, uvs, triangles, frontal):
    with gzip.open(ROOT / 'client/public/models/skier-human.json.gz', 'rt') as handle:
        human = json.load(handle)
    points = np.array(human['position']).reshape(-1, 3)
    for side, index in ((1, 234), (-1, 454)):
        anchor = frontal[index]
        mask = ((points[:, 0] * side > .072) & (points[:, 1] > 1.593) &
                (points[:, 1] < 1.668) & (points[:, 2] > -.099) & (points[:, 2] < .022))
        ears = np.array(human['index']).reshape(-1, 3)
        ears = ears[np.all(mask[ears], axis=1)]
        base = len(positions)
        vertices, faces = np.unique(ears, return_inverse=True)
        ear = points[vertices] - [.072 * side, 1.632, -.042]
        ear *= [1.07, .92, 1.05]
        ear += [anchor[0] - .004 * side, anchor[1] + .015, anchor[2] + .020]
        positions.extend(ear.tolist())
        uvs.extend([[.953, .5]] * len(ear))
        triangles.extend((faces.reshape(-1, 3) + base).tolist())


def build():
    CACHE.mkdir(parents=True, exist_ok=True)
    OUT.mkdir(parents=True, exist_ok=True)
    portrait = Image.open(source('portrait.png', PORTRAIT)).convert('RGB').crop((995, 95, 1975, 1265))
    pixels, frontal = measure(portrait, source('face_landmarker.task', LANDMARKER))
    triangles = read_triangles(source('canonical_face_model.obj', CANONICAL))
    positions = frontal.tolist()
    uv, skin = bake_maps(portrait, pixels)
    uvs = uv.tolist()
    face_index_count = len(triangles) * 3
    add_posterior(positions, uvs, triangles)
    skull_index_count = len(triangles) * 3
    # The continuous facial and posterior surface share normals at their join.
    add_ears(positions, uvs, triangles, frontal)
    result = {
        'faceIndexCount': face_index_count,
        'skullIndexCount': skull_index_count,
        'skin': skin,
        'position': np.round(positions, 6).ravel().tolist(),
        'uv': np.round(uvs, 6).ravel().tolist(),
        'index': np.array(triangles).ravel().tolist(),
    }
    (OUT / 'head.json').write_text(json.dumps(result, separators=(',', ':')) + '\n')
    print(f'{len(positions):,} vertices, {len(triangles):,} triangles')
    for name in ('albedo.webp', 'roughness.webp', 'head.json'):
        print(name, (OUT/name).stat().st_size)
    print('forehead, temples, nose, jaw, eyes (head coordinates):', frontal[[10, 234, 454, 4, 152, 33, 263]].round(4).tolist())


if __name__ == '__main__':
    build()
