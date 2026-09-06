# molfi — build plan

**Read this first.** The project is feature-complete and deployed, and **nobody can trade it.**
Two funding-shaped blockers stall everything: the class deployed to Sepolia predates the public
trading route, and the keeper is out of STRK so the relay is stale and no market settles or
lists. Every phase below is ordered around clearing those two, because until they clear, more
features do not move the project forward.

Status of the live system, measured rather than remembered (`pnpm verify`, 2026-09-06):
**34/37 PASS · 1 FAIL · 2 UNTESTED.** 49 markets listed, 48 settled, **0 STRK ever staked**.

---

## 1. What "done" and "winning" mean here

### The product

A prediction market where **your position is a commitment, never an address**. You pick a price
band, pick how long it must hold, and stake on it. The band is never sent to the chain — what
the contract is told is how far the band reaches from its own midpoint, a pair of ratios with
the price divided out, which prices the position exactly and says nothing about what it
predicts.

### Why privacy is load-bearing, not decorative

On a public chain your order is a signal before it is a trade: anyone watching can price
against it, crowd it, or get there first. Remove the privacy and molfi is a worse version of
every public prediction market. That is the test the pitch has to pass, and it is the reason
this is a STRK20 submission rather than a market that happens to use a pool.

### Done means

1. A trader opens a position through **their own privacy wallet**. The dapp never sees a
   viewing key — the wallet proves, molfi does not.
2. Opening runs the pool sandwich: the pool withdraws to molfi's anonymizer, the contract parks
   the stake against a Poseidon commitment and returns an empty span.
3. Markets settle against a **fresh Pragma median** at a stated block, unattended.
4. Claiming runs the sandwich again, returning an `OpenNoteDeposit` that credits the winner.
5. A stranger with no wallet and no position can recompute a settled market from published data
   and check it against what the contract paid.
6. **At least one real position has been opened and claimed end to end.** Today: zero.

### Winning means (the hackathon's own bar)

| Requirement | State |
| --- | --- |
| Three **mainnet** transactions through the pool `0x040337b1…6ffe812a` | **NOT STARTED** — nothing is deployed to mainnet |
| Contracts listed in `strk20.json` | Sepolia contracts listed; mainnet fields empty |
| A 3-minute demo video | **`demo_video` is an empty string** |
| A reachable `demo_url` | DONE — `https://molfi.fun` |
| The privacy claim states its own edges | DONE — `/privacy` prints the leak surface per route |

### Explicitly not goals

Sub-accounts (the Wallet API route does not exist — SDK only), running a prover, a bridge, an
order book, a token. Each widens the pitch and none is what is being judged. `docs/IDEAS.md`
Tier 4 (71–100) is the recorded list of things deliberately not built.

---

## 2. The two blockers, stated once

Everything in Phases 1–3 depends on one or both.

**B-1 · The deployed Sepolia class predates the public trading route — and leaks the band.**

The second half is worse than the first and was found while executing this plan. The live
class's `Position` struct stores `band_low` and `band_high` outright, and commitments are
indexed event keys, so **anyone can enumerate a market's positions and read the band each one
bought.** `cairo/src/market.cairo` replaced both fields with reach ratios and never stores the
band; that class is not deployed. Until it is, the headline claim — the one the product is
named for — does not hold on chain. The pool route's other guarantees are unaffected: who and
how much still stay hidden.

`/privacy` now reads the deployed class's ABI at render time and says so in a red banner, and
`pnpm verify` D13 fails with "Position stores band_low and band_high". Both retract themselves
automatically once a class without the band is live.

Probed against the live ABI. The deployed class has `privacy_invoke`, `settle`, `fund_market`,
`create_market`, `get_market`, `get_table`, `get_position`, `quote_band`, `accounted_for`,
`pool`, `oracle`. It does **not** have `open_position`, `claim_position`, `quote_offsets`,
`owner` or `set_oracle`. The source in `cairo/src/market.cairo` has all of them and 81 tests
pass against it. Fixing this needs a declare: **9,752 Sierra felts ≈ 57 STRK on mainnet, ~60 on
Sepolia.** No change to this repository can clear it.

