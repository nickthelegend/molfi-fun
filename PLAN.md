# molfi — build plan

A builder agent should be able to pick any single task below and start cold. Every task says
what to change and what "done" looks like. Nothing here is built in this pass; this is the
map, and the gap list at the end is deliberately unflattering.

---

## 1. What done and winning actually mean

### The product

**molfi is a prediction market where nobody can see your position until it settles.** You pick
a price range on an asset, pick how long it has to hold, and stake on it. Your range and your
size are a commitment, never an address.

### Why this is a STRK20 submission rather than a market that happens to use a pool

The hackathon rewards privacy that is load-bearing. Here it is: **on a public chain your order
is a signal before it is a trade.** Anyone watching can price against it, crowd it, or get
there first — which is the reason informed flow stays off-chain. Take the privacy away and
molfi is a worse version of every public prediction market. That is the test the pitch has to
pass, and it passes it.

### Done

1. A trader opens a position through their **own privacy wallet**. The dapp never sees a
   viewing key. (Docs are explicit: *"Do not ask a normal dapp user for their viewing key."*)
2. Opening a position runs the pool sandwich: pool withdraws to molfi's **anonymizer contract**,
   the contract parks the stake against a commitment and returns an **empty span**.
3. A market settles against a **fresh Pragma median** at a stated block.
4. Claiming a win runs the sandwich again: the contract approves the pool and returns an
   `OpenNoteDeposit` crediting the winner's open note.
5. Anyone can recompute a settled market from published data and check it against what the
   contract paid — no account, no wallet, no position.
6. The console is genuinely good: 3D device, a dial that shifts markets, real prices.

### Winning

- **Three mainnet transactions through the pool** at
  `0x040337b1af3c663e86e333bab5a4b28da8d4652a15a69beee2b677776ffe812a`, in `strk20.json`.
- Contracts listed in `strk20.json`.
- A 3-minute demo video and a reachable `demo_url`.
- The privacy claim states its own edges. Every project claims privacy; almost none print what
  stays public.

### Explicitly not goals

Sub-accounts (Wallet API route does not exist yet — SDK only), running our own prover, a
bridge, or an order book. Each widens the pitch and none of them is the thing being judged.

---

## 2. Architecture, decided

The docs prescribe the route and there is no judgement call left in it:

> *"For private DeFi integrations, expect both a Starknet Wallet API flow and an app-specific
> anonymizer contract."*

| Layer | Choice | Why |
| --- | --- | --- |
| User keys | **Starknet Wallet API** | Recommended route for private dapps. Wallet owns viewing keys, notes, proving, submission. |
| Contract | **Anonymizer with `privacy_invoke`** | The pool's only way to call an app atomically. |
| Shape | **Stateful, escrow-like** | Open parks funds and returns an empty span; settle credits an `OpenNoteDeposit`. The Escrow helper is the exact template. |
| Price | **Pragma** (`get_data_median`) | Verified live on mainnet. Pyth is deployed on Starknet and returns no prices — see gaps. |
| Chain | **Mainnet** | Pragma Sepolia is dead and the submission wants mainnet transactions. |

### The round length is forced by the oracle

XORR's thesis was three-second rounds on a 300ms chain. **Pragma updates every 7–10 minutes**,
so a three-second round cannot be settled honestly. molfi rounds are **minutes to hours**. This
is not a preference; it is what the data source supports, and building the short-round UI
anyway would be a demo that cannot settle.

---

## 3. Phases

### Phase 1 — Cairo: the market contract  ·  **DONE**

The submission is a contract. Everything else is a client for it.

| # | Task | State |
| --- | --- | --- |
| 1.1 | Scaffold `cairo/` with Scarb + snforge; depend on the `privacy` package for `OpenNoteDeposit` and `INVOKE_SELECTOR`. | **DONE** |
| 1.2 | Port `Pricing.sol` to `pricing.cairo` — integer only, same truncating division, so the TS kernel mirrors it exactly. | **DONE** |
| 1.3 | Parity harness: run `packages/sdk/src/pricing.ts` and the Cairo library over thousands of inputs, assert identical output. XORR's `test/parity.ts` is the template. | **DONE** |
| 1.4 | `MarketRegistry`: create a market (pair id, band, open block, cutoff block, oracle), list open markets, freeze at cutoff. | **DONE** |
| 1.5 | `MolfiAnonymizer.privacy_invoke` — **operation 0, open**: store `poseidon(POSITION_TAG, secret, market_id, band_lo, band_hi)`, park the stake, **return an empty span**. | **DONE** |
| 1.6 | `privacy_invoke` — **operation 1, claim**: recompute the commitment from the preimage, check the market settled and the band contains the settled price, mark claimed, approve the pool, return one `OpenNoteDeposit`. | **DONE** |
| 1.7 | Assert the caller is the pool on every `privacy_invoke` path. | **DONE** |
| 1.8 | Double-claim protection: the `claimed` flag flips exactly once. | **DONE** |
| 1.9 | `settle(market_id)` — permissionless. Read Pragma `get_data_median`, reject a print older than `MAX_PRICE_AGE` or with fewer than 3 publishers, store price + timestamp + sources. | **DONE** |
| 1.10 | Payout maths: multiplier from the pricing library, protocol fee in bps, conservation assert (paid ≤ staked). | **DONE** |
| 1.11 | snforge suite: open, settle inside band, settle outside band, claim, double claim, claim before settle, stale oracle, single-source oracle, non-pool caller. | **DONE** |
| 1.12 | Measure Sierra size and declare cost before any mainnet spend. | **DONE** |

