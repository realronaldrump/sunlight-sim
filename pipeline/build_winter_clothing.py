"""Paint original technical outerwear into the CC0 human's UV islands. Run after build_skier.ts."""
import gzip
import hashlib
import json
from pathlib import Path

import numpy as np
import requests
from PIL import Image
from scipy.ndimage import distance_transform_edt

ROOT = Path(__file__).resolve().parents[1]
SIZE = 2048


def rasterize(uv, triangles, values):
    """Interpolate rest-space position and skinning masks into the original mesh UVs."""
    points = uv * SIZE - 0.5
    field = np.zeros((SIZE, SIZE, values.shape[1]), np.float32)
    inside = np.zeros((SIZE, SIZE), bool)
    for a, b, c in triangles:
        tri = points[[a, b, c]]
        x0, y0 = np.maximum(np.ceil(tri.min(axis=0)).astype(int), 0)
        x1, y1 = np.minimum(np.floor(tri.max(axis=0)).astype(int), SIZE - 1)
        if x1 < x0 or y1 < y0:
            continue
        ab, ac = tri[1:] - tri[0]
        det = ab[0] * ac[1] - ab[1] * ac[0]
        if abs(det) < 1e-8:
            continue
        yy, xx = np.ogrid[y0:y1+1, x0:x1+1]
        dx, dy = xx - tri[0, 0], yy - tri[0, 1]
        u = (ac[1] * dx - ac[0] * dy) / det
        v = (ab[0] * dy - ab[1] * dx) / det
        row, col = np.where((u >= 0) & (v >= 0) & (u + v <= 1))
        field[y0 + row, x0 + col] = (values[a] + u[row, col, None] * (values[b] - values[a])
                                      + v[row, col, None] * (values[c] - values[a]))
        inside[y0 + row, x0 + col] = True
    return field[inside].T, inside


def smooth(x, left, right):
    t = np.clip((x - left) / (right - left), 0, 1)
    return t * t * (3 - 2 * t)


def span(x, low, high, feather=.002):
    return smooth(x, low - feather, low) * (1 - smooth(x, high, high + feather))


def line(d, halfwidth):
    return 1 - smooth(np.abs(d), halfwidth, halfwidth + .0013)


