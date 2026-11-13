"""Original printed trail-map panel from our DEM, lidar canopy and mapped runs.

The resort's copyrighted map is a reference only. No pixels from it or the kiosk
photographs are read here. Rebuild after build_map.py with npm run data:trail-board.
"""
import hashlib
import json
import math
from pathlib import Path

import numpy as np
from PIL import Image, ImageDraw, ImageFont
from scipy.ndimage import gaussian_filter
from config import PROC, PUBLIC, ROOT

OUT = ROOT / 'client/src/world/assets/trail-board.webp'
W, H = 3072, 2304
AREA = (510, 230, 3004, 2120)
ELEVATION = math.radians(42)
COLORS = {'green': '#21894c', 'blue': '#256fa7', 'black': '#202b30',
          'double': '#202b30', 'park': '#cf772b', 'hike': '#887c67'}


def font(size, bold=False):
    choices = [Path('/System/Library/Fonts/Supplemental') / ('Arial Bold.ttf' if bold else 'Arial.ttf'),
               Path('/usr/share/fonts/truetype/dejavu') / ('DejaVuSans-Bold.ttf' if bold else 'DejaVuSans.ttf')]
    for path in choices:
        if path.exists():
            return ImageFont.truetype(str(path), size)
    return ImageFont.load_default(size=size)


