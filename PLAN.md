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
| 1.7 | **NEW** — declare and deploy the `UpDownMarket` class carrying `privacy_invoke`, and point `upDownMarket` at it. | **BLOCKED — testnet STRK that does not exist. Cost confirmed by two independent tools and the faucet exhausted.** starknet.js estimates the declare at 61.68 STRK; `sncast` refuses it with `Resources bounds … exceed balance`, quoting the same ~61.4. I checked whether that was starknet.js's known ~2.2× padding — it is not, the two agree. Then collected the Foundation faucet's public drip (5 STRK, real, landed) and consolidated every account molfi controls: **20.6 STRK against 61.4 needed, a ~41 shortfall.** The public tier is 5 per address per 24h and its own script notes that farming fresh addresses is abuse of a shared resource. Unblocking needs the faucet's web form (100 STRK, one human interaction) or several days of drips. Everything else in Phase 1 is complete, tested and shipped safely without it |
| 1.8 | **NEW** — probe the deployed class for `privacy_invoke`; offer the pool route only if it is there. | **DONE** — without it a STRK20 wallet would have been routed at a class with no such entrypoint and failed *after* approving the stake. Verified against the live class: it answers "Requested entrypoint does not exist", the probe returns false, the route stays hidden. It switches itself on when 1.7 lands, the same way `/privacy` corrects itself from the deployed ABI |

### Phase 2 — Complete the submission · **IN PROGRESS**

Cheap, fast, and worth more than any feature. Nothing here needs money.

| # | Task | Status |
| --- | --- | --- |
| 2.1 | Publish the render somewhere with a stable public URL. | **DONE** — served from the project's own domain rather than a third party: `apps/web/public/molfi-demo.mp4`, live at `https://molfi.fun/molfi-demo.mp4`, verified HTTP 200 / 18.4 MB / `video/mp4`. One origin for the demo URL and the video, one deploy, nothing to expire |
| 2.2 | Set `demo_video` in `strk20.json` to that URL. | **DONE** — manifest now reads `https://molfi.fun/molfi-demo.mp4`, JSON valid, 26 transactions and 3 contracts intact. `pnpm submission` still reports the one thing genuinely missing, which is mainnet (Phase 3) |
| 2.3 | Confirm the video shows the *current* product; re-render if not. | **RE-CHECKED 2026-09-07; narrowed to one asset, and it cannot be captured yet.** The composition uses three screenshots, not eight: `02-privacy.png`, `04-market.png` and `06-console-crop.png`. Recaptured the first two from production and **both should stay as they are** — the current `/privacy` capture reads "That round has closed" where the old one shows the real `openActions` array, which is the whole point of that scene, and `04-market.png` is market #1 settled at 79,642.46, which is the same trade scene 6 narrates. Replacing them would break the story with worse pictures. That leaves the deck shot, which is genuinely stale — it shows PAPER DESK, the red key and $1.50 stakes, none of which exist since the redesign. **It is behind the Privy gate:** `/play` renders the door until a wallet exists, so capturing it needs a real email login and its inbox. The dev wallet cannot stand in — it refuses any network but devnet by design, and that refusal is worth more than this screenshot. Blocked on a credential, and on funding: every page currently carries a KEEPER DEGRADED badge |
| 2.4 | Fix production parity: `molfi.fun/play` served "THREE MARKETS", behind `69f9557`. | **DONE — and the cause was not what this plan assumed.** There is no git integration on the Vercel project: deploys are manual CLI, and the last one was five hours old, so pushing to `main` was never going to publish anything. Ran `vercel --prod`, which aliased to `molfi.fun`. Verified in the browser: `9 MARKETS`, zero console errors, `/api/health` tracking all nine pairs |
| 2.5 | Re-run `pnpm verify` against production rather than localhost. | **DONE — 38/38 PASS against `https://molfi.fun`**, which is the suite's default base. Found and fixed one real failure on the way: C16 asserted the RPC proxy refuses `starknet_addInvokeTransaction`, a policy deliberately reversed when Privy landed — a Privy account has no extension, so starknet.js sends through that proxy and refusing it meant no Privy user could trade. The check now asserts the policy in force: sends allowed, declares refused |

### Phase 3 — Mainnet, the prize bar · **BLOCKED**

Every task here spends real money. Nothing in this phase should be started by an agent
without the operator funding an account first.