def paint(fields):
    x, y, z, sleeve, glove, coat, skin = fields
    ax = abs(x)
    torso = coat * (1 - smooth(sleeve, .19, .67))
    arm = coat * smooth(sleeve, .22, .76)
    pants = (1 - coat) * (1 - skin) * (1 - glove) * (1 - smooth(y, .98, 1.01))
    front = smooth(-z, .034, .094)
    back = smooth(z, .049, .103)
    # Red is lighting-independent cloth relief, green is a cut panel, blue is neutral trim/hardware.
    light = np.full(x.shape, .78, np.float32)
    trim = np.zeros_like(light)
    phase = y * 1480 + z * 390
    stitch = .5 + .5 * np.cos(phase)
    weave = np.sin((x + z * .72) * 1770) * np.sin(phase)
    light += (.020 * weave + .013 * np.cos(phase * .47 + x * 45)) * (1 - skin)
    yoke_edge = 1.327 + .075 * (ax / .24) ** 1.3 - .046 * back
    yoke = smooth(y - yoke_edge, -.002, .002)
    side = smooth(ax + .32 * abs(z - .017), .179, .207) * (1 - .38 * yoke)
    panel = torso * np.maximum(yoke, side)
    upper_arm = smooth(y + .12 * (ax - .28) - 1.324, -.003, .003)
    panel = np.maximum(panel, arm * upper_arm)
    light -= torso * line(y - yoke_edge, .0028) * .26
    light += torso * line(y - yoke_edge - .005, .0011) * (.05 + .10 * stitch)
    light -= arm * line(y + .12 * (ax - .28) - 1.324, .0022) * .25

    def zipper(distance, length, mask, width=.005):
        nonlocal light, trim
        tape = line(distance, width) * mask
        teeth = line(distance, .0015) * mask
        trim = np.maximum(trim, tape * .95)
        light = light * (1 - tape) + (.34 + .16 * np.abs(distance) / width).clip(0, .8) * tape
        light += teeth * (.23 + .29 * np.cos(length * 1730) ** 2)
        light += line(abs(distance) - width - .0036, .0008) * mask * (.08 + .09 * stitch)

    def pull(px, py, mask, tilt=0):
        nonlocal light, trim
        rel = x - px - tilt * (py - y)
        tab = line(rel, .0038) * span(y, py - .022, py) * mask
        hole = line(rel, .0013) * span(y, py - .017, py - .007) * mask
        trim = np.maximum(trim, tab)
        light = light * (1 - tab) + (.96 - .53 * hole) * tab

    closure = torso * front * span(y, 1.006, 1.5)
    zipper(x, y, closure, .006)
    pull(0, 1.437, closure, .16)
    # Angled handwarmer pockets and one externally taped chest pocket.
    welt = .130 + (y - 1.072) * .28
    zipper(ax - welt, y, torso * front * span(y, 1.065, 1.195), .0046)
    for sign in [-1, 1]:
        pull(sign * (.130 + .123 * .28), 1.19, torso * front, -.20 * sign)
    chest_x = -.076 - .083 * (y - 1.28)
    zipper(x - chest_x, y, torso * front * span(y, 1.266, 1.373), .0037)
    pull(-.083, 1.371, torso * front, .12)

    # A laminated sleeve pass pocket, elastic cuffs and an articulated elbow insert.
    elbow = np.exp(-((y - 1.215) / .061) ** 4) * smooth(z, -.055, .012) * arm
    panel = np.maximum(panel, elbow * .66)
    light -= elbow * (.07 + .05 * np.cos(y * 430 + ax * 25))
    arm_pocket = arm * (x < 0) * span(y, 1.230, 1.324)
    zipper(z + .027 - (y - 1.27) * .22, y, arm_pocket, .0042)
    cuff = arm * smooth(ax, .438, .49)
    trim = np.maximum(trim, cuff * .94)
    light -= cuff * (.12 + .065 * np.cos((x - z) * 590))
    hem = torso * span(y, .998, 1.035)
    light -= hem * .15
    light += torso * line(y - 1.031, .0014) * (.10 + .10 * stitch)

    # Trousers have shaped knee panels, zipped thigh pockets and reinforced insteps.
    knee_edge = .58 + .035 * np.cos((ax - .16) * 19)
    knee = pants * span(y, .444, knee_edge) * smooth(-z, -.01, .082)
    light -= knee * .115
    light += pants * (line(y - knee_edge, .003) + line(y - .445, .002)) * front * .12
    thigh = pants * span(y, .685, .798) * smooth(-z, -.035, .046)
    zipper(ax - .203 + .23 * (y - .735), y, thigh, .0042)
    guard = pants * span(y, .214, .342 + (ax - .145) * .4) * (1 - smooth(ax, .171, .214))
    light -= guard * (.20 + .04 * np.cos(phase * .47))
    light += pants * line(y - .29 + z * .29, .0025) * .05
    light -= glove * (.05 + .11 * np.cos(y * 260 + x * 81) ** 6)
    return np.column_stack((light, panel, trim)).clip(0, 1)


# Core MakeHuman skins, distributed as CC0 in the official system asset pack.
SKIN_SOURCE = 'https://download.tuxfamily.org/makehuman/assets/1.1/base/skins/textures/'
FACES = {
    'young_lightskinned_female_diffuse.png': 'b2a6ac8cd4f9febdb447368e29c76cd68410bb66e46d9dcfa2d5f75126eea8fc',
    'young_darkskinned_male_diffuse.png': 'e3f0dbb634e4c68561338f0087f7a122444e84ec56df102212f1222aa12e4d50',
    'middleage_lightskinned_male_diffuse.png': '3f94f3f6a5cab92dedf5cce392a87332312fc435f1cb44c6e7b897daef9a5fbb',
    'middleage_darkskinned_female_diffuse.png': 'c3c9ab972ad46fbda64cedfd1d0a626c2a8e739fd345c4c349102eaacc947699',
}


