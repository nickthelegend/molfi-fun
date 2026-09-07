#!/usr/bin/env python3
"""
One narration line per scene, spoken by Kokoro, measured rather than estimated.

The measurement is the point. A scene paced against a *guessed* duration drifts a little on
every cut and by the end the subtitle is a sentence behind the picture. Every line here is
synthesised to a file, the file's real length is read back from the samples, and that number is
what the assembler paces the footage to.

Voice: af_heart. American, even, unhurried — this narration explains a mechanism rather than
selling one, and a bright presenter read would fight the material.
"""
import json, pathlib, sys
import numpy as np
import soundfile as sf
from kokoro_onnx import Kokoro

HERE = pathlib.Path(__file__).parent
AUDIO = HERE / "audio"
AUDIO.mkdir(exist_ok=True)

kokoro = Kokoro(str(HERE / "models" / "kokoro-v1.0.onnx"), str(HERE / "models" / "voices-v1.0.bin"))
scenes = json.loads((HERE / "script.json").read_text())
only = sys.argv[1].split(",") if len(sys.argv) > 1 else None

out = []
for s in scenes:
    if only and s["id"] not in only:
        continue
    samples, rate = kokoro.create(s["line"], voice="af_heart", speed=1.0, lang="en-us")
    # A breath of silence either side so a cut never clips the first or last phoneme.
    pad = np.zeros(int(rate * 0.35), dtype=samples.dtype)
    samples = np.concatenate([pad, samples, pad])
    path = AUDIO / f"{s['id']}.wav"
    sf.write(str(path), samples, rate)
    seconds = len(samples) / rate
    out.append({"id": s["id"], "line": s["line"], "seconds": round(seconds, 3)})
    print(f"  {s['id']:<12} {seconds:6.2f}s  {s['line'][:60]}")

merged = {}
p = HERE / "narration.json"
if p.exists():
    merged = {r["id"]: r for r in json.loads(p.read_text())}
for r in out:
    merged[r["id"]] = r
order = [s["id"] for s in scenes]
p.write_text(json.dumps([merged[i] for i in order if i in merged], indent=2) + "\n")
print(f"\n{len(out)} line(s) → {AUDIO}")