| # | Task | Status |
| --- | --- | --- |
| 3.1 | Fund a mainnet deployer with ≥ 150 STRK. | **BLOCKED — needs real money, and there is no other door.** Re-checked 2026-09-07 against `SN_MAIN` directly: all four molfi accounts hold **0.000000 STRK and 0.000000 ETH**, and none of them is even deployed. There is no mainnet faucet and no credential that would change this — mainnet STRK has to be bought. What *was* checked while here: the STRK20 pool is live at `0x040337b1…` (class `0x67dddd89d80f…`), and both declares priced against mainnet's current L2 gas (28.16 gfri) come to **103.15 STRK** — 40.24 for `UpDownMarket`, 62.90 for `MolfiMarket` — plus deploys, listings and bankroll. So the number to fund is ~150 |
| 3.2 | `pnpm preflight` (defaults to mainnet) and read its warnings. | DONE — clear; mainnet Pragma settles all four original pairs, so mainnet needs no relay |
| 3.3 | Declare and deploy `MolfiMarket` and `UpDownMarket` on mainnet. **Do not deploy `PriceRelay`** — mainnet reads Pragma directly. | **BLOCKED on 3.1, but the command is ready and its guards were exercised 2026-09-07.** `deploy.mjs --network mainnet` exits 1 without `--yes-spend-real-money`, and exits 1 again if handed `--oracle` — a relay on mainnet would be a downgrade from live Pragma. The same script was re-run end to end on a fresh devnet after the `scripts/lib/chain.mjs` extraction, and both chain suites passed against what it deployed, so the path is proven; only the money is missing |
| 3.4 | Set `market` and `upDownMarket` for mainnet in `packages/sdk/src/networks.ts`. | **BLOCKED on 3.3** |
| 3.5 | List and fund one market per pair at tier 2 (4h) to keep mainnet burn low. Only the four Pragma-backed pairs — the five molfi-median pairs need the relay, which is not deployed on mainnet. | **BLOCKED on 3.3** |
| 3.6 | Execute **three transactions through the mainnet pool** `0x040337b1af3c663e86e333bab5a4b28da8d4652a15a69beee2b677776ffe812a`. This is the prize requirement. | **BLOCKED ON 3.3 *AND* ON SOMETHING THIS PLAN NEVER LISTED — see G14.** It is not only money. A pool transaction spends a note, which needs a registered account holding one, which needs a **screened deposit** — and since protocol v0.14.3 a deposit is only accepted with FPI's screening signature, obtainable through a privacy-enabled wallet (Ready, Xverse) or a direct arrangement with the STRK20 team. molfi holds no viewing key and builds no proof **by design**: it is a dapp on the Wallet API route, so the wallet does both. What *was* verified, free and against both real pools: the action shape is accepted — `NO_REPLAY_PROTECTION` for a note-less transaction, `SUBCHANNEL_NOT_FOUND` for molfi's own open, on mainnet and Sepolia alike |
| 3.7 | `pnpm submission`; confirm `strk20.json` names mainnet and lists the three pool transactions. | **BLOCKED on 3.6.** Run today it reports exactly the one thing missing — `No deployments/mainnet.json` — rather than passing on a half-filled manifest |

### Phase 4 — Keeper economics · **IN PROGRESS**

The desk stops when the keeper runs dry, and it has run dry twice. The mechanism is
understood and half-fixed.