**B-2 · The keeper is out of STRK, by 0.013.**

Measured against the chain rather than estimated: **one relay costs 0.09319 STRK and the
keeper holds 0.08084.** Not a padding problem — the bare fee is unaffordable, and no bound
can close it. It is short by about 0.013 STRK to make a single price republish.

Funding avenues, all checked this run rather than assumed:

| Source | State |
| --- | --- |
| Starknet Foundation agent API (`scripts/faucet.mjs`) | `ADDRESS_COOLDOWN`, 16.5h remaining. 5 STRK per address per 24h. |
| `starknet-faucet.vercel.app` | The **same** faucet — same Foundation backend, same tiers, same per-address cooldown. Not a second source. |
| Blast, Alchemy | Both have discontinued Starknet Sepolia faucets. |
| Any other account in this repo | `account-1` 0 STRK, `e2e-stranger` 0 STRK. Nothing else holds any. |
| Draining a second address to dodge the cooldown | Abuse of a shared testnet. The faucet script says so in its own header, and it was not done. |
| 100 STRK form / 3,000 STRK with GitHub | Both need a person at a browser. |

Balance `0.0808 STRK` against a `0.8 STRK` listing floor. It stops listing before it can strand
an unfunded market (correct), but it also cannot pay for a relay, so the on-chain print is
5,871–15,882s stale, `settle` refuses with `STALE_PRICE`, and one market sits past its cutoff
unsettled. `pnpm verify` E1 fails for exactly this reason. Cost measured today: **~0.5 STRK per
market listed** (`create_market` writes the whole 17-knot pricing table — 18M L2 gas), plus
~0.1 STRK per relay and per settle.

**Funding decision a builder should make before spending anything:** the prize requires
*mainnet* transactions, and mainnet needs the ~57 STRK declare regardless. Sepolia's declare is
valuable but optional. **If STRK is scarce, mainnet wins.** Mainnet also needs no relay (Pragma
publishes there) and can run 4-hour rounds, so its keeper burn is a fraction of Sepolia's.

---

## 3. Phases

### Phase 0 — Restore the live Sepolia demo · **BLOCKED (B-2)**

The public demo currently shows a desk with nothing open and a stale oracle. Cheapest possible
fix; do this before anything cosmetic.

| # | Task | State |
| --- | --- | --- |
| 0.1 | Fund `0x788e67ade3c9e65e04c391518e9de7036a548e9733193d7d6a63ab85f0e9e8f`. | **DONE as far as it can be, and no longer needs a person.** The keeper now asks the Foundation's public **agent** faucet itself when it drops below the floor — the path the faucet advertises for unattended processes, PoW-gated and capped at one drip per address per 24h. Verified in production: it asked, read the cooldown, and scheduled its retry for **2026-09-06T23:07:32Z**, at which point it takes 5 STRK without anyone doing anything. A 30 STRK top-up still needs the browser tiers. Original blocker retained below. |
| ~~0.1a~~ | *(was: fund by hand)* | **BLOCKED for anything above 5 STRK/24h** — faucet agent API attempted 2026-09-06 06:45, answered `ADDRESS_COOLDOWN`, **16.5h remaining**. No other account holds STRK (keeper 0.0800, `account-1` 0, `e2e-stranger` 0). Dripping to a second address to dodge the per-address cooldown is abuse of a shared testnet and was not done. The 100 STRK form is Turnstile-gated and 3,000 needs a GitHub sign-in — both human steps. |
| 0.2 | Confirm the relay catches up: `curl -s molfi.fun/api/health` reports every pair `settleable: true`. | BLOCKED on 0.1 |
| 0.3 | Confirm market 49 settles and a new round lists: `/api/markets` shows 3 open. | BLOCKED on 0.1 |
| 0.4 | Re-run `pnpm verify`; E1 must turn PASS. | BLOCKED on 0.1 |
| 0.5 | Raise `KEEPER_BANKROLL` so a market can cover a stake worth firing — at the live 0.05 the desk sells ~0.2 STRK of exposure, which reads as broken even when it works. **Edit the Railway variable, not the code**: `apps/keeper/src/index.ts` defaults to `0.2` STRK, the deployed service overrides it to `0.05`. Project `cf1bcefd-0fad-490a-af41-158e1c375255`, service `b081214d-69ef-43cf-83da-638a165af468`. **DONE** — set to `0.5 STRK`, with `KEEPER_TIER=2` and `KEEPER_LOW_BALANCE=3.5 STRK`, live on Railway and confirmed serving. No longer a guess: the keeper's income is now known exactly, because it funds itself from the agent faucet at 5 STRK per 24h. |

