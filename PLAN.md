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

**B-1 · The deployed Sepolia class predates the public trading route.**
Probed against the live ABI. The deployed class has `privacy_invoke`, `settle`, `fund_market`,
`create_market`, `get_market`, `get_table`, `get_position`, `quote_band`, `accounted_for`,
`pool`, `oracle`. It does **not** have `open_position`, `claim_position`, `quote_offsets`,
`owner` or `set_oracle`. The source in `cairo/src/market.cairo` has all of them and 81 tests
pass against it. Fixing this needs a declare: **9,752 Sierra felts ≈ 57 STRK on mainnet, ~60 on
Sepolia.** No change to this repository can clear it.

**B-2 · The keeper is out of STRK.**
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
| 0.1 | Fund `0x788e67ade3c9e65e04c391518e9de7036a548e9733193d7d6a63ab85f0e9e8f` with ≥ 30 STRK. | **BLOCKED** — faucet agent API attempted 2026-09-06 06:45, answered `ADDRESS_COOLDOWN`, **16.5h remaining**. No other account holds STRK (keeper 0.0800, `account-1` 0, `e2e-stranger` 0). Dripping to a second address to dodge the per-address cooldown is abuse of a shared testnet and was not done. The 100 STRK form is Turnstile-gated and 3,000 needs a GitHub sign-in — both human steps. |
| 0.2 | Confirm the relay catches up: `curl -s molfi.fun/api/health` reports every pair `settleable: true`. | BLOCKED on 0.1 |
| 0.3 | Confirm market 49 settles and a new round lists: `/api/markets` shows 3 open. | BLOCKED on 0.1 |
| 0.4 | Re-run `pnpm verify`; E1 must turn PASS. | BLOCKED on 0.1 |
| 0.5 | Raise `KEEPER_BANKROLL` to ≥ `2` STRK so a market can cover a stake worth firing. At the live value the desk can sell ~0.2 STRK of exposure, which reads as broken even when it works. **Edit the Railway variable, not the code**: `apps/keeper/src/index.ts` defaults to `0.2` STRK but the deployed service overrides it to `0.05`. Project `cf1bcefd-0fad-490a-af41-158e1c375255`, service `b081214d-69ef-43cf-83da-638a165af468`. | BLOCKED on 0.1 |

### Phase 1 — Put the trading route on Sepolia · **BLOCKED (B-1)**

| # | Task | State |
| --- | --- | --- |
| 1.1 | Fund a deployer with ≥ 65 STRK on Sepolia and set `DEPLOYER_ADDRESS`. | BLOCKED |
| 1.2 | `pnpm preflight --network sepolia` — must be clear, including affordability. | BLOCKED on 1.1 |
| 1.3 | `node --experimental-strip-types scripts/deploy.mjs --network sepolia` — declares the current class and deploys `MolfiMarket`, writing `deployments/sepolia.json`. | BLOCKED on 1.1 |
| 1.4 | Update `MOLFI_MARKET.sepolia` in `packages/sdk/src/networks.ts` to the new address. Exactly one line changes. | BLOCKED on 1.3 |
| 1.5 | Set `MOLFI_MARKET` on the Railway keeper service to the new address and redeploy. | BLOCKED on 1.3 |
| 1.6 | Redeploy the web app (`npx vercel --prod --yes`) so `/live`, `/m/<id>` and the console read the new contract. | BLOCKED on 1.4 |
| 1.7 | Confirm the direct-route probe flips: the live desk stops saying "POOL ONLY HERE" and offers both routes to a capable wallet. `useLiveDesk` probes `quote_offsets`; no code change needed. | BLOCKED on 1.6 |
| 1.8 | Re-run `pnpm verify`; D11 and D12 must leave UNTESTED. | BLOCKED on 1.6 |

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
| 3.2 | `pnpm preflight` (defaults to mainnet). Currently clear with 2 warnings, both about the unset deployer. | IN PROGRESS — passes except affordability |
| 3.3 | `scripts/deploy.mjs --network mainnet`. Deploys `MolfiMarket` only — **`PriceRelay` must not be deployed to mainnet**; markets settle against Pragma directly. | NOT STARTED |
| 3.4 | Set `MOLFI_MARKET.mainnet` in `networks.ts`. | NOT STARTED |
| 3.5 | List and fund one mainnet market per pair at **tier 2 (4h)** — mainnet needs no relay and long rounds cut keeper burn to roughly one listing and one settle per pair per 4 hours. | NOT STARTED |
| 3.6 | Execute **three transactions through the mainnet pool** `0x040337b1af3c663e86e333bab5a4b28da8d4652a15a69beee2b677776ffe812a`. Suggested: shield, open a position, claim it. | NOT STARTED |
| 3.7 | `pnpm submission` — defaults to mainnet, fills `strk20.json` from `deployments/mainnet.json`, verifies every address holds a contract before recording it, and refuses outright to fill from a devnet deployment. | NOT STARTED |
| 3.8 | Verify `strk20.json` names mainnet, lists the mainnet contracts, and lists the three pool transactions. | NOT STARTED |

