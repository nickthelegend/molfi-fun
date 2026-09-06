# 100 ideas, ranked — second pass

The first version of this file is superseded. Its top ten were the relay, the keeper, the
Postgres ledger, pointing the site at a network with a contract, round rotation and the
verifier page — all built, all live. Ranking against a project that no longer exists is how a
backlog becomes fiction, so this is a fresh read of what molfi is *today*.

## What molfi is now

A prediction market on Starknet where your position stays sealed until settlement. Live at
molfi.fun on Sepolia. The contract at `0x03b00e6e…b068` is bound to the real STRK20 privacy
pool, settles against a relay carrying mainnet Pragma's median, and a keeper has settled 44
markets against real multi-publisher prices. A wallet that speaks STRK20 is offered the
private route today. There are 81 Cairo tests, 81 SDK tests, and an end-to-end suite that
opens, settles and claims on a real chain.

## The one thing that decides this, still

**Nobody has traded.** `staked` is zero across all 44 markets. Not because trading is broken —
it works, and there is a signed-transaction test that proves it — but because the private
route needs a privacy wallet a judge may not have, and the public route needs a class declare
this deployer cannot afford. Everything in the top ten below either fixes that or makes the
privacy claim legible to a judge who never connects anything.

## Scoring

impact × feasibility × fit, where fit asks whether it strengthens *this* pitch or just adds
surface. A demo with ninety features and no through-line loses to one with six that land.

---

## Tier 1 — build these (1–14)

| # | Idea | Why it scores |
| --- | --- | --- |
| 1 | **The observer's view** — for any real position, show side by side what the chain reveals (commitment, reach ratios, stake, owner) and what it cannot (the band), read live from Sepolia | Makes the entire pitch legible in one screen, to a judge with no wallet. Nothing else converts "we hide the band" from a claim into a thing you can look at. |
| 2 | **Anonymity set per market** — how many open positions share an indistinguishable reach | The number that says whether privacy is real *here*, not in theory. A real on-chain read. |
| 3 | **`/verify` — paste any commitment, get the full audit** | The verifier is currently per-market; per-position is the one a trader actually wants |
| 4 | **Show the STRK20 action list the wallet would receive**, live, for the band on screen | Proves the integration is real and depth-of-use, without needing a wallet to press |
| 5 | **A guided demo run** — one key drives connect → band → fire → settle → claim with narration | Judges have four minutes. Removing every "now let me find the…" is worth more than a feature. |
| 6 | **Landing page shows the live market state** — settled count, last settlement, next cutoff | Right now the front page is a pitch; it should be evidence |
| 7 | **Per-market OG images** — the settled price, the verdict, the publisher count | Every share becomes a proof artifact |
| 8 | **Settlement moment on the deck** — band resolves, ring completes, payout counts up | The visual a judge remembers |
| 9 | **Copyable "check this yourself" command on `/m/<id>`** | Turns a claim into something a sceptic can run in their own terminal |
| 10 | **Position export/import round-trip in the UI**, not just on open | The secret is the only key to the payout; recovery has to be a first-class flow |
| 11 | **Keeper health badge in the header**, linking to `/keeper` | Continuous operation is a differentiator; it should be visible from anywhere |
| 12 | **Sound on settle and payout**, synthesised, off by default | Cheap, memorable, and already half-built in the settings |
| 13 | **Why this band?** — one line explaining the multiplier from the table and sigma | The pricing is the most defensible part of the project and is currently invisible |
| 14 | **Empty-state for "no wallet"** that shows the demo desk rather than a dead console | Most judges will not have a Starknet wallet at all |

## Tier 2 — strong, if the top is done (15–40)

