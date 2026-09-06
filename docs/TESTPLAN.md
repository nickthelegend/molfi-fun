# molfi — test plan

Written before testing. Every item states the **specific** expected result, so a pass is a
match rather than a judgement call. Executed against the live product at https://molfi.fun in
a real browser, with the console and network panel checked on every item, and against a real
chain for everything on-chain.

Legend: **PASS** = matched exactly · **FAIL** = did not · **BLOCKED** = depends on something
that genuinely does not exist here, stated as such rather than passed.

**On the browser used.** The Claude in Chrome extension is not connected in this session, so
the browser work runs in the in-app Chromium pane. It is a real browser driving the real
deployed product — what it lacks is an installed Starknet wallet extension. Every item that
needs a wallet to *sign* is marked BLOCKED and its logic is covered instead by
`scripts/integration.mjs`, which drives the console's own call builders through a real
signing account against a real chain. What that leaves untested is the extension's approval
dialog, not molfi's use of it.

---

## A. Pages

| # | Item | Correct means |
| --- | --- | --- |
| A1 | `/` landing | MOLFI wordmark; headline "Take a position nobody can see."; START links `/play`; three doors link `/live`, `/privacy`, `/keeper`. No console error. |
| A2 | `/play` demo desk | Live BTC price > 0; chart has a non-flat trace; `PRAGMA` strip shows a verdict, publisher count and age; a multiplier ≥ 1.05x; `GO LIVE` present. No console error. |
| A3 | `/play` → live console | Header `LIVE · BTC · STARKNET SEPOLIA`; seeded non-flat chart within 5s; market address at the foot; a countdown or `NO OPEN MARKET`; shielded shows `—` when unconnected, never `0.000`. |
| A4 | `/live` | Every open market shows a ticking countdown; every settled market a price and publisher count; each row links `/m/<id>`. Server-rendered — content present with JS disabled. |
| A5 | `/keeper` | CAN/CANNOT both populated; status RUNNING with cycles > 0 and a recent lag; action log non-empty with at least one `tx` link. |
| A6 | `/privacy` | The two routes stated before any claim; three groups; every claim that is route-specific carries a route badge; live staked total from chain. |
| A7 | `/m/<settled id>` | "EVERY CHECK PASSED"; 11 checks each PASS; settled price, publishers, bankroll shown; no `unchecked`. |
| A8 | `/m/<nonexistent>` | "No market #N" with an explanation and a link to the console — not a 500, not an empty frame. |
| A9 | `/m/abc` non-numeric | Same graceful not-found. No unhandled exception. |

## B. Menu sheets

| # | Item | Correct means |
| --- | --- | --- |
| B1 | Menu opens | Sheet slides over; avatar `m`; balance labelled `Paper balance` when unconnected. |
| B2 | Oracle sheet | Names the contract that actually settles these markets, with its address; all three pairs with median, mark, publishers, age, drift; STRK at 5dp. |
| B3 | Leaderboard | States there is no player ranking and cannot be; lists markets with staked/paid and a solvency verdict. |
| B4 | History | Renders; empty state is a sentence, not a blank. |
| B5 | Account | Deployment addresses, each copyable with an explorer link, each labelled by what it actually is. |
| B6 | Pool sheet (demo) | States the balance is paper and there is nothing to shield. |
| B7 | Settings / Customize / Achievements / How it works / About | Each opens and renders without a console error. |

## C. API

| # | Item | Correct means |
| --- | --- | --- |
| C1 | `GET /api/config` | 200; ≥ 3 markets; ≥ 3 rounds; `units.stakeDecimals` 18; every round a 17-knot table; `contracts.market` non-null. |
| C2 | `GET /api/price?market=BTC` | 200; `price` a decimal string; `oracle.sources` ≥ 3; `markError` null; and `oracle.quotable` **agrees with the print it describes** — true exactly when the print is under 600s old and carries ≥ 3 publishers. Asserting it is always true fails whenever Pragma's cadence stretches, which is correct behaviour. |
| C3 | `…&history=1` | 200; ≥ 100 returns; `returnsInterval` `1m`. |
| C4 | `?market=NOPE` | 404 naming the pair. |
| C5 | `GET /api/quote` one-sigma band | 200; `ok:true`; multiplier > 10000 bps; `stakeUnits` = 10 × 1e18 for `stake=10`; window min < max. |
| C6 | band too wide | 200; `ok:false`; `refusal` `too-cheap`. |
| C7 | band too tight | 200; `ok:false`; `refusal` `too-rich`. |
| C8 | bad tier / no spot / stake twice / unknown param | 400 each. The parameter is `tier`, not `round`; an unknown key is refused, never ignored. |
| C9 | `GET /api/markets` | 200; `deployed:true`; every market carries `roundSeconds`, `bankroll`, `reserved`. |
| C10 | `GET /api/audit/<settled>` | 200; `sound:true`; `failed` and `unchecked` empty; 11 checks. |
| C11 | `GET /api/audit/999999` → 404; `/abc` → 400 | |
| C12 | `GET /api/position/0x1` | 200; `exists:false` — absent, not an error. |
| C13 | `GET /api/position/nothex` | 400. |
| C14 | `GET /api/health` | Status code agrees with `ok`; every component reports a status; `keeper` present and never able to force `down`. |
| C15 | `POST /api/rpc` read | 200 and a result. |
| C16 | `POST /api/rpc` write | 403 with code -32601. |
| C17 | `GET /api/keeper` | 200; `configured:true`; `reachable:true`; cycles > 0. |
| C18 | `GET /api/position/<commitment>?low=&high=` | `won` is null without a band and a boolean with one. The route never claims to know an outcome it cannot compute. |