def build_faces():
    raw = ROOT / 'data/raw/characters/skin'
    raw.mkdir(parents=True, exist_ok=True)
    faces = Image.new('RGB', (1024, 2048))
    for i, (name, expected) in enumerate(FACES.items()):
        path = raw / name
        if not path.exists() or hashlib.sha256(path.read_bytes()).hexdigest() != expected:
            r = requests.get(SKIN_SOURCE + name, timeout=(15, 90))
            r.raise_for_status()
            if hashlib.sha256(r.content).hexdigest() != expected:
                raise ValueError(f'CC0 skin source changed: {name}')
            path.write_bytes(r.content)
        im = Image.open(path).convert('RGB')
        w, h = im.size
        # Normalize the cheeks to the neutral rig complexion. A guest's existing skin colour
        # then applies exactly once. Preserve the photographed variation in lips, lids and skin.
        cheek = im.crop((int(.858*w), int(.545*h), int(.869*w), int(.557*h)))
        reference = np.median(np.asarray(cheek).reshape(-1, 3), axis=0)
        crop = im.crop((w*5//8, h*5//32, w, h*7//8)).resize((512, 1024), Image.Resampling.LANCZOS)
        target = np.array([213, 166, 139])
        balanced = target + (np.asarray(crop) - reference) * (target / reference) ** .55
        # Tapered brow hairs sit on the skin in the same UVs as the eyelids, including on the
        # low-poly heads. Their density and direction differ slightly for each face.
        yy, xx = np.mgrid[0:1024, 0:512]
        u, v = .625 + (xx + .5) / 512 * .375, .15625 + (yy + .5) / 1024 * .71875
        side = np.abs(v - .51683)
        along = np.clip((side - .013) / .046, 0, 1)
        arch = np.interp(side, [.013, .025, .038, .049, .059], [.8236, .8200, .8192, .8224, .8266])
        width = (.0026 + i*.00014) * np.sin(along*np.pi)**.52
        feather = np.exp(-((u - arch) / np.maximum(width,.0001))**2) * span(side,.014,.058,.001)
        hairs = .57 + .43 * np.cos(yy * 2.8 + xx * 1.7 + 1.5 * np.sin(yy*.53))
        brow = np.clip(feather * (.46 + .44 * hairs), 0, .84)[...,None]
        balanced = balanced * (1 - brow) + np.array([83, 63, 52]) * brow
        tile = Image.fromarray(np.uint8(np.clip(balanced, 0, 255)))
        faces.paste(tile, ((i % 2)*512, (i // 2)*1024))
    faces.save(ROOT / 'client/src/skier/assets/guest-faces.webp', quality=90, method=6)


def main():
    with gzip.open(ROOT / 'client/public/models/skier-human.json.gz', 'rt') as f:
        asset = json.load(f)
    joints = np.asarray(asset['skinIndex']).reshape(-1, 4)
    weights = np.asarray(asset['skinWeight']).reshape(-1, 4)
    names = [b['name'] for b in asset['bones']]
    sleeve = np.array(['arm' in n for n in names])[joints]
    glove = np.array([any(part in n for part in ('hand', 'index', 'middle', 'ring', 'pinky', 'thumb')) for n in names])[joints]
    values = np.column_stack((np.reshape(asset['position'], (-1, 3)), (sleeve * weights).sum(1),
                              (glove * weights).sum(1), asset['jacket'], asset['skin'])).astype(np.float32)
    field, inside = rasterize(np.reshape(asset['uv'], (-1, 2)), np.reshape(asset['index'], (-1, 3)), values)
    atlas = np.empty((SIZE, SIZE, 3), np.uint8)
    atlas[:] = [199, 0, 0]
    atlas[inside] = np.rint(paint(field) * 255).astype(np.uint8)
    # Extrude island edges so mipmaps do not pull unrelated colours into garment seams.
    distance, indices = distance_transform_edt(~inside, return_indices=True)
    padding = (~inside) & (distance <= 14)
    atlas[padding] = atlas[indices[0][padding], indices[1][padding]]
    path = ROOT / 'client/src/skier/assets/winter-clothing.webp'
    Image.fromarray(atlas).save(path, quality=96, method=6)
    build_faces()
    print(f'Clothing atlas: {SIZE} x {SIZE}, {path.stat().st_size:,} bytes')


if __name__ == '__main__':
    main()
