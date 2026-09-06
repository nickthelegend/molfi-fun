# molfi — build plan

Written 2026-09-06, after the declare landed and the first real trade settled. Planning only:
nothing in this document was built while writing it.

Every status here was checked against the running system rather than remembered. Where a task
says DONE there is a transaction hash, a test count, or a live URL behind it.

---

## 1. What "done" and "winning" mean here

### The product

A prediction market on Starknet where **your position is a commitment, never an address**.
Two games on one console:

- **Range** — pick a price band and how long it must hold. Tighter pays more.
- **Up / Down** — pick a direction against a reference fixed when the round is listed. Both
  sides pay the same multiplier, which is what stops the public reserve leaking which way you
  went.

The band is never sent to the chain. What the contract is told is how far the band reaches
from its own midpoint — a pair of ratios with the price divided out — which prices the
position exactly and says nothing about what it predicts.

### Done means

1. A trader opens a position through a wallet they control. The dapp never sees a viewing key.
2. **Both games** are playable against their **deployed contracts**, not only against the paper
   engine.
3. Markets settle against a fresh multi-publisher median at a stated block, unattended.
4. Claiming pays exactly `stake × multiplier`, to the unit.
5. A stranger with no wallet can recompute a settled market and check it against what the
   contract paid.
6. At least one real position has been opened and claimed end to end, in each game.

**Where that stands: 6 of 6.** Item 6 is done for range (`0x028801d1…` → `0x0592bf85…`,
2 STRK in, 2.1026 out) **and for up/down** (`0x01563d53…` → `0x0337599e…`, 2 STRK in, a losing
ticket claimed and its reservation released). Item 2 is done: both games are playable against
their deployed contracts.

### Winning means (the hackathon's own bar)

| Requirement | State |
| --- | --- |
| Three **mainnet** transactions through the pool `0x040337b1…` | **NOT STARTED** — nothing on mainnet |
| Contracts listed in `strk20.json` | Sepolia complete: 3 contracts, 21 transactions. Mainnet empty |
| A 3-minute demo video | **Built, not published** — `demo/molfi-demo/renders/*.mp4`, 1m36s |
| A reachable `demo_url` | DONE — `https://molfi.fun` |
| The privacy claim states its own edges | DONE — `/privacy` and `/verify`, drawn from the deployed ABI |

### Explicitly not goals

Sub-accounts, running a prover, a bridge, an order book, a token. `docs/IDEAS.md` tier 4 is the
recorded list of things deliberately not built.

---

## 2. Where the project actually is

| | |
| --- | --- |
| Range market | `0x053b17219aa45008548e3633b9fcd78ec9540b00d71fd34ec6217599d3298f1f` — 56 markets, 44 settled |
| **Up/down market** | `0x07881b0cabd145d7135b8964c4b613697ef2fb2260d97657ef4c4f6245c17ce9` — 2 rounds, 1 ticket opened, settled and claimed |
| Price relay | `0x0275a7fdecdb539060b1e7cb2c857f88d505ed0a6c0ea2aafbbcc383456dfcbb` |
| Keeper | `0x788e67ade3c9e65e04c391518e9de7036a548e9733193d7d6a63ab85f0e9e8f`, ~2,004 STRK |
| Tests | 119 Cairo · 105 SDK · 23 keeper, all green |
| `pnpm verify` | 38/38 |
| Test register | `docs/STATUS.md` — 226 PASS · 4 UNTESTED · 0 FAIL |

---

## 3. Phases

### Phase 1 — Connect the up/down game to its contract · **DONE**

Was: a working contract, a working game, and no wire between them — the only reference to
`updown.cairo` anywhere in `apps/` or `packages/` was a comment.

Now the loop has run on chain, end to end:

| | |
| --- | --- |
| `create_round` | `0x014592d6…` |
| `fund_round` | `0x013a9c5e…` — 10 STRK behind it |
| `open_ticket` | `0x01563d53…` — 2 STRK staked, **3.84 reserved**, exactly 2 × 1.92 |
| `settle` | `0x05b61e04…` — reference 79,900.59 → **79,855.59**, DOWN wins |
| `claim_ticket` | `0x0337599e…` — **SUCCEEDED**, paid 0, reserved released, marked spent |

The ticket lost, which is the better test: it exercises the branch where a losing claim must
*succeed* rather than revert, pay nothing, and give its reservation back so the round's
capacity returns. And the ticket the chain stores is `roundId, stake, multiplierBps, claimed,
exists, owner` — **no direction field**. UP lived only inside the commitment until the claim.