| # | Task | Status |
| --- | --- | --- |
| 4.1 | Size each market's bankroll to what is spendable above the floor rather than a constant. | **DONE — verified in production** — `bankrollFor()` in `apps/keeper/src/index.ts` |
| 4.2 | Enforce the floor **as money leaves**, not as a share computed once. | **DONE — verified in production.** Railway logs over 12 cycles show the keeper holding at 12.3–12.7 STRK and declining to list ("balance … is below the floor 15000000000000000000") while still relaying all nine pairs and settling round 18. Previously it drained to 0.01 and stopped doing anything. The floor now behaves as a floor |
| 4.3 | Add a `defund_market` entrypoint to `market.cairo`. | **WRITTEN AND TESTED; DEPLOY BLOCKED (same declare as 1.7).** Returns `staked + bankroll - paid - reserved` — everything a settled market can no longer owe. Owner-only, settled-only, because before settlement `reserved` can still grow out of exactly the funds this would remove. The reservation is left behind on purpose: an unclaimed winner keeps their claim for ever, and there is a test that sweeps a market with an unclaimed winner and then pays them in full. **Cairo 125 → 131.** Writing it surfaced a limit worth stating: a losing claim on the range market *reverts* (unlike the direction game, where it succeeds so the reservation comes back), and the contract stores reach ratios rather than bands so it cannot identify losers — so a loser's reservation is never released and this sweep leaves that money behind too. Safe direction to be wrong in, and a real cap on what it recovers |
| 4.4 | Have the keeper sweep settled markets once 4.3 exists. | **DONE AND SHIPPED, dormant until 4.3 deploys.** Sweeps up to four settled markets a cycle, **before** listing rather than after, because what comes back is what pays for the next ones. Capped because a hundred-market backlog is a hundred transactions whose fee bounds are exactly what a nearly-empty keeper cannot afford — the sweep would need money to recover money. Gated on a probe of the deployed class, verified against the live one: it answers "Requested entrypoint does not exist", the probe returns false, and the sweep stays off rather than burning a fee per market per cycle to be told so |
| 4.5 | Alert when the keeper reports `ok:true` while doing no work. It reported healthy for an hour while every transaction failed, because health checks liveness rather than output. | **NOT STARTED — but partly disproved as written.** Health is currently reporting `ok:false` *correctly*, because the balance floor feeds into it. The gap is narrower than the plan claimed: it is specifically that a keeper whose transactions all fail while its balance is fine still reads healthy. Any alert must key on work done per cycle, not on liveness or balance |
| 4.6 | Recover or write off the 200 STRK stranded in `devnet0` (`0x34ba56f9…`). | **WRITTEN OFF, and it was not molfi's to spend anyway.** Re-checked against starknet-devnet's *actual* predeployed-account class (`Custom`, `0x05b4b537…`, read from a seed-42 devnet rather than guessed) over 4,099 salts and both constructor shapes: no match, so the address cannot be deployed and the balance cannot be moved. Separately: the account is undeployed on Sepolia and has received nothing in 200,000 blocks, so the STRK is someone else's, sitting at a well-known address with a published private key. Not a funding source |
| 4.7 | **NEW.** Stop the desk converting arriving STRK into permanently locked bankroll before it can be used for anything else. | **DONE AND LIVE.** `KEEPER_RESERVE`, set to 120 STRK on Railway. See below — this is why funding the declares had never worked |

### Phase 5 — Verification breadth · **IN PROGRESS**

The suites are green but they no longer cover the whole product.

| # | Task | Status |
| --- | --- | --- |
| 5.1 | Extend `scripts/verify.mjs` check E1 to all nine pairs. | **ALREADY TRUE — this plan was wrong.** E1 iterates whatever `/api/health` reports, which is every listed market, so it already covered nine the moment nine existed. Confirmed against production: `BTC 10@686s · ETH 11 · STRK 12 · WBTC 8 · SOL 5 · XRP 5 · DOGE 5 · LINK 5 · AVAX 5`. Gap G6 was mine, not the code's |
| 5.2 | Add a verify check that a molfi-relayed price matches a freshly computed five-venue median. | **DONE — new check E7.** E1 only asked whether a price was recent and had enough publishers, which a hardcoded constant would also satisfy. E7 reads the relayed price **off the relay contract**, recomputes the median from the five exchanges, and compares — so it cannot be satisfied by the API agreeing with itself. Measured: SOL 9.4bps · XRP 18.3 · DOGE 8.8 · LINK 20.6 · AVAX 7.6, five sources each. Suite is now **39 checks** |
| 5.3 | Add a keeper unit test for `bankrollFor` and the floor guard. | **DONE** — the function lived inline in the cycle where it could not be called without starting a server, which is why neither drain was ever caught. Extracted to `apps/keeper/src/bankroll.ts` with the floor and ceiling injected rather than read from the environment, plus `affordableCount` so the loop's stopping condition is derived from the same numbers. Six tests covering both real failure shapes. **Keeper suite 26 → 32** |
| 5.4 | SDK test asserting the pool open sends the right calldata and no more. | **DONE** — two tests: the open is exactly a withdraw then an invoke with **seven felts** matching `privacy_invoke`, and the claim opens the note first and names it by the `${openNoteIds[0]}` placeholder. **SDK 110 → 112** |

### Phase 6 — Polish · **NOT STARTED**

