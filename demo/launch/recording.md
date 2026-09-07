# molfi — product launch recording

The scene map. One scene per beat, one narration line per scene, one video file per scene, so
any single scene can be re-recorded or re-timed without touching the rest.

**Nothing here is staged.** Every scene drives the real product with Playwright — real clicks,
real typing, real network calls, real chain reads. Where a number appears on screen it was read
from Starknet at record time. If a scene cannot be recorded truthfully it is cut, not faked.

**Capture:** Playwright's `recordVideo` on the browser context. Only the browser viewport is
written to a file; the operator's desktop is never captured and they can keep working.

**Target:** the sprint asks for a 3-minute video. This records long and honest first — every
scene at natural pace — and `scenes.json` then carries a per-scene speed multiplier so runtime
is tuned by re-rendering rather than by cutting content.

---

## Scenes

| # | id | What happens | Narration line |
| --- | --- | --- | --- |
| 0 | `intro` | Animated title card, built as HTML and recorded like any other scene — wordmark draws, subtitle rises, the STARKNET · MAINNET chip settles. | "molfi. A prediction market where your position is a commitment, not an order." |
| 1 | `landing` | Load `molfi.fun`. Hero settles, the handheld renders, live BTC price ticking. Scroll to the nine market cards showing real prices and which oracle settles each. | "Nine markets, priced live. Four settle against Pragma; the other five had no Starknet oracle at all, so molfi is its own — a median across five exchanges, published with the true source count." |
| 2 | `problem` | Scroll the "this is the mechanic" section — the calldata panel showing what the chain actually receives. | "On a public chain your order is a signal before it is a trade. Anyone watching can price against it." |
| 3 | `privacy` | Navigate to `/privacy`. Show the two routes, then the live `openActions` array — the real array the wallet is handed. | "This page is built from the contract's own ABI. It lists what an observer learns, and what they do not." |
| 4 | `desk-range` | The desk. Move the band wider and tighter; the multiplier and the payout move with it. Switch tier 15m / 1h / 4h. | "Pick a band and how long it has to hold. Tighter pays more, and the price comes from the same table the contract prices with." |
| 5 | `desk-updown` | Switch to UP / DOWN. The band controls give way to the two direction keys; the deck's height does not move. | "Or just pick a direction. Same console, same settlement, one less decision." |
| 6 | `verify` | `/verify`. Paste a real commitment from a real position and look it up. Show what the chain reveals — and that the band is not among it. | "Any commitment can be looked up by anyone. The stake is public. The band never was." |
| 7 | `audit` | `/m/<id>` for a settled market. Scroll the checks: chain says, recomputed, verdict. | "Every settled market recomputes itself in front of you. Eleven checks, no wallet, no account." |
| 8 | `keeper` | `/keeper`. What it can and cannot do; the live counters. | "A keeper lists the rounds and settles what is due. It cannot see a position, and settlement is permissionless — anyone can poke an expired market." |
| 9 | `mainnet` | Starkscan on the deployed mainnet contract and its markets. Real explorer, real transactions. | "The contract is live on Starknet mainnet, reading Pragma directly, with four markets funded and open." |
| 10 | `outro` | Animated end card — wordmark, the mainnet address, molfi.fun. | "molfi. Your band, your size, and your name — none of them are the market's business." |

## Scene 11 — reserved

`pool` — three transactions through the STRK20 mainnet pool. **Not recorded yet.** The operator
is directing that flow; the scene slots in here when it happens, and the numbering leaves room
so nothing after it has to be re-recorded.

---

## Pipeline

| step | script | what it does |
| --- | --- | --- |
| 1 | `record.mjs` | Playwright drives each scene, one `.webm` per scene under `raw/` |
| 2 | `narrate.mjs` | Kokoro TTS per line → `audio/<id>.wav`, real duration measured with ffprobe, never estimated |
| 3 | `assemble.mjs` | Paces each clip to its own narration — speed-ramps if the footage is long, holds the last frame if short — burns in that scene's single subtitle cue, stitches the full cut |
| 4 | `scenes.json` | One `speed` per scene, default 1 |
| 5 | `rerender.mjs` | Applies each multiplier (`setpts` for video, `atempo` for audio so pitch stays natural) and reassembles — runtime is tuned here, content is never cut |