### Phase 4 — Submission artifacts · **NOT STARTED**

| # | Task | State |
| --- | --- | --- |
| 4.1 | Record a **3-minute demo video**. `strk20.json.demo_video` is an empty string — this is a hard submission requirement and the single cheapest unmet one. | NOT STARTED |
| 4.2 | Suggested cut: the leak-surface table on `/privacy` → the action list a wallet actually receives → open a position on the console → the cutoff ring draining → settlement → recompute it on `/m/<id>` with the copyable curl. | NOT STARTED |
| 4.3 | Put the video URL in `strk20.json.demo_video`. | NOT STARTED |
| 4.4 | Confirm `demo_url` resolves and every page it links loads without a wallet. | DONE — re-check after any redeploy |

### Phase 5 — Demo-readiness features · **NOT STARTED**

The ranked list is `docs/IDEAS.md`. Tier 1 items 4, 6, 7, 9, 11, 12, 13, 14 are built. These
six remain, in rank order. **1–3 are blocked on Phase 2** — they render a real position, and no
real position exists.

| # | Task | State |
| --- | --- | --- |
| 5.1 | **Idea 1 — the observer's view.** For a real position, show side by side what the chain reveals (commitment, reach ratios, stake, owner) and what it cannot (the band), read live from Sepolia. | BLOCKED on 2.1 |
| 5.2 | **Idea 2 — anonymity set per market.** Count open positions sharing an indistinguishable reach; print it on `/m/<id>` and the console. | BLOCKED on 2.1 |
| 5.3 | **Idea 3 — `/verify`.** Paste any commitment, get the full audit. The verifier is per-market today (`/api/audit/<id>`); this is the per-position one a trader wants. Reuse `readPosition` in `apps/web/src/lib/market-reads.ts`. | BLOCKED on 2.1 |
| 5.4 | **Idea 5 — guided demo run.** One key drives connect → band → fire → settle → claim with narration. Judges have four minutes. | NOT STARTED |
| 5.5 | **Idea 8 — the settlement moment.** The band resolves, the ring completes, the payout counts up. `settleFlash` and the 620ms expanding ring exist in `RangeChart`; the payout count-up does not. | NOT STARTED |
| 5.6 | **Idea 10 — position export/import in the UI.** The secret is the only key to the payout; recovery must be a first-class flow, not console-only. | NOT STARTED |

### Phase 6 — Keeper economics, so it does not stall again · **NOT STARTED**

Measured today: ~0.5 STRK per listing, ~0.1 per relay, ~0.1 per settle. At 15-minute rounds
across three pairs that is roughly 4 STRK/hour — faster than any faucet.

| # | Task | State |
| --- | --- | --- |
| 6.1 | Batch relays, settles and listings into one transaction each, with per-item fallback when the batch exceeds the account's fee bounds. | DONE |
| 6.2 | Throttle relays by print age (`KEEPER_RELAY_MIN_AGE`, default 420s) rather than republishing on every Pragma tick. | DONE |
| 6.3 | **Make `create_market` stop re-writing the pricing table per market.** | **DONE** — tables are content-addressed by the Poseidon hash of their knots; the first market to carry one stores it, later markets store a pointer. Measured with a matched benchmark pair: **607,150 l2_gas and 1,536 l1_data_gas saved per repeat listing** (~0.018 STRK). The class grows 9,752 → 10,037 felts so the declare goes **57 → 60 STRK**; break-even is ~167 repeat listings, about fourteen hours at three pairs and fifteen-minute rounds. **Ships only with the next declare (Phase 1/3).** |
| 6.4 | Move Sepolia to tier 1 (1h) or tier 2 (4h) rounds if funding stays tight; 15-minute rounds are a demo luxury costing 4× tier 1. Railway var `KEEPER_TIER` (`0`=15m, `1`=1h, `2`=4h), currently `0`. | NOT STARTED |
| 6.5 | Add a keeper alert when `stoppedListing` has been set for more than one cycle, so the desk going quiet is noticed rather than discovered. | NOT STARTED |