**Burn, measured on Sepolia today.** Listing a market costs ~0.50 STRK (create + transfer +
fund, batched), a settle ~0.15, a relay batch ~0.10 at most once per `KEEPER_RELAY_MIN_AGE`
(420s). The relay is a fixed ~0.85 STRK/hour that does not shrink with the round length. The
table dedup from 6.3 saves ~0.018 per listing, which is real but does not move this table.

| `KEEPER_TIER` | Round | Listings/hr | Burn/hr excl. bankroll | + bankroll `B`/hr | 100 STRK lasts |
| --- | --- | --- | --- | --- | --- |
| `0` | 15m | 12 | ~7.6 STRK | `12B` | ~4h at `B=0.5`, ~1h at `B=2` |
| `1` | 1h | 3 | ~2.6 STRK | `3B` | ~24h at `B=0.5`, ~11h at `B=2` |
| `2` | 4h | 0.75 | ~1.3 STRK | `0.75B` | ~60h at `B=0.5`, ~35h at `B=2` |

**Recommended: `KEEPER_TIER=1`, `KEEPER_BANKROLL=1000000000000000000` (1 STRK)** on a 100 STRK
top-up — an hour-long round still settles inside a judging session, and 1 STRK of bankroll
sells ~4 STRK of exposure, which is a size worth firing. At 3,000 STRK, `KEEPER_TIER=0`
becomes affordable again and the desk goes back to a settlement every fifteen minutes.

### Phase 1 — Put the trading route on Sepolia · **BLOCKED (B-1)**

| # | Task | State |
| --- | --- | --- |
| 1.1 | Fund a deployer with ≥ 65 STRK on Sepolia and set `DEPLOYER_ADDRESS`. | BLOCKED |
| 1.2 | `pnpm preflight --network sepolia`. | **DONE — and it says "Do not deploy."** 3 problems, 3 warnings. The problems are **not** funding: all three pairs report *"cannot be settled against"* because the relay is stale, so a market listed today could be opened and never resolve. **This is a dependency the plan missed: 1.3 is gated on 0.1 as well as on 1.1.** It also warns that a market is already deployed here with 49 markets. |
| 1.3 | `scripts/deploy.mjs --network sepolia` — declares the current class and deploys `MolfiMarket`. | BLOCKED on 1.1 **and 0.1** — preflight refuses while the oracle cannot settle, and it is right to. |
| 1.4 | Update `MOLFI_MARKET.sepolia` in `packages/sdk/src/networks.ts` to the new address. Exactly one line changes. | BLOCKED on 1.3 |
| 1.5 | Set `MOLFI_MARKET` on the Railway keeper service to the new address and redeploy. | BLOCKED on 1.3 |
| 1.6 | Redeploy the web app (`npx vercel --prod --yes`) so `/live`, `/m/<id>` and the console read the new contract. | BLOCKED on 1.4 |
| 1.7 | Confirm the direct-route probe flips: the live desk stops saying "POOL ONLY HERE" and offers both routes to a capable wallet. `useLiveDesk` probes `quote_offsets`; no code change needed. | BLOCKED on 1.6 |
| 1.8 | Re-run `pnpm verify`; D11 and D12 must leave UNTESTED **and D13 must turn PASS**. | BLOCKED on 1.6 |
| 1.9 | Confirm `/privacy` drops its red banner on its own — it is drawn from the deployed ABI, so a passing D13 and a banner still showing would mean the page is reading a different contract than the verifier. | BLOCKED on 1.6 |