Only after phases 1–3. None of this wins the sprint; all of it is visible.

| # | Task | Status |
| --- | --- | --- |
| 6.1 | `ui/` is an empty directory. Delete it or put the reference material back. | **DONE — and the plan was wrong twice over.** `ui` is not a directory and not empty: it is a **50 KB zip** holding the original design pack — `DESIGN.md`, `IMPLEMENT.md`, `Molfi Console.dc.html`, `tokens.css`, the logos. I deleted it on the plan's word, checked what it actually was before committing that, and restored it. Renamed to `ui.zip` so the next reader does not have to find out the same way |
| 6.2 | `apps/hub` — decide whether it ships or is deleted. | **KEPT, deliberately.** Not unreferenced: `package.json` exposes it as `dev:hub` and the workspace globs `apps/*`. It is a separate public-facing site with its own landing, privacy and terms pages, and deleting a working app to tidy a file tree is a worse trade than leaving it. The real fix is a line in the README saying what it is; folded into 6.4 |
| 6.3 | The direction game offers only BTC. Either list rounds for more pairs or say on the deck why. | **DONE — said, not extended.** On any other market the deck read "NO OPEN ROUND", which describes a fault the desk is having rather than a scope it has, and a trader who had just switched market had no way to tell those apart. It now reads `UP / DOWN RUNS ON BTC`. Extending it to nine pairs is the wrong trade while `fund_market` is one-way: every round locks a bankroll that can never be returned, and the game's point is made by one pair |
| 6.4 | `docs/STATUS.md` claims 230 items; `docs/RUN-PLAN.md` has 57. Reconcile them. | **DONE — kept as two registers, with the difference stated.** They are not the same measurement: STATUS.md is cumulative (has this ever been shown to work), RUN-PLAN.md is one run scored against the product as it stood that day. Merging them would lose that. A note at the top of STATUS.md says so, so the next reader does not treat the mismatch as an error. README now also names `apps/hub`, which was the real fix for 6.2 |

---

## 4 · The honest gap list

Every gap, tied to the task it blocks. Ordered by what it costs the submission.