| # | Task | State |
| --- | --- | --- |
| 1.1 | Add `upDownMarket` to `NetworkConfig` in `packages/sdk/src/networks.ts` and set the Sepolia value to `0x07881b0c…`. Mainnet null. | **DONE** — `upDownMarket` on `NetworkConfig`, Sepolia `0x07881b0c…`, mainnet null |
| 1.2 | Add `decodeRound` and `decodeTicket` to `packages/sdk/src/decode.ts`, mirroring the `Round` and `Ticket` structs in `cairo/src/updown.cairo`. Cairo lays a struct flat, a `u256` is two felts low-limb-first — the same offsets that produced an 8-trillion-STRK stake when got wrong for `Market`. | **DONE** — verified against the live contract: 26 felts, `pair BTC/USD`, reference 79,637.12, and decoded `multiplierBps` 19200 equal to the contract's own `quote()`, which is the cross-check that proves the offsets rather than merely typechecking them |
| 1.3 | Add `commitmentOfDirection(secret, roundId, direction)` to `packages/sdk/src/positions.ts`, mirroring `poseidon(MOLFI_DIRECTION_V1, secret, round_id, direction)`. Add a test asserting it differs from the range commitment for the same secret and id. | **DONE** — `commitmentOfDirection`, with tests that it differs from a range commitment for the same secret and id, that up differs from down, and that the same preimage is stable |
| 1.4 | Teach the keeper to list and settle direction rounds: extend `apps/keeper/src/index.ts` `openNewRounds` and `settleDue` to iterate the up/down contract alongside the range one, using `create_round` / `settle`. | **DONE** — `tendDirectionRounds` settles what is due, lists when none is open, and funds it in the same transaction as the listing, so a listed-but-unfunded round can never be observed |
| 1.5 | Add `openDirection` and `claimDirection` to `apps/web/src/lib/useLiveDesk.ts`, building `open_ticket(round_id, commitment, stake)` and `claim_ticket(round_id, secret, direction)`. | **DONE** — `fireDirection` and a claim path that routes by game before route |
| 1.6 | Make the deck's game switch select the contract, not just the paper engine: when `game === "direction"` and the desk is live, fire against the up/down market. | **DONE** — the store is a discriminated union; the compiler found all six places that assumed a band |
| 1.7 | Extend `/api/markets` (or add `/api/rounds`) to serve direction rounds so the console can list them. | **DONE** — `/api/rounds` |
| 1.8 | **Open and claim one real direction ticket on Sepolia.** Record both hashes in `strk20.json`. This is what closes "Done means" item 6 for the second game. | **DONE** — see the table above. Five transactions recorded in `strk20.json`, now 26 |

### Phase 2 — Finish the Privy trading path · **IN PROGRESS**

Privy gives molfi auth, an address, a balance and signing, all verified. The account derivation
and deployment are proven on chain. What is missing is the UI path.

| # | Task | State |
| --- | --- | --- |
| 2.1 | Privy auth, wallet creation, `rawSign`. | **DONE** — verified against the live API; full email OTP round trip walked on production |
| 2.2 | Derive the account address from OpenZeppelin's class + Privy's public key. | **DONE** — `privyAccountAddress()` in `apps/web/src/lib/wallet.ts` |
| 2.3 | Prove the derived account deploys and its `__validate__` accepts a Privy signature. | **DONE** — `0x5d8b16f6…` at class `0x5b4b537e…`, tx `0x337e385a…` |
| 2.4 | `connectPrivy()` returning a `Connection` whose `account` is a plain starknet.js `Account`. | **DONE** — `Connection.account` widened from `Strk20Account`; capabilities honest (direct route only) |
| 2.5 | Call `connectWithPrivy` from the console so GO LIVE uses the Privy account instead of requiring an extension. | **DONE** — the gate hands down a ready-made `PrivySigner`; `readyToAct` tries Privy before the extension list. The account is still neither deployed nor funded, so the first action fails — 2.6 and 2.7 |
| 2.6 | Deploy the account on first use: detect `getClassHashAt` failing, send `DEPLOY_ACCOUNT`, show progress. Needs ~0.15 STRK of fee bounds at the address first. | NOT STARTED |
| 2.7 | Fund a new account so a visitor can act: either a faucet drip from the keeper or an on-screen "send STRK here" step. **Decide which — a silent auto-fund from the house is a different product than a deposit.** | NOT STARTED |
| 2.8 | Re-run register items D13, D14, D15, D19 against the Privy path. | BLOCKED on 2.5–2.7 |