### Phase 2 — Prove a trade, both routes · **BLOCKED (Phase 1)**

Nothing here is a code change. It is the evidence the whole project exists to produce.

| # | Task | State |
| --- | --- | --- |
| 2.1 | Open a position via the **direct** route from a funded Starknet account through molfi.fun. Record the tx hash. | BLOCKED |
| 2.2 | Let it settle; claim it if it wins. Confirm the payout equals `stake × multiplier` exactly. | BLOCKED on 2.1 |
| 2.3 | Open a position via the **pool** route from a STRK20-capable wallet. Record the tx hash. | BLOCKED |
| 2.4 | Claim the pool position; confirm the `OpenNoteDeposit` credits the note. | BLOCKED on 2.3 |
| 2.5 | Confirm `/api/markets` shows non-zero `staked`, and `/privacy` stops reading "0.0000 STRK staked". | BLOCKED on 2.1 |
| 2.6 | Confirm the mid-transaction reload path on a real send: refresh during signing, verify the secret survives and the position appears. | BLOCKED on 2.1 |

### Phase 3 — Mainnet, and the submission's actual bar · **NOT STARTED**

| # | Task | State |
| --- | --- | --- |
| 3.1 | Fund a mainnet deployer with ≥ 60 STRK; set `DEPLOYER_ADDRESS`. | NOT STARTED |
| 3.2 | `pnpm preflight` (defaults to mainnet). | **DONE** — clear, with 2 warnings, both about the unset deployer. Mainnet Pragma settles all three pairs (10–12 publishers), so mainnet needs no relay and has none of Sepolia's staleness problem. |
| 3.3 | `scripts/deploy.mjs --network mainnet`. Deploys `MolfiMarket` only — **`PriceRelay` must not be deployed to mainnet**; markets settle against Pragma directly. | NOT STARTED |
| 3.4 | Set `MOLFI_MARKET.mainnet` in `networks.ts`. | NOT STARTED |
| 3.5 | List and fund one mainnet market per pair at **tier 2 (4h)** — mainnet needs no relay and long rounds cut keeper burn to roughly one listing and one settle per pair per 4 hours. | NOT STARTED |
| 3.6 | Execute **three transactions through the mainnet pool** `0x040337b1af3c663e86e333bab5a4b28da8d4652a15a69beee2b677776ffe812a`. Suggested: shield, open a position, claim it. | NOT STARTED |
| 3.7 | `pnpm submission` — defaults to mainnet, fills `strk20.json` from `deployments/mainnet.json`, verifies every address holds a contract before recording it, and refuses outright to fill from a devnet deployment. | NOT STARTED |
| 3.8 | Verify `strk20.json` names mainnet, lists the mainnet contracts, and lists the three pool transactions. | NOT STARTED |

### Phase 4 — Submission artifacts · **NOT STARTED**

| # | Task | State |
| --- | --- | --- |
| 4.1 | Record a **3-minute demo video**. `strk20.json.demo_video` is an empty string — a hard submission requirement. | **NOT DONE — needs a person.** Recording, narrating and uploading a video is not something this agent can do. Everything it needs to show is live and working right now on the paper desk, including the narrated run built this session (5.4), which walks the whole loop by itself and settles in about twenty seconds. |
| 4.2 | Shot list — the leak-surface table on `/privacy` → the action list a wallet actually receives → **the narrated run** (menu → "Show me how it works, narrated") which covers band, fire, cutoff and settlement in six captioned steps → recompute a settled market on `/m/<id>` with the copyable curl. | **DONE** — written up as [`docs/DEMO.md`](docs/DEMO.md): timed to three minutes, with the exact clicks, the words, and a "do not claim these on camera" section covering the band leak, the zero trades and mainnet. Every beat verified live this session. |
| 4.3 | Put the video URL in `strk20.json.demo_video`. | **BLOCKED on 4.1** — one string edit once the video exists. |
| 4.4 | Confirm `demo_url` resolves and every page it links loads without a wallet. | DONE — re-check after any redeploy |