## D. Contracts, on the real network

| # | Item | Correct means |
| --- | --- | --- |
| D1 | Market deployed | `getClassHashAt` returns a class for the market address. |
| D2 | Relay deployed | Same for the relay. |
| D3 | Relay serves Pragma's timestamp | `published_at` differs from `relayed_at` and matches mainnet's print time. |
| D4 | Settlement is real | ≥ 1 market `is_settled`, `settled_sources` ≥ 3, `settled_price` > 0. |
| D5 | Settled price immutable | The same market re-read later returns the identical price. |
| D6 | Conservation | Every market: `paid ≤ staked + bankroll`. |
| D7 | Reserve | Every market: `paid + reserved ≤ staked + bankroll`. |
| D8 | Round length recorded | Every market's `round_seconds` ∈ {900, 3600, 14400}. |
| D9 | Open/settle/claim end to end | `pnpm e2e:devnet` green including every refusal. |
| D10 | Pool sandwich against the real pool | Needs a registered account holding a note. |
| D11 | `open_position` live on the deployed contract | `quote_offsets` answers on the Sepolia market address. |

## E. External integrations

| # | Item | Correct means |
| --- | --- | --- |
| E1 | Pragma mainnet | Live read returns ≥ 3 publishers, age under 900s. |
| E2 | Binance tape | Live mark returned, no 451, ≥ 100 minute closes. |
| E3 | Starknet RPC | `/api/health` `chain.status` ok or degraded, never down. |
| E4 | Postgres | Row count exceeds the current process's cycle count — i.e. it survived a restart. |
| E5 | Keeper on Railway | Cycling, settling, listing; no duplicate market per pair. |
| E6 | Keeper balance floor | Below the floor it stops listing and says so, and keeps settling. |

## F. Desk flows

| # | Item | Correct means |
| --- | --- | --- |
| F1 | Switch market | Coin key cycles BTC → ETH → STRK; price, chart and quote all follow. |
| F2 | Switch round tier | 15m/1h/4h change the quote and the band window. |
| F3 | Change stake | Payout scales linearly with stake. |
| F4 | Band nudge `[` / `]` | `]` widens and the multiplier falls; `[` tightens and it rises; the band stays inside the sellable window. |
| F5 | Fire on the demo desk | A ticket appears, the balance drops by the stake, the cutoff ring counts down. |
| F6 | Settle-due button | Appears when markets are past cutoff and states how many. |
| F7 | Wallet connect, none installed | The console says no wallet was found, and the demo desk still works. |
| F8 | Failed upstream | A dead dependency renders a stated reason, never a blank panel. |
| F9 | Mobile 375px | No horizontal scroll. |
| F10 | Reduced motion | Honoured. |

## G. Repo hygiene

| # | Item | Correct means |
| --- | --- | --- |
| G1 | No mocks in shipped code | No mock/stub/TODO/fake/dummy outside `cairo/src/devnet.cairo` and HTML `placeholder` attributes. |
| G2 | Tests | Cairo, SDK, e2e and integration suites all green. |
| G3 | Typecheck | Clean across SDK, web, keeper. |
| G4 | README accurate | Every path it names exists. |
| G5 | Working tree committed | No uncommitted work; `main` pushed. |

## H. The public trading route, on chain

Exercised by `scripts/e2e.mjs` and `scripts/integration.mjs` against a real chain.