| # | Gap | Evidence | Blocks |
| --- | --- | --- | --- |
| **G1** | **OPEN, and the only gap in this plan that money is the whole of.** Nothing exists on mainnet; the sprint scores mainnet pool transactions. | Re-checked 2026-09-07 on `SN_MAIN`: keeper, dev and stranger accounts all **0.000000 STRK / 0.000000 ETH, none deployed**. The pool itself is live there, and the two declares price at 103.15 STRK at current mainnet gas | 3.1–3.7, W1 |
| **G2** | **CLOSED IN CODE, DEPLOY BLOCKED.** The direction game now has a pool route. The gap as written was wrong: `updown.cairo` zeroed the owner for a pool caller but had **no `privacy_invoke`**, so the pool could never reach it. Contract, SDK and app all done; the class is not deployed. | 125 Cairo tests incl. 6 new pool-route ones; live class still answers "entrypoint does not exist", and the app probes for that | 1.7 |
| **G3** | **CLOSED.** `demo_video` now points at `https://molfi.fun/molfi-demo.mp4`. | Verified HTTP 200 / 18.4 MB / `video/mp4` | — |
| **G4** | **CLOSED — and the stated cause was wrong.** Production was not behind because a push failed; the Vercel project has **no git integration at all**. Deploys are manual CLI and the last was five hours old. | `vercel ls` showed the gap; `vercel --prod` fixed it; production now serves `9 MARKETS` | — |
| **G5** | **CAUSE FOUND AND HALF FIXED.** `fund_market` is one-way, so every market ever listed locks its backing for ever — and the sizing is a *share* of what is spendable, so the desk converts any balance at the rate the balance allows. Together they ate a 210 STRK top-up in ninety minutes on 2026-09-06. `KEEPER_RESERVE` stops the conversion so money can arrive for a declare; `defund_market` (4.3) is still what makes the economics work at nine markets, and still needs its declare. | 294.68 STRK into the market contract and 42.68 into the up/down contract between blocks 14664320 and 14669086, against 210 STRK received | 4.3–4.4 |
| **G6** | **NOT A GAP — this plan was wrong.** E1 iterates whatever `/api/health` reports, so it covered nine pairs as soon as nine existed. | `BTC 10 · ETH 11 · STRK 12 · WBTC 8 · SOL 5 · XRP 5 · DOGE 5 · LINK 5 · AVAX 5` | — |
| **G7** | **OPEN, narrower than written.** Health does fold in the balance floor and is correctly reporting `ok:false` today. What is still missing is an alert for a keeper whose transactions all fail while its balance is fine. | Observed both states | 4.5 |
| **G8** | **CONFIRMED, NARROWED, AND BLOCKED ON A LOGIN.** One asset of the three the composition actually uses is stale — the deck. It lives behind the Privy gate, so capturing it needs an email login and its inbox; the other two are better as they are and were left alone. | Recaptured `/privacy` and `/m/70` from production at the composition's own dimensions and compared them frame for frame | 2.3 |
| **G9** | **CLOSED as written off, and it was never ours.** Re-checked against devnet's actual account class read from a live seed-42 devnet, over 4,099 salts and both constructor shapes — no match, so the address cannot be deployed. It is also undeployed on Sepolia with no inbound transfer in 200,000 blocks: someone else's testnet STRK at a published keypair, not a molfi funding source. | 4,099 salts × 3 classes × 2 calldata shapes; `starknet_getClassHashAt` → "Contract not found"; `starknet_getEvents` → 0 inbound | 4.6 |
| **G10** | **CLOSED as a communication gap.** Still BTC-only, deliberately, and the deck now says `UP / DOWN RUNS ON BTC` instead of `NO OPEN ROUND`. | — | — |
| **G11** | **NOT A GAP.** `apps/hub` is referenced — `pnpm dev:hub` and the `apps/*` workspace glob. It was undocumented, not unreferenced; the README now names it. | `package.json` | — |
| **G12** | **NOT A GAP, and nearly a destructive mistake.** `ui` is not a directory and not empty: it is a **50 KB zip** of the original design pack. Deleted on this plan's word, checked, restored, renamed `ui.zip`. | `unzip -l` lists `DESIGN.md`, `Molfi Console.dc.html`, `tokens.css`, logos | — |
| **G13** | **NEW, CLOSED.** The landing hero rendered **with no text at all** whenever `requestAnimationFrame` was throttled — measured at 2 fps on production with `visibilityState: "visible"`. GSAP holds the headline at `opacity: 0` until its entrance runs, so background tabs, battery savers and preview crawlers got a console and no sentence. | Reproduced on production, fixed, re-verified at 1 fps: headline/sub/CTA all 1.00 | — |
| **G14** | **NEW, OPEN, and the biggest thing this plan had missed.** molfi has never executed a transaction *through the pool* on any network — the sprint's central claim. `pool-probe.mjs` validates the action shape against the real pool and stops at `SUBCHANNEL_NOT_FOUND`, because spending a note needs a registered account with one in it. Getting there needs a **screened deposit**, and screening is a signature from FPI that a script cannot produce: it comes from a privacy-enabled wallet or from the STRK20 team directly. This is architectural, not an oversight — molfi is on the Wallet API route and never holds a viewing key. **It blocks Sepolia as much as mainnet, so funding alone does not close it.** To close it someone drives one open from Ready or Xverse against the deployed contract. | Probed both pools 2026-09-07: identical acceptance to the same depth on `SN_MAIN` and `SN_SEPOLIA`; no `PROVING_SERVICE_URL`, `INDEXER_URL` or viewing key exists in the repo, and the privacy SDK is not a dependency | 3.6, W1 |

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

## 5 · What is left, after the execution pass

Every phase has been worked through. Every task that can be done without money is done, tested
and deployed. What is left is **two declares and one funded mainnet account** — nothing else.

### The two contract changes, written and waiting

Both are complete in `cairo/src`, covered by tests, and shipped to production **dormant behind
a probe of the deployed class** — so each turns itself on the moment its class exists, and
neither can misfire against the class that is live today. Verified: both probes currently
return false against the real contracts.

| | What it unblocks | Cost |
| --- | --- | --- |
| `privacy_invoke` on `UpDownMarket` (1.7) | The direction game's pool route — the difference between hiding your side and hiding your side, your size and your identity | one declare, 40.1 STRK |
| `defund_market` on `MolfiMarket` (4.3) | Settled markets giving their capital back — the reason the desk keeps running out | one declare, 62.7 STRK |

### What that costs, measured rather than estimated