### Phase 5 — Demo-readiness features · **NOT STARTED**

The ranked list is `docs/IDEAS.md`. Tier 1 items 4, 6, 7, 9, 11, 12, 13, 14 are built. These
six remain, in rank order. **1–3 are blocked on Phase 2** — they render a real position, and no
real position exists.

| # | Task | State |
| --- | --- | --- |
| 5.1 | **Idea 1 — the observer's view.** | **DONE** — `/verify`. Reads `get_position` off the deployed contract for any pasted commitment and lays what an observer learns beside what they cannot. **Was wrongly marked blocked**: it reads the chain, and "no position carries that commitment" is a real answer, not an empty state. Verified against the live contract. |
| 5.2 | **Idea 2 — anonymity set per market.** | **BLOCKED — and for a better reason than the one first recorded.** It is buildable today: `PositionOpened` carries the market id and commitment as indexed keys, so the set can be enumerated and grouped by reach. It should not be built yet. **On the deployed class the band is public**, so no two positions are indistinguishable and the anonymity set is exactly 1 for everyone. Publishing a number that implies a protection the deployment does not provide is worse than publishing nothing. Unblocks with B-1, not with 2.1. |
| 5.3 | **Idea 3 — `/verify`.** | **DONE** — same page as 5.1; they are one screen, not two. Takes a typed commitment rather than one this browser owns, because a page that can only inspect your own positions proves nothing about what a stranger sees. Ships the `starknet_getEvents` call that lists every commitment in a market, since the argument only lands once you can see the list is already public. |
| 5.4 | **Idea 5 — guided demo run.** | **DONE** — six narrated steps driving the real engine and the real keys, entered from the menu, ended by any touch. Verified end to end on production: the balance moved $250.00 → $248.50 on a real $1.50 stake, so it is the product running rather than a recording. |
| 5.5 | **Idea 8 — the settlement moment.** | **DONE** — the amount eases in over 620ms, scaled in integers so the display cannot drift from what was paid, and lands on the exact value even when no animation frame ever arrives. Verified: 37 distinct eased steps, monotonic, exact landing. The ramp itself could not be watched — the browser pane delivers 0 rAF frames/sec — which is also how the reduced-motion path was confirmed. |
| 5.6 | **Idea 10 — position export/import in the UI.** | **DONE** — the functions existed; the UI could not be reached. Export and import live in the Pool view, the Pool view lives behind the menu, and **the live desk had no menu** — `MenuSheet` has taken a `live` prop since it was written and nothing ever passed it. Wired, with the paper-only props made optional so the live menu shows no paper balance and no dead reset key. Round trip verified against the real store: a tampered file is refused (*"it has been altered"*), a valid one is accepted with the commitment recomputed from the preimage, listed, and exportable. |

### Phase 6 — Keeper economics, so it does not stall again · **NOT STARTED**

Measured today: ~0.5 STRK per listing, ~0.1 per relay, ~0.1 per settle. At 15-minute rounds
across three pairs that is roughly 4 STRK/hour — faster than any faucet.

