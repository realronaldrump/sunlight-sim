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
AREA = (90, 180, 2982, 1650)
ELEVATION = math.radians(14)
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

    cv = Image.new('RGB', (W, H), '#0876bc')
    d = ImageDraw.Draw(cv)
    # The owner's downhill-base photograph shows a blue panel, a landscape mountain map,
    # and white information boxes below, inside a black metal frame with separate ad bands.
    d.rectangle((24, 24, W - 25, H - 25), outline='#d2e6ee', width=8)
    d.text((90, 38), 'sunlight', fill='white', font=font(100, True))
    d.text((550, 84), 'MOUNTAIN RESORT', fill='#e3f0f5', font=font(32))
    d.text((W - 105, 75), 'TRAIL MAP', anchor='ra', fill='white', font=font(48, True))

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
    bx, bz = 48.0, -1005.5
    by = float(dem[round(-bz - meta['n0']), round(bx - meta['x0'])])
    x, y = project((bx, by, bz))
    d.ellipse((x - 13, y - 13, x + 13, y + 13), fill='#c54135', outline='white', width=4)
    d.line((x, y, x - 80, y + 45, x - 255, y + 45), fill='#a32c29', width=4)
    label('YOU ARE HERE', (x - 170, y + 69), 29, '#a32c29', bold=True)
    label('BASE LIFTS', (x - 170, y + 103), 24)
    summit = max((l['top'] for l in resort['lifts']), key=lambda p: p[1])
    sx, sy = project(summit)
    label('COMPASS PEAK', (sx, sy - 50), 31, bold=True)

    # Legible, original information in the two white lower panels visible in the photograph.
    d.rectangle((90, 1740, 1100, 2190), fill='#f5f4e9', outline='#cee5ed', width=6)
    d.text((145, 1770), 'MOUNTAIN KEY', fill='#184d70', font=font(38, True))
    y = 1850
    for kind, text in [('green', 'Easiest'), ('blue', 'More difficult'), ('black', 'Most difficult'), ('double', 'Experts only'), ('park', 'Terrain park')]:
        col = COLORS[kind]
        if kind == 'green':
            d.ellipse((145, y - 14, 173, y + 14), fill=col)
        elif kind in ('black', 'double'):
            for offset in ([0, 28] if kind == 'double' else [0]):
                d.polygon([(159 + offset, y - 16), (175 + offset, y), (159 + offset, y + 16), (143 + offset, y)], fill=col)
        else:
            d.rectangle((145, y - 14, 173, y + 14), fill=col)
        d.text((225, y), text, font=font(29), fill='#283f48', anchor='lm')
        y += 57
    d.line((650, 1875, 710, 1875), fill='#b33f43', width=7)
    d.text((740, 1875), 'Chairlift', font=font(28), fill='#283f48', anchor='lm')
    d.line((650, 1940, 710, 1940), fill='#ad923b', width=5)
    d.text((740, 1940), 'Boundary', font=font(28), fill='#283f48', anchor='lm')
    d.text((650, 2030), 'PRIMO  •  SEGUNDO', font=font(26, True), fill='#184d70')
    d.text((650, 2080), 'TERCERO', font=font(26, True), fill='#184d70')
    d.text((1545, 1695), 'sunlightmtn.com', fill='white', font=font(42, True), anchor='mm')
    d.rounded_rectangle((1190, 1800, 2010, 2090), radius=50, fill='#2b4b93', outline='#dfb0cd', width=12)
    d.text((1600, 1860), 'SKI & RIDE', fill='#fff4ce', font=font(58, True), anchor='mm', stroke_width=2, stroke_fill='#aa4569')
    d.text((1600, 1950), 'SUNLIGHT', fill='white', font=font(65, True), anchor='mm', stroke_width=3, stroke_fill='#a44975')
    d.text((1600, 2030), 'GLENWOOD SPRINGS, COLORADO', fill='#dbe9f4', font=font(23, True), anchor='mm')
    d.rectangle((2100, 1870, 2982, 2190), fill='#f5f4e9', outline='#cee5ed', width=6)
    d.text((2155, 1905), 'AT THE BASE', fill='#184d70', font=font(34, True))
    for i, text in enumerate(['Tickets  •  Rentals & repair', 'Ski & Ride School', 'Dining  •  Restrooms']):
        d.text((2155, 1970 + i * 54), text, font=font(29), fill='#455862')
    d.text((W - 90, 2260), 'Original terrain map: USGS 3DEP / OpenStreetMap contributors', anchor='rs', font=font(21), fill='#d7eaf5')
    OUT.parent.mkdir(parents=True, exist_ok=True)
    cv.save(OUT, format='WEBP', quality=92, method=6)
    manifest = {'source': 'Original cartography from project DEM, lidar canopy and resort.json; reference photos and official artwork are not embedded.',
                'projection': 'Orthographic view uphill from the base, 14 degree elevation; no height exaggeration.',
                'width': W, 'height': H, 'runLabels': sorted(named), 'unplacedRunLabels': sorted(omitted),
                'lifts': [l['name'] for l in resort['lifts']], 'youAreHere': [bx, by, bz],
                'resortSHA256': hashlib.sha256((PUBLIC / 'resort.json').read_bytes()).hexdigest(),
                'panelSHA256': hashlib.sha256(OUT.read_bytes()).hexdigest()}
    OUT.with_suffix('.json').write_text(json.dumps(manifest, indent=2) + '\n')
    assert len(named) > 55 and len(resort['lifts']) == 3
    assert project(summit)[1] < project((bx, by, bz))[1]
    print(f'Printed trail map: {len(named)} named runs, three lifts; {OUT.stat().st_size:,} bytes. Unplaced: {omitted}')


if __name__ == '__main__':
    main()