### Phase 2 — Oracle and market data  ·  **DONE** except the server route

| # | Task | State |
| --- | --- | --- |
| 2.1 | Pragma adapter: addresses, pair-id encoding, response decode, freshness rules. | **DONE** |
| 2.2 | Adapter tests including the Sepolia failure (recent print, one publisher). | **DONE** — 44 tests |
| 2.3 | Live read verified against mainnet and Sepolia. | **DONE** |
| 2.4 | Recalibrate the probability tables for minute-to-hour rounds. The shipped tables are MON/BTC/ETH on three-second rounds and are wrong for this horizon. | **DONE** |
| 2.5 | Replace `orderbook.ts` (Kuru CLOB) with a Pragma-backed price source, or delete it. | **DONE** |
| 2.6 | Strip `MON-USD` from markets; define the molfi set (BTC/USD, ETH/USD, STRK/USD). | **DONE** |
| 2.7 | Server-side price route so the browser never holds an RPC key, with the freshness verdict included. | NOT STARTED |

### Phase 3 — Wallet and pool integration  ·  NOT STARTED

| # | Task | State |
| --- | --- | --- |
| 3.1 | Wallet connect: `get-starknet` picker, detect privacy capability, refuse gracefully when absent. | NOT STARTED |
| 3.2 | Detect and surface registration state; a user with no viewing key cannot hold a private balance. | NOT STARTED |
| 3.3 | Shield flow — public STRK into the pool, with the public leg named as public. | NOT STARTED |
| 3.4 | Open-position flow via `strk20InvokeTransaction`: transfer to open note, then invoke molfi's anonymizer. | NOT STARTED |
| 3.5 | Claim flow: same sandwich, operation 1, credits the winner's open note. | NOT STARTED |
| 3.6 | Unshield flow — private balance back to a public address. | NOT STARTED |
| 3.7 | Shielded balance display, read through the wallet, never by holding a key. | NOT STARTED |
| 3.8 | Dry-run before every invoke; show the quote the user is about to be charged. | NOT STARTED |
| 3.9 | Position secrets: generated client-side, offered as copy **and** file download at the moment of creation. Losing one loses the payout. | NOT STARTED |
| 3.10 | Wrong-network guard — mainnet vs Sepolia mismatch named before any action fails. | NOT STARTED |

### Phase 4 — The console  ·  NOT STARTED

| # | Task | State |
| --- | --- | --- |
| 4.1 | Scaffold `apps/web` (Next.js) as the console app; the hub stays the marketing site. | NOT STARTED |
| 4.2 | Port `Console3D` + `DeviceFrame` — procedural geometry from the SDK, no GLB fetch, no CDN decoders. | NOT STARTED |
| 4.3 | Port `RangeChart`, `CutoffRing`, `Odometer`, `BootSequence`, `Controls`. | NOT STARTED |
| 4.4 | **The dial shifts markets.** Rotating it cycles BTC → ETH → STRK; the chart, price and quote all follow. Keyboard and wheel bound to the same action. | NOT STARTED |
| 4.5 | Second axis on the dial: round length, over the horizons Pragma can actually settle. | NOT STARTED |
| 4.6 | Band painting — drag the range on the chart, live multiplier from the kernel. | NOT STARTED |
| 4.7 | Live price ticking from Pragma with a visible staleness state; a stale feed disables firing rather than quoting into it. | NOT STARTED |
| 4.8 | Position list: open, settled, claimable — sourced from the chain, not local storage. | NOT STARTED |
| 4.9 | Boot sequence and device motion honouring `prefers-reduced-motion`. | NOT STARTED |
| 4.10 | Mobile: the console has to be usable at 380px or be honestly replaced by a compact layout. | NOT STARTED |

### Phase 5 — The verifier  ·  NOT STARTED

The thing that made the previous project credible, carried over.