| # | Task | State |
| --- | --- | --- |
| 6.1 | Batch relays, settles and listings into one transaction each, with per-item fallback when the batch exceeds the account's fee bounds. | DONE |
| 6.2 | Throttle relays by print age (`KEEPER_RELAY_MIN_AGE`, default 420s) rather than republishing on every Pragma tick. | DONE |
| 6.3 | **Make `create_market` stop re-writing the pricing table per market.** | **DONE** — tables are content-addressed by the Poseidon hash of their knots; the first market to carry one stores it, later markets store a pointer. Measured with a matched benchmark pair: **607,150 l2_gas and 1,536 l1_data_gas saved per repeat listing** (~0.018 STRK). The class grows 9,752 → 10,037 felts so the declare goes **57 → 60 STRK**; break-even is ~167 repeat listings, about fourteen hours at three pairs and fifteen-minute rounds. **Ships only with the next declare (Phase 1/3).** |
| 6.4 | Round length for the funding actually available. | **DONE — `KEEPER_TIER=2` (4h).** Faucet income is 0.208 STRK/hr; the relay alone costs 0.80. Continuous running is arithmetically impossible on that, so the goal is the most useful demo time per drip, not uptime: 5 STRK buys **0.4h at 15m rounds, 1.2h at 1h, 3.1h at 4h**. The floor of 3.5 STRK is one full listing round, so each drip funds exactly one complete round across three pairs and settles it rather than half-funding two. |
| 6.5 | Add a keeper alert when `stoppedListing` persists. | **DONE** — `/health` now returns **503** on either of two counts: no cycle in three periods, or two consecutive cycles unable to list, with an `unhealthy` string saying which. Verified in production: `503`, `ok:false`, *"has not listed a round for 3 cycles: balance … below the floor …"*, where it previously answered `200`/`ok:true` while completely stalled. One `stall` ledger row per transition — confirmed 1 row across 3 stalled cycles, not one per cycle. |

### Phase 7 — Verification and hygiene · **IN PROGRESS**

| # | Task | State |
| --- | --- | --- |
| 7.1 | Cairo tests (`pnpm test:cairo`). | **DONE** — 88, five of them new for the table dedup. |
| 7.2 | 84 SDK tests + 9 keeper tests (`pnpm test`). | DONE |
| 7.3 | Three packages typecheck clean. | DONE |
| 7.4 | `pnpm api:check` — every endpoint including failure paths. | **DONE** — all checks pass against `https://molfi.fun`. Against a local dev server it reports a 502 on `/api/markets`; that is the rate-limited public node, not a regression. |
| 7.5 | `pnpm verify` — 38 checks against the real network. | **IN PROGRESS — 34 PASS, 2 FAIL, 2 UNTESTED**, unchanged in substance from the start of this run: the FAILs are E1 (the relay is stale because the keeper cannot pay to republish) and **D13, added this run** (the deployed class stores the band); the two UNTESTED are D11/D12. All four are 0.1 and B-1, not code. C17 was tightened during this run: it asserted the keeper is *well*, which is a funding fact, and now asserts its answer is *coherent*. |
| 7.6 | `docs/TESTPLAN.md` — 156 items executed in a real browser. 143 PASS, 13 untestable, 0 outstanding FAIL. | DONE |
| 7.7 | No mocks, stubs, fixtures, TODOs or debug leftovers in shipped source. | DONE |
| 7.8 | Re-run 7.1–7.6 after every change; treat any regression as blocking. | **DONE for this run** — and it caught one: the stall detection made the keeper answer 503, `/api/keeper` mirrored it, and the site's own badge started reporting "the keeper did not answer" about a keeper that had answered. Found by re-running, fixed, re-verified. |
| 7.9 | README test count. | **DONE** — was 68, now 88 and correct. The "Live right now" and networks tables still need the mainnet row **once mainnet exists** (Phase 3). |
| 7.10 | `docs/API.md` accuracy. | **DONE** — `/api/keeper` was entirely undocumented while the README claims the file covers every endpoint (`pnpm verify` G4 checks docs→code, not code→docs, so it could not catch this). `/api/markets` was described as "every market the contract holds" when it is the newest sixty; `count`, `chainNow` and `network` were undocumented. Corrected. |

---

## 4. Gaps — the honest list

Every gap is tied to the task it blocks. Ordered by consequence, not by effort.

### Blocking — the product does not work without these