### Phase 3 — Keeper reliability · **IN PROGRESS**

| # | Task | State |
| --- | --- | --- |
| 3.1 | Affordability against the node's real fee, not starknet.js's padded bound. | DONE — `apps/keeper/src/bounds.ts`, 23 tests |
| 3.2 | `send` treats a reverted transaction as a failure. | DONE |
| 3.3 | `/health` distinguishes starting from stalled. | DONE |
| 3.4 | Bound the confirmation wait so a cycle cannot hang for minutes. | **DONE and live** — deployed 18:44:45Z, cycling cleanly: 3 cycles, 4 relays, `lastError: None`, `ok: true` |
| 3.5 | Verify the bound actually fires: force a slow confirmation and check the cycle ends at 90s rather than blocking. | NOT STARTED — the code path is live but the timeout has not yet been *exercised*. Only a genuinely slow transaction proves it, and none has been slow since the deploy |
| 3.6 | Cap keeper log volume so a retry loop cannot cross Railway's 500/sec limit and destroy its own diagnostics. | NOT STARTED |
| 3.7 | Alert when `ok:false` persists — right now nothing watches the health endpoint. | NOT STARTED |

### Phase 4 — Mainnet and the submission bar · **NOT STARTED**

| # | Task | State |
| --- | --- | --- |
| 4.1 | Fund a mainnet deployer with ≥ 120 STRK. | **BLOCKED — spends real money.** All four accounts hold 0.000000 STRK on mainnet and none is deployed there |
| 4.2 | `pnpm preflight` (defaults to mainnet). | DONE — clear, 2 warnings, both about the unset deployer. Mainnet Pragma settles all pairs, so mainnet needs no relay |
| 4.3 | Declare and deploy `MolfiMarket` and `UpDownMarket` on mainnet. `PriceRelay` must **not** be deployed there. | BLOCKED on 4.1 |
| 4.4 | Set `MOLFI_MARKET.mainnet` and `upDownMarket.mainnet` in `networks.ts`. | BLOCKED on 4.3 |
| 4.5 | List and fund one market per pair at tier 2 (4h) to keep mainnet burn low. | BLOCKED on 4.3 |
| 4.6 | Execute **three transactions through the mainnet pool** `0x040337b1…`. | BLOCKED on 4.3 — the prize requirement |
| 4.7 | `pnpm submission`, then verify `strk20.json` names mainnet and lists the three pool transactions. | BLOCKED on 4.6 |

### Phase 5 — Submission artifacts · **IN PROGRESS**

| # | Task | State |
| --- | --- | --- |
| 5.1 | Record a 3-minute demo video. | **DONE** — `demo/molfi-demo`, 1m36s, 1080×1920, built from real captures and real on-chain numbers |
| 5.2 | Publish it and put the URL in `strk20.json.demo_video`. | NOT STARTED — `npm run publish` defaults to private; `--public` is a distribution decision for a person |
| 5.3 | Timed shot list. | DONE — `docs/DEMO.md`, updated for the post-declare reality |
| 5.4 | Re-shoot the console frame if the deck changes. | NOT STARTED |
| 5.5 | Confirm `demo_url` resolves and every linked page loads without a wallet. | DONE — re-check after any redeploy |

### Phase 6 — Verification · **IN PROGRESS**

| # | Task | State |
| --- | --- | --- |
| 6.1 | 119 Cairo tests. | DONE |
| 6.2 | 105 SDK + 23 keeper tests. | DONE |
| 6.3 | Three packages typecheck clean. | DONE |
| 6.4 | `pnpm api:check` against production. | DONE |
| 6.5 | `pnpm verify` 38/38. | DONE |
| 6.6 | `docs/STATUS.md` — every plan item with a status. | DONE — 226 PASS · 4 UNTESTED · 0 FAIL |
| 6.7 | Add register items for the direction game **on chain** — the current O-section items test the paper game only. | NOT STARTED |
| 6.8 | Contract audit. | DONE — `docs/AUDIT.md`, three findings, all fixed and shipped in the declare |

---

## 4. The gaps, honestly

Tied to the phase each blocks. Read from the codebase, not the README.