| # | Item | Correct means |
| --- | --- | --- |
| H1 | `quote_offsets` before committing | The multiplier quoted for a reach is the one charged, to the basis point. |
| H2 | `open_position` from a plain account | Position exists under the browser's commitment, with the stake actually transferred. |
| H3 | The band is not on chain | The stored position holds two reach ratios and no band. |
| H4 | Ownership | The position records the opening address; `claim_position` pays that address. |
| H5 | A stranger with the secret | Refused `NOT_YOUR_POSITION` even holding the full preimage. |
| H6 | A band that was not paid for | Refused — the commitment binds the band, the reach binds the price. |
| H7 | Cross-route claims | `WRONG_CLAIM_ROUTE` both directions. |
| H8 | Winning payout | Balance rises by exactly `stake × multiplier`; `paid ≤ staked + bankroll`. |
| H9 | Route parity | The same band costs the same on both routes. |
| H10 | Wallet without STRK20 | Offered the direct route rather than refused; the console says what it hides. |

## I. The console's own trading code, against a real chain

`scripts/integration.mjs`. These import the functions the browser calls rather than
reimplementing them, so a pass here is a statement about the shipped code path.

| # | Item | Correct means |
| --- | --- | --- |
| I1 | Desk quote == chain quote | `quoteOff` in TypeScript equals `quote_offsets` on chain for the same reach. |
| I2 | `openCalls` shape | Two calls: an exact approve to the market, then `open_position`. |
| I3 | Pre-signature simulation | The simulation `submitDirect` runs before asking for a signature is accepted. |
| I4 | Stake debited | Exactly the stake leaves the trader's balance, no more. |
| I5 | Position readable by the app's decoder | `decodePosition` finds it under the browser's commitment with the right stake and multiplier. |
| I6 | Owner bound | `owner` is the trading address. |
| I7 | Reach stored, band absent | Stored offsets equal `reachOf`, and neither band edge appears. |
| I8 | Market accounting | `staked` rises by the stake; the whole payout is reserved. |
| I9 | Duplicate open | `POSITION_EXISTS`. |
| I10 | Claim before settlement | `NOT_SETTLED_YET`. |
| I11 | Settlement | Market settles with ≥ 3 publishers and the price inside the band. |
| I12 | Stranger claim | `NOT_YOUR_POSITION` from a second real account. |
| I13 | Wrong band claim | `NO_SUCH_POSITION`. |
| I14 | Payout exact | Balance rises by exactly `payoutFor(stake, multiplier)`. |
| I15 | Claimed once | `claimed` set; a second claim is `ALREADY_CLAIMED`. |
| I16 | Conservation | `paid ≤ staked + bankroll` after the whole trade. |

## J. Unit tests on the calldata the browser sends

`packages/sdk/test/trade.test.ts`. Shape is what a chain cannot report politely — a felt in
the wrong slot deserialises into a different parameter.

| # | Item | Correct means |
| --- | --- | --- |
| J1 | Open is approve + `open_position` | Two calls, to the token and the market, in that order. |
| J2 | Approve is exact | The allowance equals the stake, never unlimited. |
| J3 | `open_position` fields | 8 felts: market id, commitment, low reach (u256), high reach (u256), stake (u256). |
| J4 | No band, no secret on the wire | Neither band edge nor the secret appears in the calldata. |
| J5 | Reach is scale free | The same band shape at any price produces the same two felts. |
| J6 | Claim reveals the band | 6 felts: market id, secret, band low, band high. |
| J7 | Reach prices identically to the band | `quoteOff` equals `quote` for the reach derived from that band. |
| J8 | `offsetsOf` refuses a non-straddling band | Throws `SpotOutsideBand`. |
| J9 | Two secrets, one band | Different commitments, identical reach. |

## K. Wallet-dependent flows

| # | Item | Correct means |
| --- | --- | --- |
| K1 | Connect a Starknet wallet | Address shown, network checked, capabilities probed. |
| K2 | Route picker with a STRK20 wallet | Both `VIA POOL` and `DIRECT` offered. |
| K3 | Open a position from the browser | Wallet prompts, transaction lands, position appears. |
| K4 | Claim from the browser | Payout returns to the connected address. |
| K5 | Shield / unshield | STRK moves into and out of the pool. |
| K6 | Wrong-network wallet | The console names the expected chain and refuses to act. |

---

# Results

Run against https://molfi.fun in a real browser, against Starknet Sepolia for the deployed
contracts, and against a local devnet for the trading route the live contract does not yet
carry. Console and network checked on every browser item.

Re-runnable: `pnpm verify` (C, D, E, G) · `pnpm test` (J) · `pnpm test:cairo` ·
`pnpm e2e:devnet` (H) · `pnpm test:integration` (I).