| Gap | Evidence | Blocks |
| --- | --- | --- |
| **The deployed Sepolia contract has no trading route.** `open_position`, `claim_position`, `quote_offsets`, `owner`, `set_oracle` are absent from the live class. | Probed the deployed ABI directly; `pnpm verify` D11/D12 UNTESTED | 1.3, 2.1–2.6, 5.1–5.3 |
| **Nobody has ever opened a position.** `staked` is 0 across all 49 markets. The core claim is unproven on chain. | `/api/markets`, total staked 0 | 2.1, 5.1, 5.2, 5.3 |
| **The keeper cannot pay for gas, and is short by 0.013 STRK.** One relay estimates at 0.09319 against a 0.08084 balance, so the relay is stale, market 49 sits past its cutoff, and listing is stopped. | Estimated against Sepolia; `pnpm verify` E1 FAIL | 0.1–0.5 |
| **The deployed class stores the band in the clear.** `Position` carries `band_low`/`band_high`; commitments are indexed event keys. The core privacy claim does not hold on the contract the site links to. | Read from the deployed ABI; `pnpm verify` D13 FAIL | B-1, 1.3 — the same declare fixes it |
| **Nothing is deployed to mainnet**, and the prize requires three mainnet pool transactions. | `networks.ts` `MOLFI_MARKET.mainnet = null`; preflight confirms no contract there | 3.1–3.8 |
| **`strk20.json.demo_video` is empty**, and it names `"network": "sepolia"` rather than mainnet. | The file itself | 4.1, 4.3, 3.7 |

### Real, non-blocking

| Gap | Evidence | Blocks |
| --- | --- | --- |
| ~~`create_market` re-writes the pricing table for every market~~ — **closed, and the premise was wrong.** The 18M L2 gas figure was a three-call batch (create + transfer + fund) including per-transaction overhead; the table write is ~607k of it. Deduplicated anyway: net positive after ~167 listings. | Benchmarked in `cairo/tests/test_market.cairo` | 6.3 — closed |
| Market bankroll is 0.05 STRK, so the desk can sell only ~0.2 STRK of exposure. The console now says so honestly, but it is not a tradeable size. | `KEEPER_BANKROLL`; the capacity line reads "DESK COVERS 0.202 STRK" | 0.5 |
| ~~Six Tier-1 demo features unbuilt~~ — **three closed** (guided run, settlement moment, export/import). Three remain and are blocked on a real position existing: observer's view, anonymity set, `/verify`. | `docs/IDEAS.md` | 5.1–5.3 |
| ~~README test count~~ — **closed.** | `snforge test` | 7.9 — closed |
| ~~No alerting when the keeper stops listing~~ — **closed.** `/health` answers 503 with the reason; one ledger row per transition. | Verified in production | 6.5 — closed |
| Sepolia rounds are 15 minutes, which is a demo luxury at 4× the keeper cost of tier 1. | `KEEPER_TIER=0` | 6.4 |

### Found by executing this plan, and closed

| Gap | Why it mattered | Where |
| --- | --- | --- |
| **The live desk had no menu at all.** Shield, withdraw, your positions, and the export that is the only way to recover a payout were reachable only from the demo desk, which correctly reports it has no pool. `MenuSheet` has accepted a `live` prop since it was written; nothing ever passed it. | The pool interaction UI — the part that makes this a STRK20 submission — was dead from the user's side on the only desk where it applies. | 5.6 |
| **A stored position vanished from the list whenever `/api/markets` was slow.** The read cycle threw before it ever built the position list, so the local store — the only index of what a browser owns — went invisible during a node outage. | A payout looked lost because a node was busy. The market data is enrichment for a row; it now degrades the row to "not found on chain" rather than removing it. | 5.6 |
| **`/privacy` asserted that the band never reaches the chain**, while the deployed class stores `band_low` and `band_high` in every position and commitments are indexed event keys. | The page whose whole purpose is stating what leaks was overstating the single claim the product is named for. It now reads the deployed ABI at render time and prints a red banner instead, retracting itself automatically once a class without the band is live. `pnpm verify` D13 pins it. | B-1, 5.1 |
| **`/api/keeper` was undocumented** while the README claims `docs/API.md` covers every endpoint, and **`/api/markets` was documented as returning every market** when it returns the newest sixty. | `pnpm verify` G4 checks that every path the docs name exists, not that every path that exists is named, so neither could be caught automatically. | 7.10 |
| **A permanent failure was retried three times because a balance contained "502".** `transient` matched the HTTP status codes as bare substrings, and `…80843186574050224` contains `502`. Almost every Starknet error quotes a token amount. | Not a rare collision: permanent failures were being retried on most of the occasions it mattered, three estimates and three round trips at a time. Codes are now matched as their own token, pinned with the real message. | 6.5, 0.4 |
| **Fee bounds were not capped to what the account can pay.** The chain validates against the bound, not the fee, so an account can be refused a transaction it could afford. | Built expecting it to unblock the keeper; measuring showed the shortfall is on the bare fee, so it does not. Kept because it now refuses before signing and names both numbers, where the node answers with two hundred characters of gas dictionaries after spending a nonce. | 0.1 |
| **The count-up would have shown `$0.00` in a tab that is not painting.** `requestAnimationFrame` does not fire there, and the initial value was zero. | Introduced and caught in the same run: the animation is decoration, the number is not. A timeout now guarantees the landing. | 5.5 |
| **The site reported "the keeper did not answer" about a keeper that answered.** 6.5 made the keeper return 503 when stalled; `/api/keeper` mirrored the status; `fetchJson` throws on non-2xx; the badge concluded unreachable. | A regression this run introduced and this run caught, by re-running the checks after the change rather than at the end. `/api/keeper` now answers 200 with the verdict in the body; `/api/health` stays the 503 surface. | 6.5, 7.8 |

