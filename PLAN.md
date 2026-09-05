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
| 2.7 | Server-side price route so the browser never holds an RPC key, with the freshness verdict included. | **DONE** — plus an RPC proxy, so the browser holds no key at all |

### Phase 3 — Wallet and pool integration  ·  **DONE**

| # | Task | State |
| --- | --- | --- |
| 3.1 | Wallet connect: `get-starknet` picker, detect privacy capability, refuse gracefully when absent. | **DONE** — get-starknet v6 + `WalletAccountV6` |
| 3.2 | Detect and surface registration state; a user with no viewing key cannot hold a private balance. | **DONE** — capabilities are probed, not assumed |
| 3.3 | Shield flow — public STRK into the pool, with the public leg named as public. | **DONE** |
| 3.4 | Open-position flow via `strk20InvokeTransaction`. | **DONE** — no open note; the helper returns an empty span |
| 3.5 | Claim flow: same sandwich, operation 1, credits the winner's open note. | **DONE** — opens the note first, references `${openNoteIds[0]}` |
| 3.6 | Unshield flow — private balance back to a public address. | **DONE** |
| 3.7 | Shielded balance display, read through the wallet, never by holding a key. | **DONE** — unknown renders as unknown, never as zero |
| 3.8 | Dry-run before every invoke. | **DONE** — `strk20PrepareInvoke` where the wallet supports it |
| 3.9 | Position secrets: generated client-side, offered as a file download at creation. | **DONE** — written to disk *before* the transaction is offered |
| 3.10 | Wrong-network guard. | **DONE** |

**The one thing not yet proven:** the pool sandwich has never run against the real pool. The
calldata order follows the escrow helper in the docs and the local run drives `privacy_invoke`
directly, with the deploying account standing in for the pool — so the contract's side is
exercised for real and the *pool's* deserialization is not. `strk20PrepareInvoke` is a dry run
against the live pool and is the cheapest way to settle it; it needs a funded mainnet account.

### Phase 4 — The console  ·  **DONE**

The whole `apps/web` from `nickthelegend/xorr-monad` was brought in and ported, rather than
rebuilt: the device frame, the range chart, the boot sequence, the controls, the menu system,
the paper desk. What was Monad-specific was replaced rather than reskinned.

| # | Task | State |
| --- | --- | --- |
| 4.1 | Scaffold `apps/web` as the console app. | **DONE** |
| 4.2 | Port `Console3D` + `DeviceFrame` — procedural geometry, no CDN decoders. | **DONE** |
| 4.3 | Port `RangeChart`, `CutoffRing`, `Odometer`, `BootSequence`, `Controls`. | **DONE** — the ring counts time, not blocks |
| 4.4 | The dial shifts markets. | **DONE** |
| 4.5 | Second axis: round length, over the horizons Pragma can settle. | **DONE** — 15m / 1h / 4h |
| 4.6 | Band painting — drag the range, live multiplier from the kernel. | **DONE** |
| 4.7 | Live price with a visible staleness state. | **DONE** — the oracle strip is on the deck, not in a sheet |
| 4.8 | Position list: open, settled, claimable. | **DONE** — from local secrets joined to chain state, because the chain cannot list them |
| 4.9 | Boot sequence and motion honouring `prefers-reduced-motion`. | **DONE** |
| 4.10 | Mobile: usable at 380px. | **DONE** — the layout is a handheld device and always was |

Sheets with no counterpart were removed rather than reskinned: no vault (the market contract
is its own bankroll), no MON swap (the stake token *is* the gas token), no Kuru book (there is
no CLOB behind the mark), and **no player leaderboard** — the chain cannot attribute a win to
an address, so a ranking would be a table of guesses. The board ranks markets instead.

### Phase 5 — The verifier  ·  **DONE**

