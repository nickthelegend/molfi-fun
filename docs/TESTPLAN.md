# molfi — test plan

Written before testing. Every item states the **specific** expected result, so a pass is a
match rather than a judgement call. Executed against the live product at https://molfi.fun in
a real browser, with console and network checked on every item.

Legend: **PASS** = matched exactly · **FAIL** = did not · **UNTESTABLE** = blocked by a
dependency that genuinely does not exist here, stated as such rather than passed.

---

## A. Pages

| # | Item | Correct means |
| --- | --- | --- |
| A1 | `/` landing | MOLFI wordmark renders; 3D console visible; headline "Take a position nobody can see."; START links `/play`; three doors link `/live`, `/privacy`, `/keeper`. No console error. |
| A2 | `/play` demo desk | Live BTC price > 0 in the readout; chart has a non-flat trace; `PRAGMA` strip shows a verdict, publisher count, age; a multiplier ≥ 1.05x; `GO LIVE` present (contract is deployed). No console error. |
| A3 | `/play` → live console | Header reads `LIVE · BTC · STARKNET SEPOLIA`; a seeded non-flat chart within 5s; market address printed at the foot; either a countdown or `NO OPEN MARKET`; shielded shows `—` when unconnected, never `0.000`. |
| A4 | `/live` | Three sections. Every open market shows a ticking countdown; every settled market shows a price and publisher count; each row links `/m/<id>`. Server-rendered — content present with JS disabled. |
| A5 | `/keeper` | CAN/CANNOT columns both populated; status shows RUNNING with cycles > 0 and a recent lag; action log non-empty with at least one `tx` link. |
| A6 | `/privacy` | Three groups (Hidden / Public / Could still infer), each with ≥ 3 rows; live staked total rendered from chain. |
| A7 | `/m/<settled id>` | Verdict line "EVERY CHECK PASSED"; 11 checks each PASS; settled price, publishers, bankroll shown; no `unchecked`. |
| A8 | `/m/<nonexistent>` | "No market #N" with an explanation and a link to the console — not a 500, not an empty frame. |
| A9 | `/m/abc` (non-numeric) | Same graceful not-found. No unhandled exception. |

## B. Menu sheets — must not regress

| # | Item | Correct means |
| --- | --- | --- |
| B1 | Menu opens | Sheet slides over; avatar `m`; balance labelled `Paper balance` when unconnected. |
| B2 | Oracle sheet | All three pairs listed with median, mark, publishers, age, drift. STRK shown at 5dp, not `0.02`. |
| B3 | Leaderboard sheet | States plainly that there is no player ranking and cannot be; lists markets with staked/paid and a solvency verdict. |
| B4 | History sheet | Renders without error; empty state is a sentence, not a blank. |
| B5 | Account sheet | Shows deployment addresses; each is copyable; explorer links present. |
| B6 | Pool sheet | On the demo desk, states the balance is paper and there is nothing to shield. |
| B7 | Settings / Customize / Achievements / How it works / About | Each opens and renders without a console error. |

## C. API

| # | Item | Correct means |
| --- | --- | --- |
| C1 | `GET /api/config` | 200; ≥ 3 markets; ≥ 3 rounds; `units.stakeDecimals` 18; every round carries a 17-knot table; `contracts.market` non-null. |
| C2 | `GET /api/price?market=BTC` | 200; `price` a decimal string; `oracle.sources` ≥ 3; `oracle.quotable` true; `markError` null. |
| C3 | `GET /api/price?market=BTC&history=1` | 200; ≥ 100 returns; `returnsInterval` `1m`. |
| C4 | `GET /api/price?market=NOPE` | 404 with a message naming the pair. |
| C5 | `GET /api/quote` one-sigma band | 200; `ok:true`; multiplier > 10000 bps; `stakeUnits` = 10 × 1e18 for `stake=10`; window min < max. |
| C6 | `GET /api/quote` band too wide | 200; `ok:false`; `refusal` `too-cheap`. |
| C7 | `GET /api/quote` band too tight | 200; `ok:false`; `refusal` `too-rich`. |
| C8 | `GET /api/quote` bad tier / no spot / stake twice / unknown param | 400 each. The parameter is `tier`, not `round`; an unknown key is refused rather than silently ignored. |
| C9 | `GET /api/markets` | 200; `deployed:true`; every market carries `roundSeconds`, `bankroll`, `reserved`. |
| C10 | `GET /api/audit/<settled>` | 200; `sound:true`; `failed` and `unchecked` both empty; 11 checks. |
| C11 | `GET /api/audit/999999` | 404. `GET /api/audit/abc` → 400. |
| C12 | `GET /api/position/0x1` | 200; `exists:false` — absent, not an error. |
| C13 | `GET /api/position/nothex` | 400. |
| C14 | `GET /api/health` | Status code agrees with `ok`; every component reports a status; `keeper` present and never able to force `down`. |
| C15 | `POST /api/rpc` read | 200 and a result. |
| C16 | `POST /api/rpc` write | 403 with code -32601. |
| C17 | `GET /api/keeper` | 200; `configured:true`; `reachable:true`; cycles > 0. |

