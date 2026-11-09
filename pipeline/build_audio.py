"""Build the local CC0 audio bank. Requires FFmpeg, numpy and scipy.

Run: .venv/bin/python pipeline/build_audio.py
Raw recordings stay in data/raw/audio. Committed PCM WAVs need no external
requests, codec plug-ins, account or API key at play time.
"""
from pathlib import Path
import hashlib
import json
import subprocess
import wave

import numpy as np
from scipy.signal import butter, sosfiltfilt

ROOT = Path(__file__).resolve().parents[1]
RAW = ROOT / "data/raw/audio"
OUT = ROOT / "client/public/audio"
RATE = 32000
CC0 = "https://creativecommons.org/publicdomain/zero/1.0/"
SOURCE_HASHES = {
    "ski": "6442ce620053a89b156ce18d1704e885e46e92b7a56d84667abfdf24ab5b8a41",
    "motor": "9a8dad021f22fcf1af3a37395f7de7ae01c3d4e634f1539f167825a6fa114e46",
    "lift": "7fbd062a8daba958e6cda177ad999d348b0e82959c21aabb341003f72d27a932",
    "wind": "b19a078d9d50c399cdb92c50e19c940ec8fe98d44e04cd1a20654b5326e5e7bd",
    "snow": "44b2ead054a341bfa80842fdee85d2fc8a2da1ee202daf4ef114ca7a944fd329",
}
SOURCES = [
    dict(id="ski", author="Lydmakeren", title="Alpine_ski_POV - - Stereo Out.wav",
         page="https://freesound.org/people/Lydmakeren/sounds/567839/",
         url="https://cdn.freesound.org/previews/567/567839_11157357-hq.mp3", file="ski.mp3"),
    dict(id="motor", author="indieground", title="remontée mécanique ski moteur.wav",
         page="https://freesound.org/people/indieground/sounds/223829/",
         url="https://cdn.freesound.org/previews/223/223829_2735146-hq.mp3", file="motor.mp3"),
    dict(id="lift", author="13FPanska_Marval_Lukas", title="ski_lift.wav",
         page="https://freesound.org/people/13FPanska_Marval_Lukas/sounds/379326/",
         url="https://cdn.freesound.org/previews/379/379326_7020229-hq.mp3", file="lift.mp3"),
    dict(id="wind", author="HECKFRICKER", title="Winter Snowstorm Ambience",
         page="https://freesound.org/people/HECKFRICKER/sounds/754256/",
         url="https://cdn.freesound.org/previews/754/754256_12863902-hq.mp3", file="wind.mp3"),
    dict(id="snow", author='Iwan "qubodup" Gabovitch', title="4 dry snow steps",
         page="https://opengameart.org/content/4-dry-snow-steps",
         url="https://opengameart.org/sites/default/files/qubodup-snow_steps_dry_0.7z", file="snow-steps.7z"),
]


def decode(path, channels=1):
    data = subprocess.check_output(["ffmpeg", "-v", "error", "-i", str(path),
                                   "-ac", str(channels), "-ar", str(RATE), "-f", "f32le", "-"])
    return np.frombuffer(data, "<f4").reshape(-1, channels).astype(np.float64)


def band(x, low, high):
    return sosfiltfilt(butter(2, [low, high], btype="bandpass", fs=RATE, output="sos"), x, axis=0)


def normalize(x, rms=0.15, peak=0.82):
    x = x - np.mean(x, axis=0)
    return x * min(rms / max(1e-8, np.sqrt(np.mean(x*x))), peak / max(1e-8, np.max(np.abs(x))))