| # | Task | State |
| --- | --- | --- |
| 5.1 | `auditMarket()` in the SDK. | **DONE** — 11 checks, each carrying both answers and why it matters |
| 5.2 | `/m/<id>` — the contract's answer beside the recomputed one. | **DONE** — also `/api/audit/<id>` as JSON |
| 5.3 | Tamper test: altering a market must flag exactly the affected checks. | **DONE** — a single changed table knot, a dipped table, a stale print, a thin print, an insolvent market, an undisclosed fee |
| 5.4 | Works for a stranger — no wallet, no position. | **DONE** — server-rendered from contract calls |

Building it found two things the contract was not recording. It did not store its round
length, so the check that matters most — that it prices with the table molfi published —
could never run; and it did not store when it settled, so the freshness check compared the
print against the cutoff and reported a negative age for markets that had settled correctly.
Both are now stored.

### Phase 6 — Deploy and submit

| # | Task | State |
| --- | --- | --- |
| 6.1 | Mainnet preflight, read-only. | **DONE** — `pnpm preflight`, and it is currently clear |
| 6.2 | Deploy the anonymizer to mainnet. **Spends real money — human decision.** | **DONE ON SEPOLIA**, blocked on mainnet. `0x02229b526282bfc2eb32ed48159f9955fc04abc1f66431809d4b5ee1ac62e953` — nine markets listed and funded with 1 STRK each, on a real public chain, through the same script mainnet would use. Mainnet needs a funded account; both configured accounts hold 0 there. |
| 6.3 | Three real mainnet transactions through the pool; hashes into `strk20.json`. | **PARTIAL.** Seven verified Sepolia transactions are in `strk20.json`, which carries a `network` field so they cannot be mistaken for mainnet. They are direct calls to molfi's contract, not calls *through* the pool — driving the pool needs a registered account holding a note, which needs a real deposit. `pnpm pool:probe` confirms the transaction shape is accepted by the deployed pool on both networks. |
| 6.4 | Deploy the console; set the repo Website field so `demo_url` is auto-detected. | **DONE** — https://molfi-production.up.railway.app, verified with `pnpm api:check` against the live URL. Repo Website field set. |
| 6.5 | Fill `contracts` in `strk20.json`. | **TOOLED, and fillable from Sepolia today** — `pnpm submission --network mainnet` fills it from `deployments/mainnet.json`, verifies every address holds a contract and every transaction actually succeeded, and refuses a devnet deployment outright |
| 6.6 | Record the 3-minute demo. | BLOCKED — a person has to narrate it. There is something to record: the console is live on a real public-chain deployment, and `/m/1` recomputes a real market from the chain. |
| 6.7 | Full test plan across every page, endpoint and contract path. | **DONE for contract and API** — `pnpm api:check` green against the live public site backed by the real Sepolia contract, `pnpm e2e:devnet` green for the full open/settle/claim cycle. The UI is being rebuilt separately. |

**Deployed on Sepolia:** `0x02229b526282bfc2eb32ed48159f9955fc04abc1f66431809d4b5ee1ac62e953`, nine
markets funded with 1 STRK each, contract ledger and token balance agreeing exactly. The
console at https://molfi-production.up.railway.app serves it, and `/api/audit/1` recomputes it.
Those markets can never settle — Pragma Sepolia stopped publishing months ago — so the
deployment proves the deploy path and the contract, not trading.

**Preflight against mainnet, today:** the node is on `SN_MAIN`, the STRK20 pool is deployed at
the address in the config, STRK is where it should be, all three Pragma pairs are settleable
(10–12 publishers, ~8 minutes old), and the contract is 6,899 Sierra felts — 8% of the declare
limit. The only thing missing is a funded deployer, which is the part that costs money.

**What a mainnet deploy costs, and why it is not one transaction:** one declare, one deploy,
then nine `create_market` calls and nine `fund_market` calls — because a market that is not
funded can sell nothing at all. Plus the bankroll itself, which is real STRK sitting behind
the markets.

---

## 4. Gaps — the honest list

### Still open