### Phase 7 — Verification and hygiene · **IN PROGRESS**

| # | Task | State |
| --- | --- | --- |
| 7.1 | 81 Cairo tests (`pnpm test:cairo`). | DONE |
| 7.2 | 84 SDK tests + 9 keeper tests (`pnpm test`). | DONE |
| 7.3 | Three packages typecheck clean (`pnpm typecheck`). | DONE |
| 7.4 | `pnpm api:check` — every endpoint including failure paths. | DONE |
| 7.5 | `pnpm verify` — 37 checks against the real network. **34 PASS, 1 FAIL, 2 UNTESTED.** | IN PROGRESS |
| 7.6 | `docs/TESTPLAN.md` — 156 items executed in a real browser. 143 PASS, 13 untestable, 0 outstanding FAIL. | DONE |
| 7.7 | No mocks, stubs, fixtures, TODOs or debug leftovers in shipped source. | DONE |
| 7.8 | Re-run 7.1–7.6 after every phase above; treat any regression as blocking. | NOT STARTED |
| 7.9 | Update `README.md` "Live right now" and the networks table once mainnet exists. It currently says the market contract has "68 tests" — the real number is 81. | NOT STARTED |
| 7.10 | Update `docs/API.md` if Phase 1 changes any response shape. | NOT STARTED |

---

## 4. Gaps — the honest list

Every gap is tied to the task it blocks. Ordered by consequence, not by effort.

### Blocking — the product does not work without these

| Gap | Evidence | Blocks |
| --- | --- | --- |
| **The deployed Sepolia contract has no trading route.** `open_position`, `claim_position`, `quote_offsets`, `owner`, `set_oracle` are absent from the live class. | Probed the deployed ABI directly; `pnpm verify` D11/D12 UNTESTED | 1.3, 2.1–2.6, 5.1–5.3 |
| **Nobody has ever opened a position.** `staked` is 0 across all 49 markets. The core claim is unproven on chain. | `/api/markets`, total staked 0 | 2.1, 5.1, 5.2, 5.3 |
| **The keeper cannot pay for gas.** 0.0808 STRK; relay stale by up to 15,882s; one market past cutoff unsettled; listing stopped. | `pnpm verify` E1 FAIL; `/api/keeper` | 0.1–0.5 |
| **Nothing is deployed to mainnet**, and the prize requires three mainnet pool transactions. | `networks.ts` `MOLFI_MARKET.mainnet = null`; preflight confirms no contract there | 3.1–3.8 |
| **`strk20.json.demo_video` is empty**, and it names `"network": "sepolia"` rather than mainnet. | The file itself | 4.1, 4.3, 3.7 |

### Real, non-blocking

| Gap | Evidence | Blocks |
| --- | --- | --- |
| ~~`create_market` re-writes the pricing table for every market~~ — **closed, and the premise was wrong.** The 18M L2 gas figure was a three-call batch (create + transfer + fund) including per-transaction overhead; the table write is ~607k of it. Deduplicated anyway: net positive after ~167 listings. | Benchmarked in `cairo/tests/test_market.cairo` | 6.3 — closed |
| Market bankroll is 0.05 STRK, so the desk can sell only ~0.2 STRK of exposure. The console now says so honestly, but it is not a tradeable size. | `KEEPER_BANKROLL`; the capacity line reads "DESK COVERS 0.202 STRK" | 0.5 |
| Six Tier-1 demo features unbuilt (observer's view, anonymity set, `/verify`, guided run, settlement moment, export/import). | `docs/IDEAS.md` | 5.1–5.6 |
| `README.md` says the Cairo suite has 68 tests; it has 81. | `snforge test` | 7.9 |
| No alerting when the keeper stops listing. It went quiet for hours today and was found by hand. | Railway logs | 6.5 |
| Sepolia rounds are 15 minutes, which is a demo luxury at 4× the keeper cost of tier 1. | `KEEPER_TIER=0` | 6.4 |

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