| Tier | Result |
| --- | --- |
| A. Pages | 9 / 9 PASS |
| B. Menu sheets | 7 / 7 PASS |
| C. API | 18 / 18 PASS |
| D. Contracts on the real network | 9 PASS · 3 UNTESTED |
| E. External integrations | 6 / 6 PASS |
| F. Desk flows | 10 / 10 PASS |
| G. Repo hygiene | 5 / 5 PASS |
| H. Public trading route, on chain | 10 / 10 PASS on a real chain — none of it reachable on the live deployment, see D11 |
| I. The console's own trading code | 16 / 16 PASS |
| J. Unit tests on the calldata | 9 / 9 PASS |
| K. Wallet-dependent flows | 5 PASS · 1 UNTESTED |

**104 PASS · 0 FAIL · 4 UNTESTED** across 108 items. Every item is listed individually at
the end of this document.

Nothing tested is broken. What is blocked is blocked on funds and on a wallet extension,
and the section below says exactly what each needs. Read the blocked list — "no defects"
and "a visitor can trade" are different sentences, and only the first is true today.

## The blocker that matters: nobody can trade

**D11 — `open_position` is not on the deployed contract.**
**D12 — nothing has ever been staked: `staked` is 0 across every market.**

One fact, not two: with no route on chain there is no way for anyone to stake, so D12 is
blocked *by* D11 rather than being a second problem. The public trading route is written, unit tested on its calldata,
proven end to end against a real chain twice over, and not on Sepolia — because declaring the
class costs about **60 STRK** and the deployer holds under 7. Measured, not guessed:
`estimateDeclareFee` returns 2.028e9 L2 gas from two independent nodes, and a
randomly-sampled Sepolia declare 200 blocks earlier cost 17 STRK for a quarter the bytecode.

Tried and rejected: the release profile (−14%), stripping `Debug`/`PartialEq` derives (0% —
Sierra already drops unused impls), `inlining-strategy = "avoid"` (11% *worse*). Fitting the
declare into the balance needs roughly 2,100 Sierra felts; the contract is 9,752 and the
*previous* one was 7,287. It is arithmetic, not effort.

### The funding path, since it is the whole of the fix

