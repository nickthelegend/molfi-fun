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
| C2 | `GET /api/price?market=BTC` | 200; `price` a decimal string; `oracle.sources` ≥ 3; `oracle.quotable` true; `markError` null. |
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
| D. Contracts on the real network | 9 PASS · 1 BLOCKED · 2 FAIL |
| E. External integrations | 6 / 6 PASS |
| F. Desk flows | 10 / 10 PASS |
| G. Repo hygiene | 5 / 5 PASS |
| H. Public trading route, on chain | 10 / 10 PASS on a real chain · 0 / 10 reachable on the live deployment |
| I. The console's own trading code | 16 / 16 PASS |
| J. Unit tests on the calldata | 9 / 9 PASS |
| K. Wallet-dependent flows | 6 BLOCKED |

**99 PASS · 2 FAIL · 7 BLOCKED** across 108 items.

## The two failures, and they are one failure

**D11 — `open_position` is not on the deployed contract.**
**D12 — nothing has ever been staked: 41 markets, `staked` 0 across all of them.**

Both are the same fact. The public trading route is written, unit tested on its calldata,
proven end to end against a real chain twice over, and not on Sepolia — because declaring the
class costs about **60 STRK** and the deployer holds under 7. Measured, not guessed:
`estimateDeclareFee` returns 2.028e9 L2 gas from two independent nodes, and a
randomly-sampled Sepolia declare 200 blocks earlier cost 17 STRK for a quarter the bytecode.

Tried and rejected: the release profile (−14%), stripping `Debug`/`PartialEq` derives (0% —
Sierra already drops unused impls), `inlining-strategy = "avoid"` (11% *worse*). Fitting the
declare into the balance needs roughly 2,100 Sierra felts; the contract is 9,752 and the
*previous* one was 7,287. It is arithmetic, not effort.

Both official faucets gate on a GitHub sign-in, which is the account holder's to give; the
one third-party CLI faucet's backend returns 404. This is a funding dependency, not a bug,
and it is marked FAIL rather than BLOCKED because a user of molfi.fun genuinely cannot trade
today.

## What is blocked, and why

**D10 — the pool sandwich against the real STRK20 pool.** Needs a registered account holding
a note. No public proving or discovery endpoint exists: the SDK docs, `starknet-privacy`,
`strk20-by-example.org` and the starter kit all point at localhost, self-hosting needs a
synced Pathfinder node, and the pool verifies an FPI screening signature on chain, so
self-hosting is not a route around it. `scripts/pool-probe.mjs` validates molfi's action list
against the deployed pool's own `compile_actions` view as far as `SUBCHANNEL_NOT_FOUND`,
which is the last inch reachable without a note.

**K1–K6 — everything that needs a wallet to sign.** The Claude in Chrome extension is not
connected in this session and the in-app browser has no Starknet wallet installed, so no
extension can be driven. What this leaves untested is the wallet's own approval dialog. The
code path behind it is covered: `scripts/integration.mjs` imports the same `openCalls` and
`claimCalls` the console calls, hands them to a real `Account.execute` — the same call
`submitDirect` makes — and reads the result back with the same `decodePosition` the API uses.

## Fixed during this run

| Item | Was | Fix |
| --- | --- | --- |
| B2 | The oracle sheet printed Pragma's Sepolia address, which settles nothing here | Reads the configured oracle and says it is a relay, with the reason |
| B5 | The account sheet labelled the relay "Pragma oracle" | Labelled by what the address actually is |
| C8 | `/api/quote` ignored unknown parameters, so `?round=2` priced the 15m round | Unknown keys are refused, naming the parameter |
| C18 | The position route reported `won: false` for a band it cannot see | `won` is null unless the caller supplies the band |
| G5 | 29 files of verified work uncommitted, and `git push` deploys nothing here | Committed; deployed with the CLI, which is how this project has always shipped |
| — | A Sepolia deploy left `MOLFI_MARKET` pointing at the old contract | The deploy rewrites it, scoped to that record |

## Mocks, stubs and errors

Zero mocks and zero stubs in shipped code: `cairo/src/devnet.cairo`'s `StubOracle` and
`StubToken` exist only for local runs and `deploy.mjs` refuses to put them on a public chain.
Every price is a real multi-publisher Pragma median, every settlement a real transaction,
every ledger row a real Postgres row that outlived a restart, every trade in the H and I
tiers a real signed transaction against a real contract.

Zero console errors and zero failed network requests across every page and sheet tested —
checked per item, including under injected failure, where the live console rendered
`market list unavailable (502)` and recovered cleanly rather than blanking.
