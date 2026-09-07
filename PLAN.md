# molfi — the plan

Written by reading the repo, the deployed contracts and the running product, not the README.
Everything below is either evidenced or explicitly marked as unknown. Any agent can pick a
single task up cold and execute it.

**Repo** `github.com/nickthelegend/molfi-fun` · **live** https://molfi.fun ·
**chain** Starknet Sepolia · **submission manifest** `strk20.json`

---

## 1 · What "done" and "winning" actually mean here

molfi is a prediction market where a position is a commitment, not an order. It is submitted
to the **STRK20 Private Sprint**, and that fixes what winning means — it is not "a nice app".

**The prize bar, stated exactly.** The sprint scores transactions executed through the
**STRK20 privacy pool on mainnet**, `0x040337b1af3c663e86e333bab5a4b28da8d4652a15a69beee2b677776ffe812a`. `strk20.json` is the manifest the judges read:
its `network`, `contracts`, `transactions`, `demo_url` and `demo_video`. Today that file says
`"network": "sepolia"` and lists 26 Sepolia transactions and 3 Sepolia contracts. **No mainnet
transaction exists.** Everything else in this plan is secondary to that sentence.

### Done means all five of these

| | What it means concretely | Where it stands |
| --- | --- | --- |
| **W1** | Three or more transactions through the mainnet STRK20 pool, listed in `strk20.json` | **NOT MET** — nothing on mainnet |
| **W2** | The privacy claim is true of every game the product offers, on the deployed class | **PARTLY MET** — true for range; the direction game is direct-only, so stake and identity are public on it |
| **W3** | A stranger with no wallet can reach a real trade unaided | **MET** — email → wallet → funded → deployed → traded, proven end to end |
| **W4** | The manifest is complete and the demo is watchable | **NOT MET** — `demo_video` is empty; a rendered MP4 exists but is unpublished |
| **W5** | The claims survive a sceptic checking them against the chain | **MET** — `/privacy`, `/verify`, `/m/[id]` and `/api/audit` all recompute from chain state |

### Explicit non-goals

Mainnet **liquidity** is not a goal — three pool transactions and a listed market are the bar,
not volume. A mobile app, an audit, and a token are not goals for this sprint.

---

## 2 · Where it stands, with evidence

Do not re-litigate these; they are measured.

- **Contracts live on Sepolia** — market `0x053b1721…`, up/down `0x07881b0c…`,
  relay `0x0275a7fd…`. `pnpm verify` is **38/38 PASS**.
- **Tests green** — Cairo 119, SDK 110, keeper 26 = **255**, 0 failures.
- **Nine markets** listed and relaying. Four settle against Pragma's own median; five
  (SOL, XRP, DOGE, LINK, AVAX) have no Starknet oracle at all and settle against molfi's
  median across five independent exchanges, relayed with the true source count.
- **The band is not on chain** on the deployed class — `Position` stores `low_off_1e8` /
  `high_off_1e8`. Verified by `verify` D13.
- **The keeper runs unattended** on Railway — lists, funds, relays, settles.
- **57/57** browser verification items pass (`docs/RUN-PLAN.md`).

---

## 3 · Phases, in the order they have to happen

### Phase 1 — Make the privacy claim true of both games · **CODE DONE, DEPLOY BLOCKED**

The direction game is the newer half of the product and it is the *less private* half. On a
privacy sprint that is the gap most likely to be noticed by a judge who reads the code.