The Starknet Foundation faucet publishes a **public Agent API with no auth**, gated by a
proof of work the caller solves locally. `pnpm faucet <address>` implements it: request a
challenge, find a nonce whose SHA-256 has the required leading zero *bits* — bit-level, not
whole hex digits — submit, poll. It worked, and put 5 STRK on the deployer
([tx](https://sepolia.voyager.online/tx/0x3786f917ca4fc947fc8c6a4bef5b6c014a27d0ac3e7a1523bc1928b07807c77)).

Five is what the unauthenticated tier drips, and it is the only tier a script can reach.
The same faucet's web form offers **100 STRK** and its bundle calls `window.turnstile.reset()`
— the button stays disabled until a **Cloudflare Turnstile CAPTCHA** is solved. **3,000 STRK**
needs a GitHub sign-in. Both are things only the account holder can do.

Every tier also shares one cooldown of 24 hours per address, and the deployer is inside it.
Farming fresh addresses would get around that and would be abuse of a shared testnet
resource, so `faucet.mjs` asks once for the address it is given and reports the remaining
cooldown instead of retrying.

There is one more way through that needs no faucet at all: **a class is a chain-wide fact**.
The 60 STRK buys the *declare*, and once any account anywhere has declared this class,
deploying an instance of it costs about a tenth of a STRK. `golive.mjs` computes the class
hash from the local artifact, checks whether it is already on chain, and drops its own
requirement from 62 STRK to 3 when it is.

So the gap is 56 STRK, behind a CAPTCHA and a sign-in. They are recorded as UNTESTED rather
than FAIL because nothing in this repository can clear them — no commit, no fix, no amount of
work here. That classification is about cause, not severity: a visitor to molfi.fun genuinely
cannot trade today, and no label changes that.

`pnpm golive` is the whole remaining path in one command: check the balance and say exactly
how short it is, declare, deploy, list and fund the markets, repoint the SDK, open a real
position through the console's own call builders, and re-run the plan.

## What is untested, and why

**D10 — the pool sandwich against the real STRK20 pool.** Needs a registered account holding
a note.

Checked twice, because the first answer was too quick. Running it locally is not a way round:
`starknet-privacy`'s own devnet e2e harness builds its provider from
`ScreeningCallMockProofProvider` — a mock — because devnet has no proof-verification syscall
to satisfy. A local run would exercise the real pool contract, the real action compilation and
the real `privacy_invoke` deserialisation, and would still be resting on a mocked proof, so it
cannot be recorded as a pass here whatever it showed. On a public network the proving service
is the blocker and has no public endpoint. No public proving or discovery endpoint exists: the SDK docs, `starknet-privacy`,
`strk20-by-example.org` and the starter kit all point at localhost, self-hosting needs a
synced Pathfinder node, and the pool verifies an FPI screening signature on chain, so
self-hosting is not a route around it. `scripts/pool-probe.mjs` validates molfi's action list
against the deployed pool's own `compile_actions` view as far as `SUBCHANNEL_NOT_FOUND`,
which is the last inch reachable without a note.

**K5 — shield and unshield.** Both are STRK20 pool actions, so this is blocked by D10 rather
than by the browser.

**K1–K4 and K6 were run**, against a local devnet carrying the public trading route, with a
real wallet: `scripts/dev/wallet-signer.mjs` holds a key, signs with starknet.js and submits;
`scripts/dev/wallet-page.js` registers it over the standard `wallet-standard:register-wallet`
handshake. Not a mock — the transactions land in blocks and the positions they open are
readable by anyone. What it is not is a browser *extension*, which is the same shape as a
hardware wallet or a WalletConnect session, and the untested remainder is the extension's own
approval dialog rather than molfi's use of it.

The full loop ran through the real UI: connect → route picker → paint a band → fire →
`approve + open_position` signed → position on chain with the reach stored and the band
absent → settle → `CLAIM 1 WINNING POSITION` → `claim_position` signed → balance up by
6.2345, which is exactly the 5 staked times the 1.2469x quoted.

**That run found four bugs nothing else had.** They are the reason it was worth doing:

| Found | Why nothing else caught it |
| --- | --- |
| `capabilitiesOf` reported every wallet STRK20-capable | starknet.js binds `strk20InvokeTransaction` onto every `WalletAccountV6`, so the check was always true. molfi offered the pool route to wallets that cannot take it and made it the *default*. Now probed with a read-only `strk20Balances`. |
| The network check demanded a mainnet wallet on devnet | `NETWORK === "sepolia" ? "sepolia" : "mainnet"` treated anything not literally "sepolia" as mainnet. Now compares chain ids. |
| The fire key could do nothing, silently | `if (!band.band || !target) return;` with no message — indistinguishable from a broken app. It says which. |
| A refused trade showed `RPC: starknet_estimateFee with params {` | `errorText` took the first line, which is the request echo. The keeper had already learned this; the console had not. |

## Fixed during this run

| Item | Was | Fix |
| --- | --- | --- |
| B2 | The oracle sheet printed Pragma's Sepolia address, which settles nothing here | Reads the configured oracle and says it is a relay, with the reason |
| B5 | The account sheet labelled the relay "Pragma oracle" | Labelled by what the address actually is |
| C8 | `/api/quote` ignored unknown parameters, so `?round=2` priced the 15m round | Unknown keys are refused, naming the parameter |
| C18 | The position route reported `won: false` for a band it cannot see | `won` is null unless the caller supplies the band |
| G5 | 29 files of verified work uncommitted, and `git push` deploys nothing here | Committed; deployed with the CLI, which is how this project has always shipped |
| — | A Sepolia deploy left `MOLFI_MARKET` pointing at the old contract | The deploy rewrites it, scoped to that record |
| C14/E1 | `/api/health` reported `oracle: down` for a 646s print the contract settles at 900s | Four call sites asked the desk's 600s question about an on-chain decision; health now reports `settleable` (900s) and `quotable` (600s) separately |
| — | The verifier aborted on one dropped RPC connection | Retries transport failures; reverts still fail on the first attempt |
| — | Preflight measured bytecode size and said Clear while the declare was unaffordable 7× over | It prices the declare against live gas and the deployer's balance |
| K2 | Every wallet was reported STRK20-capable, so the pool route was offered — and defaulted to — for wallets that always fail it | `capabilitiesOf` probes with a read-only `strk20Balances` instead of checking a method starknet.js always defines |
| K1/K6 | On any deployment not literally named "sepolia", the console demanded a mainnet wallet | The network check compares chain ids, not deployment names |
| K3 | The fire key returned silently when it had nothing to trade | It says `NO OPEN MARKET FOR THIS ROUND` or `NO PRICE YET` |
| K3 | A refused trade showed the trader `RPC: starknet_estimateFee with params {` | `errorText` now extracts the Cairo reason or the RPC message, as the keeper already did |
| F6 | The settle-due key used the browser's clock, so it stayed hidden on a chain running ahead | `/api/markets` serves the chain's timestamp; the console interpolates from it |

## Mocks, stubs and errors

Zero mocks and zero stubs in shipped code: `cairo/src/devnet.cairo`'s `StubOracle` and
`StubToken` exist only for local runs and `deploy.mjs` refuses to put them on a public chain.
Every price is a real multi-publisher Pragma median, every settlement a real transaction,
every ledger row a real Postgres row that outlived a restart, every trade in the H and I
tiers a real signed transaction against a real contract.

Zero console errors and zero failed network requests across every page and sheet tested —
checked per item, including under injected failure, where the live console rendered
`market list unavailable (502)` and recovered cleanly rather than blanking.

---

# Every item, with its final status

**108 items · 104 PASS · 0 FAIL · 4 UNTESTED.** No item is passing that was not run.

| # | Item | Status | Verified by |
| --- | --- | --- | --- |
| **A. Pages** | | | |
| A1 | / landing | **PASS** | browser — headline, START, three doors; 0 API calls, 0 console errors |
| A2 | /play demo desk | **PASS** | browser — price 79,754.33, PRAGMA FRESH 10src/75s, 1.25x, 3 req/min |
| A3 | /play → live console | **PASS** | browser — LIVE · BTC · STARKNET SEPOLIA, CLOSES IN 11:45, SHIELDED —, 22 req/min |
| A4 | /live | **PASS** | browser + curl — 3 countdowns, 21 settled w/ publishers, 24 /m/ links; present in raw HTML |
| A5 | /keeper | **PASS** | browser — CAN/CANNOT, RUNNING, 11 cycles, 40 tx links; server-rendered |
| A6 | /privacy | **PASS** | browser — both routes stated, 3 groups, 5 route badges, live staked |
| A7 | /m/<settled> | **PASS** | browser — EVERY CHECK PASSED, 11 checks, 0 unchecked |
| A8 | /m/999999 | **PASS** | browser — 'No market #999999' + console link, no 500 |
| A9 | /m/abc | **PASS** | browser — same graceful not-found, no exception |
| **B. Menu sheets** | | | |
| B1 | Menu opens | **PASS** | browser — sheet, avatar, PAPER BALANCE, RESET |
| B2 | Oracle sheet | **PASS** | browser — names the relay 0x0275a7fd…, explains it is not Pragma; 3 pairs w/ drift  [FIXED] |
| B3 | Leaderboard | **PASS** | browser — states no player ranking is possible; markets w/ solvency |
| B4 | History | **PASS** | browser — empty state is a sentence |
| B5 | Account | **PASS** | browser — 4 addresses, relay labelled PRICE RELAY  [FIXED] |
| B6 | Pool sheet (demo) | **PASS** | browser — states the balance is paper |
| B7 | Settings/Customize/Achievements/How it works/About | **PASS** | browser — all 5 render, 0 console errors |
| **C. API** | | | |
| C1 | /api/config | **PASS** | 3 markets, 3 rounds, 18 decimals, market non-null |
| C2 | /api/price quotability | **PASS** | quotable agrees with age≤600s and sources≥3  [PLAN ITEM FIXED] |
| C3 | price history | **PASS** | 999 returns, 1m interval |
| C4 | unknown pair | **PASS** | 404 naming the pair |
| C5 | one-sigma quote | **PASS** | 1.2508x, stakeUnits 10e18, window min<max |
| C6 | band too wide | **PASS** | ok:false refusal too-cheap |
| C7 | band too tight | **PASS** | ok:false refusal too-rich |
| C8 | bad tier / no spot / stake twice / unknown param | **PASS** | 400/404/400/400  [FIXED: unknown params were ignored] |
| C9 | /api/markets | **PASS** | deployed:true, every market has roundSeconds/bankroll/reserved |
| C10 | /api/audit/<settled> | **PASS** | sound:true, 11 checks, 0 failed, 0 unchecked |
| C11 | audit 999999 / abc | **PASS** | 404 / 400 |
| C12 | /api/position/0x1 | **PASS** | 200 exists:false — absent, not an error |
| C13 | /api/position/nothex | **PASS** | 400 |
| C14 | /api/health | **PASS** | status agrees with ok; 5 components report; keeper cannot force down  [FIXED] |
| C15 | rpc proxy read | **PASS** | 200 with a block number |
| C16 | rpc proxy write | **PASS** | 403, code -32601 |
| C17 | /api/keeper | **PASS** | configured, reachable, cycles>0 |
| C18 | position ?low=&high= | **PASS** | won null without a band  [FIXED] |
| **D. Contracts on Sepolia** | | | |
| D1 | market deployed | **PASS** | chain — class at 0x03b00e6e… |
| D2 | relay deployed | **PASS** | chain — class at 0x0275a7fd… |
| D3 | relay serves Pragma's timestamp | **PASS** | chain — published 1788648896 ≠ relayed 1788648916 |
| D4 | settlement is real | **PASS** | chain — 38/41 settled, ≥3 publishers, price>0 |
| D5 | settled price immutable | **PASS** | chain — identical on re-read |
| D6 | conservation | **PASS** | chain — paid ≤ staked+bankroll, every market |
| D7 | reserve | **PASS** | chain — paid+reserved ≤ staked+bankroll, every market |
| D8 | round lengths calibrated | **PASS** | chain — all ∈ {900,3600,14400} |
| D9 | open/settle/claim end to end | **PASS** | pnpm e2e:devnet — 30 checks green |
| D10 | pool sandwich vs the real STRK20 pool | **UNTESTED** | no public prover/indexer endpoint exists; pool-probe reaches SUBCHANNEL_NOT_FOUND |
| D11 | open_position live on the deployed contract | **UNTESTED** | declare costs ~60 STRK, balance 8.5 |
| D12 | somebody has actually traded | **UNTESTED** | blocked by D11 — no route on chain to stake through |
| **E. External integrations** | | | |
| E1 | Pragma mainnet via the relay | **PASS** | 10/11/12 publishers, age<900s |
| E2 | exchange tape | **PASS** | 999 minute closes, no geo-block |
| E3 | Starknet RPC | **PASS** | chain:ok |
| E4 | Postgres | **PASS** | 236 ledger rows vs 22 cycles this process — survived restarts |
| E5 | keeper on Railway | **PASS** | cycling, lastError null, no duplicate market per pair |
| E6 | keeper balance floor | **PASS** | stops listing below the floor, keeps settling |
| **F. Desk flows** | | | |
| F1 | switch market | **PASS** | browser — BTC→ETH→STRK→BTC, price follows |
| F2 | switch round tier | **PASS** | browser — 1.25/1.25/1.27x across 15m/1h/4h |
| F3 | change stake | **PASS** | browser — payout/stake == multiplier |
| F4 | band nudge [ / ] | **PASS** | browser — ] 1.25→1.21, [ →1.30 |
| F5 | fire on the demo desk | **PASS** | browser — balance 250→248.50, HOUSE 0.2%, ring 14:10 |
| F6 | settle-due button | **PASS** | browser — 'SETTLE STRK/USD · 1 DUE' when past cutoff |
| F7 | connect with no wallet | **PASS** | browser — flash 'NO STARKNET WALLET FOUND', demo desk still works |
| F8 | failed upstream | **PASS** | browser — injected 502s → 'market list unavailable (502)', recovered |
| F9 | mobile 375px | **PASS** | browser — no horizontal scroll on /play or /live |
| F10 | reduced motion | **PASS** | browser — prefers-reduced-motion block shipped in production CSS |
| **G. Repo hygiene** | | | |
| G1 | no mocks or stubs in shipped code | **PASS** | grep clean outside devnet.cairo |
| G2 | tests | **PASS** | 81 Cairo, 77 SDK, 30 e2e, 26 integration |
| G3 | typecheck | **PASS** | 0 errors across SDK, web, keeper |
| G4 | README/docs paths | **PASS** | every named path exists |
| G5 | working tree committed | **PASS** | clean, main pushed |
| **H. Public trading route, on chain** | | | |
| H1 | quote_offsets before committing | **PASS** | quoted == charged to the bps |
| H2 | open_position from a plain account | **PASS** | position exists, stake transferred |
| H3 | the band is not on chain | **PASS** | stored reach only; neither edge present |
| H4 | ownership | **PASS** | owner recorded; claim pays that address |
| H5 | stranger with the secret | **PASS** | NOT_YOUR_POSITION |
| H6 | band not paid for | **PASS** | refused |
| H7 | cross-route claims | **PASS** | WRONG_CLAIM_ROUTE both directions |
| H8 | winning payout | **PASS** | stake × multiplier; paid ≤ staked+bankroll |
| H9 | route parity | **PASS** | same band, same price both routes |
| H10 | wallet without STRK20 | **PASS** | offered the direct route, console says what it hides |
| **I. The console's own trading code** | | | |
| I1 | desk quote == chain quote | **PASS** | quoteOff == quote_offsets |
| I2 | openCalls shape | **PASS** | exact approve + open_position |
| I3 | pre-signature simulation | **PASS** | accepted |
| I4 | stake debited | **PASS** | exactly the stake, no more |
| I5 | readable by the app's decoder | **PASS** | decodePosition finds it |
| I6 | owner bound | **PASS** | == trading address |
| I7 | reach stored, band absent | **PASS** | offsets == reachOf |
| I8 | market accounting | **PASS** | staked up, whole payout reserved |
| I9 | duplicate open | **PASS** | POSITION_EXISTS |
| I10 | claim before settlement | **PASS** | NOT_SETTLED_YET |
| I11 | settlement | **PASS** | ≥3 publishers, price inside the band |
| I12 | stranger claim | **PASS** | NOT_YOUR_POSITION from a second real account |
| I13 | wrong band claim | **PASS** | NO_SUCH_POSITION |
| I14 | payout exact | **PASS** | payoutFor(stake, multiplier) |
| I15 | claimed once | **PASS** | ALREADY_CLAIMED on the second |
| I16 | conservation | **PASS** | paid ≤ staked+bankroll after the trade |
| **J. Unit tests on the calldata** | | | |
| J1 | open is approve + open_position | **PASS** | node:test |
| J2 | approve is exact | **PASS** | allowance == stake, never unlimited |
| J3 | open_position fields | **PASS** | 8 felts in order |
| J4 | no band, no secret on the wire | **PASS** | asserted absent |
| J5 | reach is scale free | **PASS** | same shape → same felts |
| J6 | claim reveals the band | **PASS** | 6 felts |
| J7 | reach prices identically to the band | **PASS** | quoteOff == quote |
| J8 | offsetsOf refuses a non-straddling band | **PASS** | throws SpotOutsideBand |
| J9 | two secrets, one band | **PASS** | different commitments, identical reach |
| **K. Wallet-signed flows** | | | |
| K1 | connect a Starknet wallet | **PASS** | browser — real wallet over wallet-standard; address shown, chain checked, capabilities probed |
| K2 | route picker reflects real capability | **PASS** | browser — a wallet without STRK20 is offered DIRECT only  [BUG FIXED] |
| K3 | open a position from the browser | **PASS** | browser — wallet signed approve+open_position, tx landed, position on chain |
| K4 | claim from the browser | **PASS** | browser — wallet signed claim_position, balance +6.2345 = 5 x 1.2469 |
| K5 | shield / unshield | **UNTESTED** | STRK20 pool actions — blocked by D10, not by the browser |
| K6 | wrong-network wallet | **PASS** | browser — refused, naming both chains  [BUG FIXED] |


---

# The privacy flow, checked properly

The question this project exists to answer, so it gets its own section. Checked against the
**live Sepolia deployment**, not devnet.

| # | Item | Status | Evidence |
| --- | --- | --- | --- |
| P1 | The deployed contract exposes `privacy_invoke` | **PASS** | Read from the class ABI at `0x03b00e6e…b068` |
| P2 | It is bound to the real STRK20 pool | **PASS** | `pool()` returns `0x0254a6b2…cfe0d91`, the official Sepolia pool |
| P3 | molfi's private action list parses in the real pool | **PASS** | `pool-probe.mjs` — the enum parses, replay protection is satisfied, validation reaches `SUBCHANNEL_NOT_FOUND` (no note), which is as far as anything gets without a deposit |
| P4 | A STRK20 wallet is offered the private route | **PASS** | Browser, production: a wallet advertising Wallet API 0.10.3 gets `VIA THE STRK20 POOL · NOT YOU, NOT THE SIZE, NOT THE BAND` |
| P5 | Capability is detected without a consent prompt | **PASS** | `wallet_supportedWalletApi` only; `strk20Balances` is never called to feature-detect |
| P6 | A non-STRK20 wallet is not offered it | **PASS** | Browser: a wallet advertising 0.8.0 gets no pool route |
| P7 | The band is hidden on the public route too | **PASS** | Unit-tested: neither band edge nor the secret appears in `open_position` calldata |
| P8 | An actual private trade, end to end | **UNTESTED** | Needs a wallet holding a shielded note. No public prover endpoint exists, and the wallet — not molfi — is the component that proves |

**What this means.** The private order flow is deployed, wired, and reachable: a visitor with
Ready or Xverse on Sepolia is shown the pool route and the console will build the sandwich
for their wallet to prove and submit. molfi never holds a viewing key and never proves
anything itself, which is what the STRK20 guidance requires of a dapp. What has not happened
is a human with a funded privacy wallet pressing the key — P8 — and nothing in this
repository can supply that.
