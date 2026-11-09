"""Fetch CC0 snow scans and pack linear material channels. No terrain displacement.

Run: .venv/bin/python pipeline/build_snow.py
The committed output lets the game run without contacting the asset provider.
"""
from pathlib import Path
import hashlib
import json
import subprocess
from PIL import Image

ROOT = Path(__file__).resolve().parents[1]
RAW = ROOT / "data/raw/materials/snow_02"
OUT = ROOT / "client/public/textures/snow"
SOURCE = "https://polyhaven.com/a/snow_02"


def main():
    RAW.mkdir(parents=True, exist_ok=True)
    OUT.mkdir(parents=True, exist_ok=True)
    maps = []
    sources = []
    for channel in ("disp", "bump", "rough", "ao"):
        filename = f"snow_02_{channel}_2k.jpg"
        url = f"https://dl.polyhaven.org/file/ph-assets/Textures/jpg/2k/snow_02/{filename}"
        path = RAW / filename
        if not path.exists():
            partial = path.with_suffix(".part")
            subprocess.run(["curl", "--fail", "--location", "--retry", "3", "--silent", "--show-error",
                            "--user-agent", "SunlightSim/0.1", url, "--output", str(partial)], check=True)
            partial.replace(path)
        with Image.open(path) as im:
            assert im.size == (2048, 2048), f"Unexpected snow map dimensions: {im.size}"
            maps.append(im.convert("L"))
        sources.append({"channel": channel, "url": url, "sha256": hashlib.sha256(path.read_bytes()).hexdigest()})
    # Lossless packing is data processing: R=height, G=grain, B=roughness, A=occlusion.
    # No color-space conversion. These channels must use THREE.NoColorSpace.
    result = OUT / "snow-detail.webp"
    Image.merge("RGBA", maps).save(result, lossless=True, method=6, exact=True)
    manifest = {"asset": "Snow 02", "author": "Rob Tuytel", "source": SOURCE,
                "license": "CC0-1.0", "licenseUrl": "https://polyhaven.com/license",
                "sourceWidthMeters": 2, "channels": ["height", "grain", "roughness", "occlusion"],
                "sources": sources, "outputSha256": hashlib.sha256(result.read_bytes()).hexdigest()}
    (OUT / "source.json").write_text(json.dumps(manifest, indent=2) + "\n")
    print(f"Snow material: {result.relative_to(ROOT)}, {result.stat().st_size / 1048576:.2f} MiB")


if __name__ == "__main__":
    main()