| # | Task | Status |
| --- | --- | --- |
| 1.1 | Write `openTicketActions()` in `packages/sdk/src/pool-actions.ts`. | **DONE** — but the premise in this plan was wrong and the task grew. `updown.cairo` did zero the owner for a pool caller, but the pool drives an anonymizer through **one fixed entrypoint** and `updown.cairo` had none, so the pool could never reach it. Added `privacy_invoke` to the contract (OP_OPEN/OP_CLAIM, mirroring `market.cairo`, **measuring** the delivered stake rather than trusting `amount`), then the action list. |
| 1.2 | Write `claimTicketActions()` alongside it. | **DONE** — and `claim_ticket` is route-aware now: it **approves** the pool on the pool route instead of transferring, so the pool pulls the payout when it applies the returned `OpenNoteDeposit`. A losing claim returns an empty span rather than reverting. |
| 1.3 | Remove the hardcoded `route: "direct"` in `rememberDirection`. | **DONE** — records the route it actually used |
| 1.4 | Route `fireDirection` through `submit()` when the wallet speaks STRK20. | **DONE** — and gated on a probe of the deployed class, see 1.8 |
| 1.5 | Update the direction copy so it stops saying the chain sees the stake once it does not. | **DONE** — verified by inspection rather than changed: the deck copy already branched on route ("YOUR SIDE AND SIZE STAY HIDDEN" / "NOT YOU, NOT THE SIZE, NOT THE SIDE"). The branch was correct and simply unreachable while the route was pinned to direct |
| 1.6 | Cairo test that a pool-opened ticket has `owner == 0` and is claimable by secret alone. | **DONE** — 6 new tests: no owner recorded, claimed by secret into a note for stake × 1.92, a losing claim returns no note and releases its reservation, only the pool may call it, an invoke with no tokens delivered is refused, an unknown operation is refused. **Cairo suite 125 passing** (was 119); SDK 112 (was 110) |
| 1.7 | **NEW** — declare and deploy the `UpDownMarket` class carrying `privacy_invoke`, and point `upDownMarket` at it. | **BLOCKED — testnet STRK that does not exist.** Declare estimated at **61.68 STRK**; all molfi accounts together hold ~24, the keeper 12.4. The Foundation faucet gives 5 STRK per address per 24h and its own script notes that farming fresh addresses is abuse of a shared testnet resource. Everything else in Phase 1 is complete and shipped safely without it |
| 1.8 | **NEW** — probe the deployed class for `privacy_invoke`; offer the pool route only if it is there. | **DONE** — without it a STRK20 wallet would have been routed at a class with no such entrypoint and failed *after* approving the stake. Verified against the live class: it answers "Requested entrypoint does not exist", the probe returns false, the route stays hidden. It switches itself on when 1.7 lands, the same way `/privacy` corrects itself from the deployed ABI |

### Phase 2 — Complete the submission · **IN PROGRESS**

Cheap, fast, and worth more than any feature. Nothing here needs money.

| # | Task | Status |
| --- | --- | --- |
| 2.1 | Publish `demo/molfi-demo/renders/molfi-demo_2026-09-06_21-24-29.mp4` somewhere with a stable public URL. | **BLOCKED — the machine's boot volume is full.** Every shell command fails `ENOSPC` before it runs, so the file cannot be read, uploaded or copied. Fix: free space on `/` (start with `rm -rf /private/tmp/claude-501`) |
| 2.2 | Set `demo_video` in `strk20.json` to that URL, then re-run `pnpm submission`. | **BLOCKED on 2.1** |
| 2.3 | Watch the video end to end and confirm it shows the *current* product — it predates the nine-market change, the landing rebuild and the UP/DOWN redesign. | **BLOCKED on 2.1** — and the concern is now near-certain rather than suspected: production carries nine markets and the rebuilt landing page, neither of which existed when the video was rendered |
| 2.4 | Fix production parity: `molfi.fun/play` still serves "THREE MARKETS", so the deployed build is behind `69f9557`. | **CONFIRMED STILL OPEN, FIX BLOCKED** — re-checked against the live site: it returns `THREE MARKETS` where the current source derives the count from `MARKETS`. Redeploying needs a `git push`, which needs a shell |
| 2.5 | Re-run `pnpm verify` against production rather than localhost. | **PARTLY DONE without the shell.** Checked live from the browser: `/api/markets` 200 with **120 markets across 9 pairs**, `/api/rounds` 200 with 18 rounds, `/api/health` 200 `ok:true` `oracle:ok`, `/api/keeper` 200 `configured:true`. Zero console errors on `/play`. The full 38-check suite needs the shell |

### Phase 3 — Mainnet, the prize bar · **BLOCKED**

Every task here spends real money. Nothing in this phase should be started by an agent
without the operator funding an account first.

