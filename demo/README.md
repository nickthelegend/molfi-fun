# The demo video

`molfi-demo/renders/*.mp4` — 1080×1920, 1m 36s. Built with HyperFrames from **real captures of
the live app** and the **real on-chain numbers**, not mockups.

## What is in it

| Time | Beat |
| --- | --- |
| 0:00 | The claim — a position is a commitment, never an address |
| 0:08 | Why privacy is the mechanic: an order is a signal before it is a trade |
| 0:22 | The console, captured from the running app |
| 0:38 | **The mechanic**: the band struck through, the reach ratios that go to the chain in its place |
| 0:54 | `/privacy` — and why the red banner that lived there is gone |
| 1:08 | The real trade: 2.0000 staked → settled 79,642.46 on 10 publishers → **2.1026 paid** |
| 1:24 | `/m/1`, every check passed, recompute it as a stranger |

Every figure on screen came off Sepolia. `2 × 1.0513 = 2.1026` is the actual payout of the
actual position, against the multiplier quoted before it was opened.

## Frames

`frames/` holds the source captures, taken headless against production at 460×940 (the console
is mobile-first; a wide window letterboxes it). `06-console-crop.png` is the console with the
Next.js dev badge cropped off — the console is behind the wallet gate, so it is captured from a
local build, and that badge is the one thing in the shot that is not the product.

## Publishing

`npm run publish` uploads to a stable URL — **private by default**, `--public` for a link
anyone can open. That is a distribution decision, so it is left to a person: run it, or upload
the MP4 wherever the submission wants it, then put the URL in `strk20.json.demo_video`, which
is still an empty string.

## Rebuilding

```bash
cd demo/molfi-demo && npm run check && npm run render
```

Recapture the frames first if the app has changed — the numbers in the video are real, and a
stale capture would make them a claim rather than a record.