### Blocking — the product does not do what it says without these

**G1 · CLOSED.** The up/down contract is wired: address, decoders, commitment helper, keeper
listing and settling, `/api/rounds`, `fireDirection`, and a claim path that routes by game.

**G2 · CLOSED.** A ticket was opened, the round settled, and the ticket was claimed — the
losing branch, which is the one that had to succeed rather than revert.

**G3 · PARTLY CLOSED.** *(Phase 2.6–2.7)* The console now connects with Privy — the gate hands
down a signer and `readyToAct` prefers it over an extension. What remains is that the account
it connects to is counterfactual and empty, so the first transaction still fails. That is G4,
and it is now the whole of the remaining gap rather than half of it.

**G4 · A new Privy account is undeployed and unfunded.** *(Phase 2.6–2.7)*
A Starknet account is an address until someone pays to make it a contract. There is no deploy step and no funding step, so even once 2.5 lands the first action any visitor takes will fail.

**G5 · The keeper hangs for minutes at a time on an unbounded wait.** *(Phase 3.4–3.5)*
Caught mid-stall: `cycles: 101`, `lastCycleAt` **eleven minutes** old, `ok: false`, 2,004 STRK
in the account and four markets sitting past their cutoff unsettled.

It then **recovered by itself, in the same process** — `startedAt` never changed — which is the
more useful version of the finding: `waitForTransaction` was not waiting forever, it was
waiting for a transaction that took about twelve minutes to confirm. On a 120-second loop that
is still a stall, and it is worse than a crash: nothing restarts, nothing alerts, and the
retry polling floods the log while it happens.

**Fixed and live** as of 18:44:45Z — a 90-second bound, then report against the hash rather
than keep waiting, which is the rule that function already applied to a failed confirmation.
The new build is cycling cleanly.

**What is still open is the proof.** The bound is in the code path and has never fired, because
no transaction has been slow since the deploy. Until one is — or is made to be — this is a fix
believed rather than demonstrated, which is exactly the distinction the rest of this project
holds itself to. That is task 3.5.

### Real, non-blocking

**G6 · Nothing watches the keeper's health.** *(Phase 3.7)* The endpoint reports `ok:false` correctly and no one is told. The stall above was found by hand.

**G7 · The keeper can flood its own logs.** *(Phase 3.6)* A retry loop printed thousands of `RECEIVED` lines, crossed Railway's 500/sec limit and dropped the logs — so the stall destroyed the evidence of itself.

**G8 · The demo video is built and unpublished.** *(Phase 5.2)* `strk20.json.demo_video` is still `""`, which is a hard submission requirement.

**G9 · The test register covers the paper direction game, not the on-chain one.** *(Phase 6.7)* Section O tests the switch, the quote and the card. There is no item for `open_ticket`, `claim_ticket`, or a settled direction round.

**G10 · Mainnet is untouched.** *(Phase 4)* Three mainnet pool transactions are the prize requirement and nothing is deployed there.

### Checked and clean — do not spend time re-auditing

- **The eight `mock|stub|fake|dummy|placeholder|todo` hits are all benign.** Four are HTML
  `placeholder` attributes, three are comments explaining why placeholders are *not* used, and
  two are the devnet test doubles in `cairo/src/devnet.cairo` which `scripts/deploy.mjs`
  refuses to put on any public network. The live contract's `oracle()` and `pool()` were read
  back from chain and are the real relay and the real STRK20 pool.
- **The band is not on chain.** The deployed `Position` is
  `market_id, low_off_1e8, high_off_1e8, stake, multiplier_bps, claimed, exists, owner`.
- **Payouts are exact.** 2 STRK at 1.0513x paid 2.1026 STRK, verified on chain.
- **Conservation holds.** `pnpm verify` D7 checks `paid + reserved <= staked + bankroll` across
  every market.
- **The three audit findings are fixed and shipped**, in the class currently deployed.

---

## 5. If you only do three things

1. **Phase 1** — wire the up/down contract. It is deployed, tested, and doing nothing. This is
   the biggest gap between what the project claims and what it does.
2. **Phase 3.4/3.5** — get the keeper fix live. The desk recovered on its own this time; the
   next slow transaction hangs it again, and nothing is watching.
3. **Phase 2.5–2.7** — make the Privy account usable, so a judge with no extension can trade.

Mainnet (Phase 4) is gated on money, and the video (5.2) on one command by a person.