| # | Task | Status |
| --- | --- | --- |
| 3.1 | Fund a mainnet deployer with ≥ 120 STRK. | **BLOCKED — needs real funds.** All molfi accounts hold 0 STRK on mainnet |
| 3.2 | `pnpm preflight` (defaults to mainnet) and read its warnings. | DONE — clear; mainnet Pragma settles all four original pairs, so mainnet needs no relay |
| 3.3 | Declare and deploy `MolfiMarket` and `UpDownMarket` on mainnet. **Do not deploy `PriceRelay`** — mainnet reads Pragma directly. | **BLOCKED on 3.1** |
| 3.4 | Set `market` and `upDownMarket` for mainnet in `packages/sdk/src/networks.ts`. | **BLOCKED on 3.3** |
| 3.5 | List and fund one market per pair at tier 2 (4h) to keep mainnet burn low. Only the four Pragma-backed pairs — the five molfi-median pairs need the relay, which is not deployed on mainnet. | **BLOCKED on 3.3** |
| 3.6 | Execute **three transactions through the mainnet pool** `0x040337b1af3c663e86e333bab5a4b28da8d4652a15a69beee2b677776ffe812a`. This is the prize requirement. | **BLOCKED on 3.3** |
| 3.7 | `pnpm submission`; confirm `strk20.json` names mainnet and lists the three pool transactions. | **BLOCKED on 3.6** |

### Phase 4 — Keeper economics · **IN PROGRESS**

The desk stops when the keeper runs dry, and it has run dry twice. The mechanism is
understood and half-fixed.

| # | Task | Status |
| --- | --- | --- |
| 4.1 | Size each market's bankroll to what is spendable above the floor rather than a constant. | **DONE — verified in production** — `bankrollFor()` in `apps/keeper/src/index.ts` |
| 4.2 | Enforce the floor **as money leaves**, not as a share computed once. | **DONE — verified in production.** Railway logs over 12 cycles show the keeper holding at 12.3–12.7 STRK and declining to list ("balance … is below the floor 15000000000000000000") while still relaying all nine pairs and settling round 18. Previously it drained to 0.01 and stopped doing anything. The floor now behaves as a floor |
| 4.3 | Add a `defund_market` / sweep entrypoint to `market.cairo` so a settled market's unused bankroll returns to the keeper. `fund_market` is one-way and **every market ever listed locks its backing permanently** — the root cause of both drains. | **NOT STARTED — and it is now the binding constraint, not just the highest-value change.** 120 markets × their bankroll is locked and unrecoverable; that is why the keeper sits under its floor with no way back up except the faucet's 5 STRK a day. Needs a new class, so it also depends on the same STRK that blocks 1.7 |
| 4.4 | Have the keeper sweep settled markets once 4.3 exists. | **BLOCKED on 4.3** |
| 4.5 | Alert when the keeper reports `ok:true` while doing no work. It reported healthy for an hour while every transaction failed, because health checks liveness rather than output. | **NOT STARTED — but partly disproved as written.** Health is currently reporting `ok:false` *correctly*, because the balance floor feeds into it. The gap is narrower than the plan claimed: it is specifically that a keeper whose transactions all fail while its balance is fine still reads healthy. Any alert must key on work done per cycle, not on liveness or balance |
| 4.6 | Recover or write off the 200 STRK stranded in `devnet0` (`0x34ba56f9…`). Its salt was never recorded and no class/salt combination tried reproduces the address; treat as written off unless the operator has the salt. | **BLOCKED — unrecoverable without the salt** |

### Phase 5 — Verification breadth · **IN PROGRESS**

The suites are green but they no longer cover the whole product.

| # | Task | Status |
| --- | --- | --- |
| 5.1 | Extend `scripts/verify.mjs` check E1 to all nine pairs. It asserts only BTC/ETH/STRK/WBTC, so a total failure of the five molfi-median feeds would still report 38/38. | **NOT STARTED** |
| 5.2 | Add a verify check that a molfi-relayed price matches a freshly computed five-venue median within a tolerance, and that its source count is ≥ 3. | **NOT STARTED** |
| 5.3 | Add a keeper unit test for `bankrollFor` and the floor guard — both drains would have been caught by one. | **NOT STARTED** |
| 5.4 | Add an SDK test asserting `openTicketActions` sends no direction felt, mirroring the existing 4-felt test for the direct route. | **BLOCKED on 1.1** |