def main():
    resort = json.loads((PUBLIC / 'resort.json').read_text())
    meta = json.loads((PROC / 'hi_1m.json').read_text())
    dem = np.load(PROC / 'hi_1m.npy', mmap_mode='r')
    canopy = np.load(PROC / 'chm_1m.npy', mmap_mode='r')
    # Base looking uphill, east to the left, with true elevation in an oblique projection.
    def project_raw(p):
        x, y, z = p
        return -x, -z * math.sin(ELEVATION) - (y - 2450) * math.cos(ELEVATION)

    bounds = np.array([project_raw(p) for p in resort['boundary']])
    lo, hi = bounds.min(axis=0) - [100, 100], bounds.max(axis=0) + [120, 160]
    scale = min((AREA[2] - AREA[0]) / (hi[0] - lo[0]), (AREA[3] - AREA[1]) / (hi[1] - lo[1]))
    origin = [(AREA[0] + AREA[2] - (lo[0] + hi[0]) * scale) / 2,
              (AREA[1] + AREA[3] - (lo[1] + hi[1]) * scale) / 2]

    def project(p):
        u, v = project_raw(p)
        return origin[0] + u * scale, origin[1] + v * scale

    cv = Image.new('RGB', (W, H), '#f4f2e9')
    d = ImageDraw.Draw(cv)
    # Printed white panel, restrained navy headings and a separate information column.
    d.rectangle((24, 24, W - 25, H - 25), outline='#547084', width=4)
    d.rectangle((45, 45, W - 46, 182), fill='#224f6b')
    d.text((90, 66), 'SUNLIGHT', fill='white', font=font(78, True))
    d.text((650, 90), 'MOUNTAIN RESORT', fill='#e3edf2', font=font(38))
    d.text((W - 105, 98), 'TRAIL MAP', anchor='ra', fill='white', font=font(48, True))
    d.line((473, 230, 473, 2100), fill='#bcc8ca', width=3)
    d.text((78, 248), 'FIND YOUR WAY', fill='#234e65', font=font(33, True))
    d.text((78, 297), 'All trails return to the base.', fill='#455862', font=font(24))

    terrain = Image.new('RGB', (W, H), '#d7e6ed')
    td = ImageDraw.Draw(terrain)
    # A softly shaded, actual terrain surface. Lidar canopy coverage reveals the real run cuts.
    step = 7
    xs = np.arange(-1435, 1436, step)
    ns = np.arange(-1435, 1436, step)
    xx, nn = np.meshgrid(xs, ns)
    ii = np.rint(xx - meta['x0']).astype(int)
    jj = np.rint(nn - meta['n0']).astype(int)
    smooth = gaussian_filter(np.array(dem), 3)
    tree_cover = gaussian_filter((np.array(canopy) > 2).astype(np.float32), 5)
    yy, cover = smooth[jj, ii], tree_cover[jj, ii]
    gy, gx = np.gradient(yy, step)
    shade = np.clip((gx * .55 + gy * .4 + .8) / np.sqrt(1 + gx * gx + gy * gy), .22, 1)
    snow, trees = np.array([242, 247, 245]), np.array([65, 108, 91])
    pigment = snow * (1 - cover[..., None] * .83) + trees * cover[..., None] * .83
    rgb = np.clip(pigment * (.66 + shade[..., None] * .34), 0, 255).astype(np.uint8)
    uu = origin[0] - xx * scale
    vv = origin[1] + (nn * math.sin(ELEVATION) - (yy - 2450) * math.cos(ELEVATION)) * scale
    for j in range(len(ns) - 1):
        for i in range(len(xs) - 1):
            pts = [(uu[j, i], vv[j, i]), (uu[j, i + 1], vv[j, i + 1]),
                   (uu[j + 1, i + 1], vv[j + 1, i + 1]), (uu[j + 1, i], vv[j + 1, i])]
            td.polygon(pts, fill=tuple(rgb[j, i]))
    cv.paste(terrain.crop(AREA), AREA[:2])
    d = ImageDraw.Draw(cv)

    def line(points, fill, width):
        xy = [project(p) for p in points]
        d.line(xy, fill=fill, width=width, joint='curve')
        return xy

    boundary = [project(p) for p in resort['boundary']]
    d.line(boundary, fill='#ad923b', width=5, joint='curve')
    runs = [r for r in resort['runs'] if r['kind'] == 'line' and r['difficulty'] in COLORS]
    for run in runs:
        line(run['points'], '#f5f7ef', 15)
    for run in runs:
        line(run['points'], COLORS[run['difficulty']], 5)

    occupied = []
    def label(text, at, size=24, color='#203843', halo='#f6f6ef', bold=False, center=True):
        f = font(size, bold)
        x, y = at
        box = d.textbbox((x, y), text, font=f, anchor='mm' if center else 'la')
        d.text((x, y), text, font=f, fill=color, anchor='mm' if center else 'la', stroke_width=3, stroke_fill=halo)
        occupied.append((box[0] - 4, box[1] - 3, box[2] + 4, box[3] + 3))

    # Real lift lines are the three red spines; current names do not depend on the old reference image.
    for lift in resort['lifts']:
        pts = [lift['bottom'], lift['top']]
        xy = line(pts, '#fff8ed', 13)
        line(pts, '#b33f43', 7)
        for x, y in xy:
            d.ellipse((x - 8, y - 8, x + 8, y + 8), fill='#b33f43', outline='white', width=2)
        mid = np.mean(xy, axis=0)
        label(lift['name'].upper(), (mid[0] + 45, mid[1]), 31, '#8f252e', bold=True)

    # One label per real named run, placed along its longest mapped segment with collision checks.
    by_name = {}
    for r in runs:
        length = sum(math.dist(a, b) for a, b in zip(r['points'], r['points'][1:]))
        if r['name'] not in by_name or length > by_name[r['name']][0]:
            by_name[r['name']] = (length, r)
    named, omitted = [], []
    priorities = ['Ute', 'Grizzly Road', 'Sun King', 'Midway', 'Segundo', 'Beaujolais', 'The Heathen', 'Rebel', 'Zephyr']
    ordered = sorted(by_name, key=lambda name: (priorities.index(name) if name in priorities else 99, -by_name[name][0]))
    for name in ordered:
        r = by_name[name][1]
        points = r['points']
        placed = False
        for f in [.5, .3, .7, .15, .85]:
            x, y = project(points[min(len(points) - 1, int(len(points) * f))])
            for dx, dy in [(0, -15), (0, 18), (35, -25), (-35, 25)]:
                at = (x + dx, y + dy)
                size = 23 if len(name) < 20 else 21
                box = d.textbbox(at, name, font=font(size), anchor='mm')
                if box[0] < AREA[0] + 8 or box[2] > AREA[2] - 8 or box[1] < AREA[1] or box[3] > AREA[3]:
                    continue
                if any(box[0] < b[2] and box[2] > b[0] and box[1] < b[3] and box[3] > b[1] for b in occupied):
                    continue
                label(name, at, size, COLORS[r['difficulty']]); named.append(name); placed = True; break
            if placed:
                break
        if not placed:
            omitted.append(name)

    # You are here is the physical kiosk, not a player's moving position.
    bx, bz = 133.52, -933.78
    by = float(dem[round(-bz - meta['n0']), round(bx - meta['x0'])])
    x, y = project((bx, by, bz))
    d.ellipse((x - 13, y - 13, x + 13, y + 13), fill='#c54135', outline='white', width=4)
    d.line((x, y, x - 80, y + 45, x - 255, y + 45), fill='#a32c29', width=4)
    label('YOU ARE HERE', (x - 170, y + 69), 29, '#a32c29', bold=True)
    label('BASE LODGE', (x - 170, y + 103), 24)
    summit = max((l['top'] for l in resort['lifts']), key=lambda p: p[1])
    sx, sy = project(summit)
    label('COMPASS PEAK', (sx, sy - 50), 31, bold=True)

    # The pale side column matches the information/map arrangement visible on the real board.
    y = 390
    for kind, text in [('green', 'Easiest'), ('blue', 'More difficult'), ('black', 'Most difficult'), ('double', 'Experts only'), ('park', 'Terrain park')]:
        col = COLORS[kind]
        if kind == 'green':
            d.ellipse((84, y - 14, 112, y + 14), fill=col)
        elif kind in ('black', 'double'):
            for offset in ([0, 28] if kind == 'double' else [0]):
                d.polygon([(98 + offset, y - 16), (114 + offset, y), (98 + offset, y + 16), (82 + offset, y)], fill=col)
        else:
            d.rectangle((84, y - 14, 112, y + 14), fill=col)
        d.text((165, y), text, font=font(27), fill='#283f48', anchor='lm')
        y += 62
    d.line((83, y, 137, y), fill='#b33f43', width=7)
    d.text((165, y), 'Chairlift', font=font(27), fill='#283f48', anchor='lm')
    y += 62
    d.line((83, y, 137, y), fill='#ad923b', width=5)
    d.text((165, y), 'Ski area boundary', font=font(24), fill='#283f48', anchor='lm')
    d.text((78, 956), 'LIFTS', fill='#234e65', font=font(33, True))
    for i, lift in enumerate(resort['lifts']):
        d.text((78, 1028 + i * 125), lift['name'].upper(), font=font(30, True), fill='#a4383c')
        d.text((78, 1073 + i * 125), f"{lift['seats']}-person chair", font=font(25), fill='#455862')
    d.text((78, 1468), 'AT THE LODGE', fill='#234e65', font=font(30, True))
    for i, text in enumerate(['Tickets & guest services', 'Rentals & repair', 'Ski & Ride School', 'Dining & restrooms']):
        d.text((78, 1535 + i * 53), text, font=font(24), fill='#455862')
    d.text((78, 1845), 'KNOW YOUR ROUTE', font=font(28, True), fill='#234e65')
    for i, text in enumerate(['Choose terrain within', 'your ability. Watch for', 'trail signs and closures.']):
        d.text((78, 1900 + i * 39), text, font=font(24), fill='#455862')
    d.rectangle((45, 2170, W - 46, H - 46), fill='#e2e8e5')
    d.text((80, 2202), 'SUNLIGHT MOUNTAIN RESORT  •  GLENWOOD SPRINGS, COLORADO', font=font(26, True), fill='#234e65')
    d.text((W - 80, 2248), 'Terrain and trails: USGS 3DEP / OpenStreetMap contributors', anchor='rs', font=font(19), fill='#52656b')
    OUT.parent.mkdir(parents=True, exist_ok=True)
    cv.save(OUT, format='WEBP', quality=92, method=6)
    manifest = {'source': 'Original cartography from project DEM, lidar canopy and resort.json; reference photos and official artwork are not embedded.',
                'projection': 'Orthographic view uphill from the base, 42 degree elevation; no height exaggeration.',
                'width': W, 'height': H, 'runLabels': sorted(named), 'unplacedRunLabels': sorted(omitted),
                'lifts': [l['name'] for l in resort['lifts']], 'youAreHere': [bx, by, bz],
                'resortSHA256': hashlib.sha256((PUBLIC / 'resort.json').read_bytes()).hexdigest(),
                'panelSHA256': hashlib.sha256(OUT.read_bytes()).hexdigest()}
    OUT.with_suffix('.json').write_text(json.dumps(manifest, indent=2) + '\n')
    assert len(named) > 55 and len(resort['lifts']) == 3
    assert project(summit)[1] < y
    print(f'Printed trail map: {len(named)} named runs, three lifts; {OUT.stat().st_size:,} bytes. Unplaced: {omitted}')


if __name__ == '__main__':
    main()