def seamless(x, seconds=0.35):
    """Equal-power wrap splice. End and start are adjacent original samples."""
    n = min(round(seconds * RATE), len(x)//4)
    t = np.linspace(0, np.pi/2, n)[:, None]
    return np.concatenate([x[-n:]*np.cos(t) + x[:n]*np.sin(t), x[n:-n]])


def bed(source, seconds, seed, grain=0.19):
    """Overlapping source grains erase recorded turns/footsteps, not snow texture."""
    rng = np.random.default_rng(seed)
    length, size = round(seconds*RATE), round(grain*RATE)
    out = np.zeros((length + size*2, 1))
    window = np.hanning(size)[:, None]
    hop = size//3
    for t in range(0, length + size, hop):
        i = rng.integers(0, len(source)-size)
        g = source[i:i+size]
        # Bounded local leveling prevents original turns from pumping the mix.
        level = np.clip(0.075/max(1e-8, np.sqrt(np.mean(g*g))), 0.4, 3.0)
        out[t:t+size] += g * window * level * rng.uniform(0.85, 1.1)
    return seamless(out[size:size+length])


def transient(seed, metal=False):
    """Original damped, inharmonic ski/chair contact. No resonant sine sweep."""
    rng = np.random.default_rng(seed)
    t = np.arange(round(RATE*(0.4 if metal else 0.23)))/RATE
    x = band(rng.normal(0, 0.3, (len(t), 1)), 90, 4300)[:, 0]
    x *= np.exp(-t*38)
    modes = [(137, .15), (311, .09), (743, .045), (1327, .018)] if metal else [(98, .2), (217, .08)]
    for f, a in modes:
        x += a*np.sin(2*np.pi*f*t)*np.exp(-t*(16+f/180))
    x *= np.minimum(1, t/0.002)
    x *= np.minimum(1, (t[-1]-t)/0.02)
    return x[:, None]


def main():
    RAW.mkdir(parents=True, exist_ok=True)
    OUT.mkdir(parents=True, exist_ok=True)
    sources = []
    for source in SOURCES:
        path = RAW/source["file"]
        if not path.exists():
            partial = path.with_suffix(".part")
            subprocess.run(["curl", "--fail", "--location", "--retry", "3", "--max-time", "180",
                            "--silent", "--show-error", source["url"], "-o", str(partial)], check=True)
            partial.replace(path)
        digest = hashlib.sha256(path.read_bytes()).hexdigest()
        assert digest == SOURCE_HASHES[source["id"]], f"Source changed or incomplete: {path}"
        sources.append({**source, "license": "CC0-1.0", "licenseUrl": CC0, "sha256": digest})
    subprocess.run(["tar", "-xf", str(RAW/"snow-steps.7z"), "-C", str(RAW)], check=True)
    ski = decode(RAW/"ski.mp3")
    assert len(ski)/RATE > 200, "Incomplete alpine ski source; delete data/raw/audio/ski.mp3 and rerun"
    snow = [decode(RAW/f"qubodup-snow_steps_dry/snow_step_dry-0{i}.flac") for i in range(1, 5)]
    manifest = []

    def save(name, x, origin, processing, loop=False):
        x = normalize(x)
        path = OUT/f"{name}.wav"
        pcm = np.round(np.clip(x, -1, 1)*32767).astype("<i2")
        with wave.open(str(path), "wb") as f:
            f.setnchannels(x.shape[1]); f.setsampwidth(2); f.setframerate(RATE); f.writeframes(pcm.tobytes())
        manifest.append(dict(file=path.name, sources=origin, processing=processing, loop=loop,
                             seconds=round(len(x)/RATE, 5), channels=x.shape[1], sampleRate=RATE,
                             rms=round(float(np.sqrt(np.mean(x*x))), 5), peak=round(float(np.max(np.abs(x))), 5),
                             sha256=hashlib.sha256(path.read_bytes()).hexdigest()))

    save("ski-glide", bed(band(ski[18*RATE:42*RATE], 230, 10500), 11.7, 21, .23), ["ski"],
         "18-42s; 230-10500Hz; seeded overlapping 230ms grains; wrap crossfade; RMS/peak normalization", True)
    save("ski-edge", bed(band(ski[68*RATE:92*RATE], 450, 11500), 9.3, 31, .13), ["ski"],
         "68-92s; 450-11500Hz; seeded overlapping 130ms grains; wrap crossfade; RMS/peak normalization", True)
    soft = np.concatenate([band(s, 100, 2800) for s in snow])
    save("snow-soft", bed(soft, 10.9, 42, .11), ["snow"],
         "Dry snow compression reassembled as 110ms grains; 100-2800Hz; wrap crossfade; RMS/peak normalization", True)
    motor = band(decode(RAW/"motor.mp3"), 65, 6500)
    save("lift-motor", seamless(motor[4*RATE:17*RATE], .6), ["motor"],
         "4-17s; mono; 65-6500Hz; 600ms wrap crossfade; RMS/peak normalization", True)
    cable = band(decode(RAW/"lift.mp3"), 180, 7500)
    save("lift-cable", seamless(cable[round(.4*RATE):round(7.6*RATE)], .5), ["lift"],
         "0.4-7.6s; mono; 180-7500Hz; 500ms wrap crossfade; RMS/peak normalization", True)
    wind = band(decode(RAW/"wind.mp3", 2), 70, 5500)
    save("winter-air", seamless(wind[72*RATE:94*RATE], 1.5), ["wind"],
         "72-94s; stereo; 70-5500Hz; 1.5s wrap crossfade; RMS/peak normalization", True)
    for i, x in enumerate(snow):
        x = band(x, 85, 8500)
        # Remove recording silence, retain actual compression/settling attack.
        env = np.convolve(np.abs(x[:, 0]), np.ones(640)/640, mode="same")
        active = np.flatnonzero(env > env.max()*.08)
        x = x[max(0, active[0]-320):min(len(x), active[-1]+1000)]
        n = min(320, len(x)//4)
        x[:n] *= np.linspace(0, 1, n)[:, None]; x[-n:] *= np.linspace(1, 0, n)[:, None]
        save(f"snow-compress-{i+1}", x, ["snow"], "Trim silence; 10ms edge fades; 85-8500Hz; RMS/peak normalization")
    for i in range(3):
        save(f"chair-contact-{i+1}", transient(74+i, True), [], "Original seeded damped inharmonic metal and rubber contact")
    rng = np.random.default_rng(918)
    t = np.arange(round(.72*RATE))/RATE
    friction = band(rng.normal(0, 1, (len(t), 1)), 280, 1700)
    # Irregular stick-slip friction, low in the mix; no pitched cartoon squeak.
    envelope = np.sin(np.pi*t/t[-1])**2 * (.4+.6*np.sin(2*np.pi*(17*t+8*t*t))**2)
    save("chair-creak", friction*envelope[:, None], [], "Original seeded band-limited stick-slip friction; shaped 720ms envelope")
    (OUT/"sources.json").write_text(json.dumps({"license": "CC0-1.0", "licenseUrl": CC0,
        "note": "Third-party sources are CC0. Original generated Foley is dedicated to CC0. Location-specific audio is a designed approximation, not a Sunlight field recording.",
        "sources": sources, "outputs": manifest}, ensure_ascii=False, indent=2)+"\n")
    print(f"Audio: {len(manifest)} WAVs, {sum((OUT/m['file']).stat().st_size for m in manifest)/1048576:.2f} MiB")


if __name__ == "__main__":
    main()