### Untestable, not gaps — recorded so they are not re-litigated

| Item | Why |
| --- | --- |
| Sub-accounts | The Wallet API route does not exist; SDK-only. Explicitly out of scope. |
| Running a prover | No public STRK20 prover endpoint exists. |
| OS-level `prefers-reduced-motion` | Cannot be emulated by the browser tooling. The CSS rule is present and correct; the in-app toggle is verified. |
| `/favicon.ico` 404 | Next serves `/icon.svg` via `<link rel="icon">`; no browser in testing requested `.ico`. |

### Checked and clean — do not spend time re-auditing

- **No mocks, stubs, fakes, dummies, fixtures or placeholder data** in `apps/web/src`,
  `packages/sdk/src` or `apps/keeper/src`. `StubOracle`/`StubToken` exist only in
  `cairo/tests/`, `cairo/src/devnet.cairo` and the devnet branch of `scripts/deploy.mjs`;
  `scripts/verify.mjs` G1 enforces this on every run.
- **No `TODO`, `FIXME`, `HACK`, `XXX`, `console.log`, `debugger` or `data-debug`** in shipped
  source. The only matches in the repo are the test plan describing the rule and the verifier
  implementing it.
- **No secrets in any API response** — scanned `/api/rpc`, `/api/config`, `/api/health`,
  `/api/keeper`, `/api/markets` for the Alchemy key, the database URL and the keeper key.
- **The browser cannot send a transaction through the RPC proxy** — all three write methods
  return 403.
- **The shipped app matches the deployed ABI**: `openActions` builds
  `privacy_invoke(operation:u8, market_id:u64, band_low:u256, band_high:u256, token, amount:u128, secret, note_id)`
  — ten felts, verified felt by felt — and the console probes for and suppresses the route the
  deployed contract lacks.

---

## 5. Order of execution

1. **Fund the keeper** (0.1). Cheapest, and it restores the public demo to a working state.
2. **Record the demo video** (4.1) — the only hard submission requirement that costs nothing
   but time, and it can be recorded against the Sepolia desk once Phase 0 clears.
3. **Decide where the declare goes.** If STRK is scarce, mainnet (Phase 3) before Sepolia
   (Phase 1) — the prize requires mainnet, mainnet needs no relay, and its 4-hour rounds are
   cheap to keep alive.
4. **Deploy, then trade** (Phase 1 or 3, then Phase 2). One real position turns three of the
   project's strongest unbuilt features from blocked to buildable.
5. **`pnpm submission`** (3.7) and check `strk20.json`.
6. **Phase 5 features**, top of the ranked list down, as time allows.
7. **Phase 6.3** (the table rewrite) only if a declare is happening anyway — it is a contract
   change and cannot ship without one.

Re-run `pnpm verify` and `pnpm test` after every phase. The bar is 37/37 with no UNTESTED.
