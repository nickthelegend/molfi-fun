# molfi — product launch video

Records the real product, narrates it, and cuts it. Nothing here is staged: every frame is
Playwright driving `molfi.fun` with real clicks, real typing and real chain reads, captured
from the **browser viewport** rather than the screen — so it runs without touching the desktop
and you can keep working while it does.

## Once

```bash
pip3 install kokoro-onnx soundfile        # already present on this machine
mkdir -p models && cd models
curl -LO https://github.com/thewh1teagle/kokoro-onnx/releases/download/model-files-v1.0/kokoro-v1.0.onnx
curl -LO https://github.com/thewh1teagle/kokoro-onnx/releases/download/model-files-v1.0/voices-v1.0.bin
```

## Each time

```bash
node demo/launch/record.mjs               # every scene, one .webm each  (--only verify,audit)
python3 demo/launch/narrate.py            # Kokoro TTS → audio/*.wav + measured durations
node demo/launch/assemble.mjs             # full cut at natural pace → molfi-launch-full.mp4
```

Then tune the runtime without re-recording or cutting anything:

```bash
# edit scenes.json — set "speed" per scene: 2, 4, 5, anything
node demo/launch/rerender.mjs             # → molfi-launch.mp4
```

## How it fits together

| file | what it is |
| --- | --- |
| `recording.md` | the scene map — what happens in each and the line that goes over it |
| `script.json` | one narration line per scene |
| `record.mjs` | Playwright; one video file per scene, and the measured lead-in to trim |
| `narrate.py` | Kokoro (`af_heart`); durations read back from the samples, never estimated |
| `assemble.mjs` | paces each clip to its own line, renders captions as type, overlays, stitches |
| `scenes.json` | one speed multiplier per scene, default 1 |
| `rerender.mjs` | applies the multipliers and reassembles |

## Things worth knowing

**Each scene is paced to its own narration.** Long footage is ramped with `setpts`; short footage
holds its last frame with `tpad`. So the picture and the sentence describing it start and end
together, and re-shooting one scene never moves anything after it.

**Captions are rendered in a browser, not by ffmpeg.** This ffmpeg build has no `subtitles`,
`ass` or `drawtext` filter — only `overlay`. Rendering each caption in the same Chromium that
shot the footage means they are set in the product's own typeface, and a scrim keeps them
readable over a real interface rather than a backdrop.

**Speed changes retime the audio too**, with `atempo`, so pitch is unaffected — a 2x scene still
sounds like the same narrator.

**Scene 11 is reserved** for the three STRK20 mainnet pool transactions. It is not recorded yet;
the numbering leaves the gap so nothing after it has to be re-cut when it lands.