### Phase 6 — Polish · **NOT STARTED**

Only after phases 1–3. None of this wins the sprint; all of it is visible.

| # | Task | Status |
| --- | --- | --- |
| 6.1 | `ui/` is an empty directory. Delete it or put the reference material back. | **NOT STARTED** |
| 6.2 | `apps/hub` is a second Next app with its own landing, privacy and terms pages. Decide whether it ships or is deleted — right now it is unreferenced weight a reader has to work out. | **NOT STARTED** |
| 6.3 | The direction game offers only BTC. Either list rounds for more pairs or say on the deck why it is BTC-only. | **NOT STARTED** |
| 6.4 | `docs/STATUS.md` claims 230 items; `docs/RUN-PLAN.md` has 57. Reconcile them into one register. | **NOT STARTED** |

---

## 4 · The honest gap list

Every gap, tied to the task it blocks. Ordered by what it costs the submission.

| # | Gap | Evidence | Blocks |
| --- | --- | --- | --- |
| **G1** | **Nothing exists on mainnet.** The sprint scores mainnet pool transactions; molfi has none. | All accounts hold 0 STRK on mainnet and none is deployed there | 3.1–3.7, and W1 |
| **G2** | **The direction game has no pool route**, so stake and identity are public on it. Only the side is hidden. `updown.cairo` supports the route; the SDK action list was never written. | `positions.ts:258` pins `route: "direct"` and says why | 1.1–1.4, and W2 |
| **G3** | **`demo_video` is empty** in the manifest although an MP4 is rendered. | `strk20.json`; `demo/molfi-demo/renders/` | 2.1–2.2, and W4 |
| **G4** | **Production is behind the repo.** `molfi.fun/play` serves "THREE MARKETS", fixed in `69f9557`. | Fetched from production | 2.4 |
| **G5** | **A market's bankroll can never be recovered.** `fund_market` is one-way, so every listed market locks its backing for ever. This is why the keeper drained twice; the floor guard treats the symptom. | No defund entrypoint in `market.cairo` | 4.3–4.4 |
| **G6** | **The verifier does not cover five of the nine markets.** E1 asserts four pairs. | `scripts/verify.mjs` E1 | 5.1–5.2 |
| **G7** | **Health reports liveness, not work.** The keeper said `ok:true` for an hour while every transaction failed. | Observed | 4.5 |
| **G8** | **The demo video may show a product that no longer exists** — it predates nine markets, the landing rebuild and the UP/DOWN redesign. | Rendered 2026-09-06 21:24, before those commits | 2.3 |
| **G9** | **200 STRK is permanently stranded** in an account whose salt was never recorded. | No class/salt combination reproduces `0x34ba56f9…` | 4.6 |
| **G10** | **The direction game is BTC-only.** | `tendDirectionRounds` lists `MARKETS[0]` | 6.3 |
| **G11** | **Two Next apps, one unreferenced.** `apps/hub` ships nothing the sprint reads. | `apps/hub` | 6.2 |
| **G12** | **`ui/` is an empty directory.** | `ls ui` | 6.1 |

### Explicitly NOT gaps

Checked and clean, so nobody re-opens them:

- **No mocks or stubs in shipped code.** `verify` G1 greps for them and passes. The only
  `Stub*` contracts are `cairo/src/devnet.cairo`, reachable only on a local devnet, and the
  deploy script refuses to put them on a public network.
- **No secrets in the client bundle.** The dev key, faucet key and Privy secret are all absent
  from a production build.
- **Pyth is not an option** and should not be revisited: its Starknet feeds are up to 780 days
  stale and its update service answers 401. Documented in `docs/AUDIT.md`.

---

## 5 · What to do first

1. **Phase 2** — free, fast, and it is a third of the manifest the judges read.
2. **Phase 1** — the privacy claim is the pitch; a judge reading `updown.cairo` will see the
   pool route exists and is unused.
3. **Phase 3** — needs the operator to fund mainnet. Nothing else unblocks it.
4. **Phase 4.3** — the only remaining contract-level defect.