| # | Task | State |
| --- | --- | --- |
| 5.1 | `auditMarket()` in the SDK: recompute settled price, band outcome, multiplier and payout from published data. | NOT STARTED |
| 5.2 | `/verify/<market>` — contract's answer beside the recomputed one, per line, with why each check matters. | NOT STARTED |
| 5.3 | Tamper test: altering the settled price must flag exactly the affected checks. | NOT STARTED |
| 5.4 | Verifier works for a stranger — no wallet, no position. | NOT STARTED |

### Phase 6 — Deploy and submit  ·  NOT STARTED

| # | Task | State |
| --- | --- | --- |
| 6.1 | Mainnet preflight, read-only: chain id, pool live, Pragma fresh, deployer funded, contract size. | NOT STARTED |
| 6.2 | Deploy the anonymizer + market registry to mainnet. **Spends real money — human decision.** | BLOCKED |
| 6.3 | Three real mainnet transactions through the pool; hashes into `strk20.json`. | BLOCKED |
| 6.4 | Deploy the console; set the repo Website field so `demo_url` is auto-detected. | NOT STARTED |
| 6.5 | Fill `contracts` in `strk20.json`. | NOT STARTED |
| 6.6 | Record the 3-minute demo. | BLOCKED |
| 6.7 | Full test plan across every page, endpoint and contract path, browser-verified. | NOT STARTED |

---

## 4. Gaps — the honest list

### Blocking, and known

| # | Gap | Blocks | Note |
| --- | --- | --- | --- |
| G1 | **No Cairo contract exists.** The entire settlement layer is unwritten. `cairo/` was deleted with the games. | All of Phase 1 | **CLOSED** — MolfiMarket written, 34 Cairo tests, 5,241 sierra felts |
| G2 | **Pyth does not work on Starknet.** Dropped 26 Aug 2026. Contracts still deployed on both networks and every feed returns `None` — verified for BTC, ETH, STRK. | 2.x | Resolved by using Pragma, recorded because the trap is that it *looks* wired up. |
| G3 | **Pragma Sepolia is dead.** BTC's last print is ~329 days old; ETH and STRK have one publisher. | 6.2 | **STILL TRUE** — forces mainnet for a real settlement |
| G4 | **Pragma mainnet updates every 7–10 minutes.** | 2.4, 4.5 | Kills three-second rounds. Round lengths must be minutes to hours. |
| G5 | **No wallet connect at all.** Nothing in the repo touches a wallet. | All of Phase 3 | |
| G6 | **Probability tables are calibrated for the wrong instrument.** They are MON/BTC/ETH over three-second rounds. | 2.4 | **CLOSED** — recalibrated on 43,200 real minute closes per market |
| G7 | **`orderbook.ts` is Kuru-specific** — a Monad CLOB that does not exist here. | 2.5 | **CLOSED** — orderbook.ts deleted |
| G8 | **`markets.ts`, `engine.ts`, `format.ts`, `generated/markets.ts` still reference Monad/MON.** | 2.6 | |
| G9 | **No console app.** `apps/web` is untracked leftover, not a molfi app. | All of Phase 4 | |
| G10 | **No verifier.** | Phase 5 | |
| G11 | **`strk20.json` is empty** — no contracts, no transactions, no demo. | 6.3–6.6 | Correct today; every field is a deliverable. |

### Housekeeping

| # | Gap | Note |
| --- | --- | --- |
| G12 | **Untracked game leftovers on disk** — `apps/crewkill` (148 files), `apps/poker` (234), `apps/web` (29), `packages/mental-poker` (10), `packages/crewkill-mcp` (4). Git-removed, still present locally. | Confusing to anyone reading the tree. Delete from disk. |
| G13 | Hub nav points at `/markets`, `/how-it-works`, `/contracts` — **none of which exist**. Every nav link 404s. | Real broken links on the live site. |
| G14 | `packages/protocol` is 39 lines. Fold into the SDK or keep deliberately. | Judgement call, not a defect. |
| G15 | No CI. Nothing runs the 80 SDK tests on push. | |

### Not gaps, recorded so they are not re-litigated

- **Zero mock/stub/TODO/fake/placeholder hits** across the whole tree. Swept, clean.
- The pricing kernel is ported and green: **80 tests** (36 pricing, 44 oracle).
- The STRK20 pool addresses are pinned and verified live on both networks.

---

## 5. Order of execution

1. **G12, G13** — an hour, and the tree stops lying about what it is.
2. **Phase 1** — the contract. Nothing else can be demonstrated without it.
3. **Phase 2.4–2.7** — recalibrate, or every quote is wrong.
4. **Phase 3** — wallet, then the app can be used by a human.
5. **Phase 4** — the console.
6. **Phase 5** — the verifier, which is what makes the privacy claim checkable.
7. **Phase 6** — deploy, and stop at 6.2 for a human decision about real money.

The risk worth naming: **Phase 1 is large and unstarted, and everything demonstrable sits
behind it.** If time runs short, a contract on mainnet with a plain UI beats a beautiful
console with nothing underneath it.