## D. Contracts, on the real network

| # | Item | Correct means |
| --- | --- | --- |
| D1 | Market deployed | `starknet_getClassHashAt` returns a class for the market address. |
| D2 | Relay deployed | Same for the relay address. |
| D3 | Relay serves Pragma's timestamp | `get_relayed` `published_at` differs from `relayed_at`, and matches mainnet's print time. |
| D4 | Settlement is real | ≥ 1 market with `is_settled` true, `settled_sources` ≥ 3, `settled_price` > 0. |
| D5 | Settled price is immutable | The same market re-read later returns the identical settled price. |
| D6 | Conservation holds | For every market, `paid ≤ staked + bankroll`. |
| D7 | Reserve holds | For every market, `paid + reserved ≤ staked + bankroll`. |
| D8 | Round length recorded | Every market's `round_seconds` is one molfi calibrates (900/3600/14400). |
| D9 | Open/settle/claim end to end | `pnpm e2e:devnet` green, including both refusals. |
| D10 | Pool sandwich against the real pool | Requires a registered account holding a note. |

## E. External integrations

| # | Item | Correct means |
| --- | --- | --- |
| E1 | Pragma mainnet | Live read returns ≥ 3 publishers and an age under 900s. |
| E2 | Binance tape | Live mark returned, no 451, ≥ 100 minute closes. |
| E3 | Starknet RPC | `/api/health` `chain.status` ok or degraded, never down. |
| E4 | Postgres | Row count exceeds the current process's cycle count — i.e. survived a restart. |
| E5 | Keeper on Railway | Cycling, settling, listing; no duplicate market per pair. |

## F. Flows and edge cases

| # | Item | Correct means |
| --- | --- | --- |
| F1 | Switch market on the demo desk | Coin key cycles BTC → ETH → STRK; price, chart and quote all follow. |
| F2 | Switch round tier | 15m/1h/4h change the quote and the band window. |
| F3 | Change stake | Payout scales linearly with stake. |
| F4 | Band nudge `[` / `]` | Multiplier moves in the correct direction; band stays within the sellable window. |
| F5 | Fire on the demo desk | A ticket appears; the cutoff ring counts down. |
| F6 | Settle-due button in the live console | Appears when markets are past cutoff; states how many. |
| F7 | Wallet connect | Requires a Starknet wallet extension. |
| F8 | Offline / failed request | A dead upstream renders a stated reason, never a blank panel. |
| F9 | Mobile 380px | The device frame fits without horizontal scroll. |
| F10 | Reduced motion | Honoured — no animation when the OS asks for none. |

## H. The public trading route

The route that made molfi tradeable from an ordinary wallet. Every item below is exercised by
`scripts/e2e.mjs` against a real chain, not in a harness.

| # | Item | Correct means |
| --- | --- | --- |
| H1 | `quote_offsets` before committing | The multiplier the contract quotes for a reach is the one it then charges, to the basis point. |
| H2 | `open_position` from a plain account | Position exists under the browser's commitment, with the stake actually transferred. |
| H3 | The band is not on chain | The stored position holds two reach ratios and no band; nothing in the transaction reveals which range was bought. |
| H4 | Ownership | The position records the opening address, and `claim_position` pays that address. |
| H5 | A stranger with the secret | Refused with `NOT_YOUR_POSITION`, even holding the full preimage. |
| H6 | A band that was not paid for | Refused — the commitment binds the band and the reach binds the price. |
| H7 | Cross-route claims | A direct position cannot be claimed through the pool, or a pool position from an address: `WRONG_CLAIM_ROUTE`. |
| H8 | Winning payout | The trader's balance rises by exactly `stake × multiplier`, and the market's `paid` never exceeds `staked + bankroll`. |
| H9 | Route parity | The same band costs the same on both routes. |
| H10 | Wallet without STRK20 | Offered the direct route rather than refused; the console says what it hides. |

## G. Repo hygiene

| # | Item | Correct means |
| --- | --- | --- |
| G1 | No mocks in shipped code | No mock/stub/TODO/fake/dummy outside `cairo/src/devnet.cairo` and HTML `placeholder` attributes. |
| G2 | Tests | 81 Cairo, 65 SDK, all passing. |
| G3 | Typecheck | Clean across SDK, web, keeper. |
| G4 | README accurate | Every path it names exists. |