| # | Idea |
| --- | --- |
| 15 | Live anonymity-set sparkline per market |
| 16 | A public read-only "positions opened" ticker from `PositionOpened` events |
| 17 | Show the exact felts sent on chain for the last trade, annotated |
| 18 | Diff view: the same trade via the pool route vs the direct route, byte for byte |
| 19 | Settlement replay — scrub a settled market's price path against the band |
| 20 | Per-pair calibration page: the fitted table, the tape it came from |
| 21 | Multi-position portfolio view with combined exposure |
| 22 | Top-up an existing position before cutoff |
| 23 | Partial claim / claim-all |
| 24 | Market depth: how much capacity is left before the bankroll is exhausted |
| 25 | House solvency banner driven by the reserve invariant |
| 26 | A "what if" slider: payout across the band before committing |
| 27 | Round tier comparison — the same band priced at 15m / 1h / 4h side by side |
| 28 | Historical accuracy: how often the settled price landed inside sold bands |
| 29 | Keeper cost transparency — STRK spent per settlement |
| 30 | Public Postgres-backed feed of every keeper action as JSON |
| 31 | Webhook/RSS for settlements |
| 32 | Shareable position receipt (no secret) proving you held a band |
| 33 | Cutoff ring that tracks the chain clock, not the browser's |
| 34 | Band painter snapping to the sellable window edges with haptic-style feedback |
| 35 | Price chart showing other open bands as ghost ranges |
| 36 | Settled-price marker animating onto the chart at settlement |
| 37 | Keyboard shortcut overlay (`?`) |
| 38 | Reduced-motion-aware settlement animation |
| 39 | Dark/light beyond the current fixed palette |
| 40 | A proper 404 page in the console's visual language |

## Tier 3 — real, lower leverage (41–70)

| # | Idea |
| --- | --- |
| 41 | Mainnet deployment behind a flag |
| 42 | Multi-token markets beyond STRK |
| 43 | More pairs from Pragma's feed list |
| 44 | Longer horizons (1d, 1w) with fitted tables |
| 45 | Asymmetric bands priced independently each side |
| 46 | Limit-style orders that open when spot enters a range |
| 47 | Auto-roll a position into the next round |
| 48 | Referral-free social proof: total staked all-time |
| 49 | Per-market comment/attestation via signed messages |
| 50 | An "explain this settlement" natural-language summary from chain data |
| 51 | Contract event indexer in Postgres |
| 52 | Subgraph-style GraphQL over the indexed events |
| 53 | CLI for opening positions |
| 54 | A tiny SDK package for third parties to build on molfi |
| 55 | Rate-limited public API keys |
| 56 | Prometheus metrics from the keeper |
| 57 | Alerting when settlement lags |
| 58 | Automatic bankroll top-up from fees |
| 59 | House edge as a governance parameter |
| 60 | Fee split to a treasury address |
| 61 | Emergency pause, owner-only, event-logged |
| 62 | Upgradeability via a proxy, with a timelock |
| 63 | Formal invariant tests (conservation, reserve) as fuzz targets |
| 64 | Differential test: Cairo kernel vs TS kernel over random inputs |
| 65 | Gas benchmarking per entrypoint in CI |
| 66 | CI that runs the full chain suite on every PR |
| 67 | Deployment provenance page — class hash, source hash, build |
| 68 | Reproducible build attestation for the contract |
| 69 | Audit-style threat model document |
| 70 | Bug bounty page |

## Tier 4 — ideas I do not think should be built (71–100)

Listed because ranking honestly means saying which ideas are bad, not just which are low.

| # | Idea | Why not |
| --- | --- | --- |
| 71 | Leaderboard of top traders | Impossible by construction, and pretending otherwise undermines the pitch |
| 72 | Social feed of positions | Same — the product exists to make this impossible |
| 73 | A molfi token | The About page already says there is none; adding one contradicts it |
| 74 | NFT receipts for positions | Publishes the thing being hidden |
| 75 | Public profile pages | As above |
| 76 | Copy-trading | Directly opposed to the premise |
| 77 | Chat | Surface without substance |
| 78 | Notifications requiring an account | An account is a linkable identity |
| 79 | Email capture | Same |
| 80 | Analytics that fingerprint visitors | On a privacy product, indefensible |
| 81 | AI price prediction | Nothing to do with the thesis |
| 82 | Sentiment feed | Decoration |
| 83 | A mobile app | The console is already responsive |
| 84 | Cross-chain bridging | Scope, not substance |
| 85 | Perps | A different product |
| 86 | Options | A different product |
| 87 | Lending against positions | Requires revealing them |
| 88 | Insurance | Adds a counterparty the design removes |
| 89 | DAO governance | Ceremony |
| 90 | Airdrop mechanics | Attracts the wrong scrutiny |
| 91 | Gamified streaks tied to identity | Linkable |
| 92 | Public API leaderboard | As 71 |
| 93 | Live video/stream integration | Off-thesis |
| 94 | Third-party ads | No |
| 95 | Paid tiers | No |
| 96 | Skins marketplace | The Customize sheet already covers the honest version |
| 97 | Multi-language before the product is finished | Premature |
| 98 | A blog | Not a feature |
| 99 | Roadmap page promising future work | Judges score what runs |
| 100 | A second product on the same contract | Dilutes a single clear claim |