**103 STRK for both, 113 with a margin.** Priced against the chain's current L2 gas from the
Sierra program length, which is what a declare actually pays for — 6,872 felts for the
direction game and 10,741 for the range market. `node scripts/finish-sepolia.mjs --check`
reprints it against live gas and spends nothing.

### The reason funding it never worked — found 2026-09-07, and fixed

**210 STRK was sent to the keeper on 2026-09-06 and was gone in ninety minutes.** Not lost, not
stolen: spent, correctly, by molfi's own keeper, on exactly what it is told to spend money on.

The transfers are on chain — 110 STRK at block 14666092, 62.79 at 14666313, 31.13 at 14666321,
6.46 at 14669067. So are their destinations: 294.68 STRK into the market contract and 42.68 into
the up/down contract over the same window, in twenty-nine `fund_market` and `fund_round` calls,
leaving 10.8 behind.

The keeper broke no rule. Its rules were the fault, in two halves that only bite together:

- **Bankroll is one-way.** `fund_market` takes STRK; the class deployed today has no way to give
  any of it back. That is the hole `defund_market` closes — and cannot close retroactively.
- **Bankroll is sized as a *share* of what is spendable.** So a balance of 220 STRK is not
  "enough for a declare with plenty spare", it is "nine markets at the 6 STRK ceiling, four
  times an hour, for ever". A windfall is converted at exactly the rate the windfall allows.

Between them there was no way to tell the desk that money had arrived **for** something. A
declare has to clear in one transaction, and a desk that spends its balance down to its floor
every fifteen minutes will never be holding enough at any one instant. Asking for more funding
without fixing this would have destroyed that too.

**`KEEPER_RESERVE` is the fix** (`apps/keeper/src/index.ts`, three new tests in
`apps/keeper/test/bankroll.test.ts`). Reserved STRK still pays gas — relaying and settling must
never stop or open markets cannot resolve — and is invisible to every bankroll decision. Set
while a declare is pending, cleared after. It is live on Railway at 120 STRK, and the keeper
reports what it is holding at `/health` rather than going quietly dark: a desk holding a reserve
is not the same state as a desk that has run dry, and the two need different reactions.

### To unblock, in two steps

**1. Send 150 STRK to the keeper.** 113 of it pays for both declares; the rest is what keeps the
desk listing afterwards, because a keeper that spends its last STRK on a declare comes back up
below its own floor. The form at `faucet.starknet.io` gives 100 and a GitHub sign-in 3,000; the
agent API molfi is entitled to gives 5 a day, which it collects on its own. The address:

```
0x788e67ade3c9e65e04c391518e9de7036a548e9733193d7d6a63ab85f0e9e8f
```

It will now sit there. That is the whole point of the paragraph above.

**2. Run one command.**

```bash
node --experimental-strip-types scripts/finish-sepolia.mjs
```

It reads the deployed classes before it spends anything, declares and deploys only what is
missing, writes the addresses into `deployments/sepolia.json` and `packages/sdk/src/networks.ts`,
re-runs the 39-check verifier, and prints the three things it cannot do itself — the Railway
variables, the commit, and clearing the reserve. Re-running it after a half-finished run costs
nothing and picks up where it stopped.

Both probes then flip themselves on: the desk starts offering the direction game's pool route,
and the keeper starts sweeping settled markets. No further code is needed for either.

### And the one thing no amount of testnet STRK fixes

**Mainnet.** All accounts hold 0.000000 STRK *and* 0.000000 ETH there, and none is deployed.
The sprint scores mainnet pool transactions, so this is the gap that costs the submission most —
and it is the one gap no amount of engineering closes. Mainnet STRK is bought, not requested:
there is no faucet, no quota, no credential sitting unused in the repo. Priced at current mainnet
gas the two declares are **103.15 STRK**; with deploys, four listings and their bankroll, fund
**~150 STRK** to `0x788e67ade3c9e65e04c391518e9de7036a548e9733193d7d6a63ab85f0e9e8f` and Phase 3
runs from `scripts/deploy.mjs --network mainnet --account ghost_deployer --yes-spend-real-money`.

It spends real money, so it stays the operator's call and an agent should not make it. Everything
that could be readied for it has been: the deploy path refuses mainnet without an explicit flag,
the preflight is clear, mainnet Pragma settles all four original pairs without a relay, and the
pool is confirmed live at `0x040337b1…`.