| # | Gap | Blocks | Note |
| --- | --- | --- | --- |
| G3 | **Pragma Sepolia is dead.** BTC's last print is ~329 days old; ETH and STRK have one publisher. | 6.2 | **STILL TRUE.** A Sepolia deploy would list markets that can never settle, so mainnet is the only place a real settlement happens. |
| G11 | **`strk20.json` is empty** — no contracts, no transactions, no demo. | 6.3–6.6 | Every field is a deliverable and every one is blocked on a mainnet spend. |
| G16 | **The pool sandwich has never run against the real pool.** | 6.3 | Narrowed three times, not closed. `pnpm pool:probe` compiles molfi's exact action list against the deployed pool on mainnet and Sepolia: it parses, satisfies replay protection, and stops at `SUBCHANNEL_NOT_FOUND` — a note that does not exist, because the probe has no account. Reading the deployed pool's own class settled the shape: `InvokeExternalInput` is `{contract_address, calldata}` and carries no token or amount, so the stake must arrive by a separate `Withdraw` action in the same transaction — which `openActions` now sends, and which its absence had silently omitted. What remains untested is whether the pool deserializes our calldata into `privacy_invoke`'s parameters in the order the escrow helper implies. `strk20PrepareInvoke` dry-runs that for free; it needs a wallet on a funded account. |
| G17 | **No mainnet deployer.** | 6.2 | Both configured accounts hold 0 STRK on mainnet. `ghost_deployer` holds 119 STRK on **Sepolia**, which is why the contract is deployed and funded there. Mainnet preflight is otherwise clear. This is the money decision, and it is the user's. |
| G18 | **The Alchemy key's app does not have Starknet Mainnet enabled.** | nothing, but it should be fixed | Every request to it returns 403, so the live deployment is running on the public fallback — which works and is rate limited. One toggle at https://dashboard.alchemy.com/apps/jxx5a0i4bn502vc1/networks. `/api/health` reports which endpoint answered, so this is visible rather than silent. |

### Closed

| # | Gap | How |
| --- | --- | --- |
| G1 | No Cairo contract | `MolfiMarket`, 50 tests, 6,899 Sierra felts — 8% of the declare limit |
| G2 | Pyth does not work on Starknet | Pragma instead. Recorded because the trap is that Pyth *looks* wired up: deployed on both networks, answering, and every feed returns `None`. |
| G4 | Pragma updates every 7–10 minutes | Rounds are 15m / 1h / 4h. The contract refuses a round shorter than one publish interval, so the constraint is enforced rather than remembered. |
| G5 | No wallet connect | get-starknet v6 + `WalletAccountV6`, with capabilities probed rather than assumed |
| G6 | Tables calibrated for the wrong instrument | Refitted on 129,600 real minute closes per market. The 24h round was fitted and then cut: out of sample it claimed 65% and delivered 33%. |
| G7 | `orderbook.ts` is Kuru-specific | Deleted. The oracle strip replaced it — the thing that actually settles every position. |
| G8 | Monad/MON references | Swept. What remains is comments explaining what changed and why. |
| G9 | No console app | The whole xorr-monad `apps/web` brought in and ported |
| G10 | No verifier | `auditMarket()`, `/m/<id>`, `/api/audit/<id>`, 11 checks with tamper tests |
| G12 | Game leftovers on disk | Deleted, along with the CrewKill keeper, its Postgres and its docker-compose |
| G13 | Hub nav 404s | Fixed |
| G14 | `packages/protocol` is 39 lines | Folded into the SDK. Splitting it had produced two copies of the Pragma addresses. |
| G15 | No CI | TypeScript, Cairo, Sierra size, and a parity job that regenerates the kernel vectors and asserts Cairo still agrees |

### Found by running it, not by reading it

Each of these was invisible to the test suite and surfaced only by deploying the contract and
driving it over a real RPC, or by reading the deployed pool rather than the docs about it:

- **A position could be opened backed by nothing.** The contract took the stake `amount` from
  calldata on trust. The pool's `InvokeExternalInput` carries no token and no amount, so the
  tokens arrive by a separate action and the contract has no way to know from the call itself
  that they did — anyone able to reach `privacy_invoke` could record a position backed by
  nothing and later claim a payout funded by the bankroll and by other people's stakes. The
  stake is now measured against a per-token ledger: `balance_of` less what was already
  accounted for is exactly what arrived. Same reason `fund_market` was already written that
  way; the input side simply had not been.
- **The open action never moved the stake.** It sent only an invoke. The pool's ABI says an
  invoke cannot carry a transfer, so a withdraw leg is required and was missing.

- **Conservation made it impossible to pay the first winner in a market.** `paid <= staked`
  means the only money present is the winner's own stake, and any multiplier above 1.00x
  exceeds it. Every honest market would have failed at its first payout. Markets now carry a
  bankroll, and reserve the full payout at open rather than checking at claim.
- **The contract would sell a band at 0.97x** — a guaranteed loss even when you win. The
  multiplier floor was enforced only by the desk, and a trader does not have to use the desk.
- **The app read `Position` at the wrong offsets**, reporting a 1 STRK stake as eight
  trillion. A `u256` is two felts and a `u128` is one; assuming one felt per field produces
  plausible nonsense rather than an error.
- **`stake=10` on the quote endpoint meant ten wei.** The unit was inferred from whether the
  string contained a dot.
- **The health and price routes read Pragma's mainnet address** from the address book instead
  of the network's configured oracle, so a local run reported its own oracle as down.

### Not gaps, recorded so they are not re-litigated

- The pricing kernel is mirrored TS ↔ Cairo and pinned by generated vectors, including the
  shipped BTC 15m calibration rather than only the normal fixture.
- The commitment derivation is pinned from both sides by a fixed vector: starknet.js computes
  it and Cairo looks a real position up by it. If those two disagreed, every position would
  open fine and none could ever be found again.
- The house edge is 4%, and the *effective* edge measured out of sample is 9–31% depending on
  the market. That is disclosed rather than shrunk, because closing it would mean modelling a
  win rate at or below the realised one — the direction that drains the vault.

---

## 5. Order of execution

Phases 1 through 5 are done. What is left is one decision and the work that follows it.

1. **Fund a mainnet deployer.** The only step that costs money, and the only thing left
   between here and a complete submission. `pnpm preflight` is clear otherwise, and the
   identical script has now run end to end on Sepolia — so what remains is the same
   sequence against a chain where the oracle is alive.
2. **Dry-run the pool sandwich** with `strk20PrepareInvoke` before submitting anything. It
   costs nothing and it is what remains of G16 — whether the pool deserializes our calldata
   into `privacy_invoke`'s parameters the way the escrow helper's example implies. The
   transaction shape itself is no longer a guess: it came from the deployed pool's class.
3. **Deploy**, list and fund the markets, then open, settle and claim one real position.
   `--resume` makes a half-finished run recoverable rather than a stranded contract.
4. **Fill `strk20.json`** with `pnpm submission --network mainnet`. The deploy script
   records every hash it sends, and the filler verifies each receipt before recording it —
   a reverted transaction still has a hash, so listing them unchecked would let a failed run
   look like a successful one.
5. **Record the demo.** The console is already deployed at
   https://molfi-production.up.railway.app and `strk20.json` carries it as `demo_url`.

The risk worth naming, now that the code is done: **the parameter *order* inside the invoke
calldata is still inferred from one documented example.** The transaction shape around it is
not — that came from reading the pool's own deployed class. If the order is wrong the dry run
says so in seconds, and the fix is a reorder in one Cairo signature and one array. If it is
right, nothing else stands between this and a working mainnet settlement.

**Also still true:** Pragma Sepolia is dead, re-verified this pass — BTC's last print is 329
days old, ETH and STRK have one publisher each. So a Sepolia deploy would list markets that
can never settle. It would still exercise the pool's *open* leg, which never touches the
oracle, and that is the cheapest remaining way to close G16 if a funded Sepolia account
appears before a mainnet one.
