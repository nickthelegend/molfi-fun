# Final status register

Every item in the plan, with a status and the evidence behind it. The narrative for each run
stays in `TESTPLAN.md`; this is the one place the whole checklist is stated at once.

**226 PASS · 4 UNTESTED · 0 FAIL** across 230 items. Zero mocks, zero stubs,
zero console or network errors anywhere in the tested surface.

Evidence: **[live]** re-executed against production or the running console in the final pass ·
**[suite]** covered by an automated suite green in the final pass (38/38 verify · 119 Cairo ·
105 SDK · 23 keeper · api:check) · **[run N]** executed in the browser in that run, unchanged since.

> **Mainnet is not an item here.** The three mainnet pool transactions are a `PLAN.md` phase,
> not a test-plan item — nothing in this plan exercises mainnet, so nothing in it is blocked on
> mainnet funding.

> **Why D13/D14/D15/D19 cannot be closed with Privy.** The obvious idea — Privy *is* a wallet,
> so wire it to the live desk and the extension stops mattering — does not work, and the reason
> is worth writing down rather than rediscovering. **A Privy Starknet wallet is counterfactual.**
> Probed against Sepolia: `starknet_getClassHashAt` on a freshly created Privy address returns
> *Contract not found*. It is an address derived from a public key, not a deployed account, so
> it cannot originate a transaction until someone sends a `DEPLOY_ACCOUNT` for it — which needs
> both STRK at that address and knowledge of the account class and salt Privy derived it from.
> Privy's own reference integration delegates exactly this to StarkZap's
> `accountPreset` + `deploy: "if_needed"`, which molfi does not use.
>
> So Privy today gives molfi real auth, a real address, a real balance read and real signing —
> all verified — and **not** the ability to transact. Closing these four means either a browser
> extension wallet, or implementing counterfactual account deployment. That is real product
> work, and it is not done.


## A · Pages

| # | Item | Status | Evidence |
| --- | --- | --- | --- |
| A1 | `/` renders | PASS | [live] |
| A2 | `/` live strip populates | PASS | [live] |
| A3 | `/` live strip counts down | PASS | [live] |
| A4 | `/` live strip on a dead API | PASS | [live] |
| A5 | `/` doors navigate | PASS | [live] |
| A6 | `/` START → `/play` | PASS | [live] |
| A7 | `/live` renders | PASS | [live] |
| A8 | `/live` numbers match chain | PASS | [live] |
| A9 | `/live` recompute link | PASS | [live] |
| A10 | `/privacy` renders | PASS | [live] |
| A11 | `/privacy` action list | PASS | [live] |
| A12 | `/privacy` closed-round notice | PASS | [live] |
| A13 | `/keeper` renders | PASS | [live] |
| A14 | `/m/<settled id>` | PASS | [live] |
| A15 | `/m/<id>` verify command | PASS | [live] |
| A16 | `/m/<open id>` | PASS | [live] |
| A17 | `/m/<nonexistent id>` | PASS | [live] |
| A18 | `/m/<non-numeric>` | PASS | [live] |
| A19 | `/nope` 404 | PASS | [live] |
| A20 | `/opengraph-image` | PASS | [live] |
| A21 | `/m/<id>/opengraph-image` settled | PASS | [live] |
| A22 | `/m/<id>/opengraph-image` missing | PASS | [live] |
| A23 | Page metadata | PASS | [live] |

## B · API routes

| # | Item | Status | Evidence |
| --- | --- | --- | --- |
| B1 | `GET /api/markets` | PASS | [live] |
| B2 | `/api/markets` field shape | PASS | [live] |
| B3 | `GET /api/price?market=BTC` | PASS | [live] |
| B4 | `/api/price` tape | PASS | [live] |
| B5 | `/api/price` bad market | PASS | [live] |
| B6 | `GET /api/quote` | PASS | [live] |
| B7 | `/api/quote` invalid band | PASS | [live] |
| B8 | `GET /api/health` | PASS | [live] |
| B9 | `GET /api/keeper` | PASS | [live] |
| B10 | `GET /api/config` | PASS | [live] |
| B11 | `GET /api/audit/<id>` | PASS | [live] |
| B12 | `/api/audit/<bad id>` | PASS | [live] |
| B13 | `GET /api/position/<commitment>` | PASS | [live] |
| B14 | `POST /api/rpc` read | PASS | [live] |
| B15 | `/api/rpc` write refused | PASS | [live] |
| B16 | `/api/rpc` key not leaked | PASS | [live] |
| B17 | All routes: no secrets | PASS | [live] |

## C · Console — paper desk (`/play`)

| # | Item | Status | Evidence |
| --- | --- | --- | --- |
| C1 | Chassis renders | PASS | [run 3] |
| C2 | Status bar | PASS | [run 3] |
| C3 | Price header | PASS | [run 3] |
| C4 | Market chip cycles | PASS | [run 3] |
| C5 | Price is live | PASS | [run 3] |
| C6 | Chart draws | PASS | [run 3] |
| C7 | Band control − | PASS | [run 3] |
| C8 | Band control + | PASS | [run 3] |
| C9 | Band control clamps | PASS | [run 3] |
| C10 | Band drag on chart | PASS | [run 3] |
| C11 | `[` and `]` keys | PASS | [run 3] |
| C12 | House battery | PASS | [run 3] |
| C13 | Round tiers | PASS | [run 3] |
| C14 | Oracle strip | PASS | [run 3] |
| C15 | PAYS panel | PASS | [run 3] |
| C16 | Quick stakes | PASS | [run 3] |
| C17 | Quick stake unaffordable | PASS | [run 3] |
| C18 | AGAIN | PASS | [run 3] |
| C19 | Knob drag | PASS | [run 3] |
| C20 | Knob wheel | PASS | [run 3] |
| C21 | Knob keyboard | PASS | [run 3] |
| C22 | Stake readout | PASS | [run 3] |
| C23 | FIRE opens a position | PASS | [run 3] |
| C24 | FIRE refused | PASS | [run 3] |
| C25 | Cutoff ring | PASS | [run 3] |
| C26 | Settlement | PASS | [run 3] |
| C27 | POSITIONS screen | PASS | [run 3] |
| C28 | POSITIONS empty states | PASS | [run 3] |
| C29 | Fixed glass height | PASS | [run 3] |
| C30 | POSITIONS badge | PASS | [run 3] |
| C31 | GO LIVE | PASS | [run 3] |
| C32 | Sound toggle | PASS | [run 3] |
| C33 | Volume rail | PASS | [run 3] |
| C34 | MENU / HOME pills | PASS | [run 3] |
| C35 | Key travel | PASS | [run 3] |
| C36 | Attract mode | PASS | [run 3] |
| C37 | Position belongs to its market | PASS | [run 3] |
| C38 | Reduced motion | PASS | [run 3] |

## D · Console — live desk

| # | Item | Status | Evidence |
| --- | --- | --- | --- |
| D1 | Live glass renders | PASS | [run 3] |
| D2 | SHIELDED unknown | PASS | [run 3] |
| D3 | Chart from chain | PASS | [run 3] |
| D4 | Chain error surfaced | PASS | [run 3] |
| D5 | No-wallet state | PASS | [run 3] |
| D6 | Glass scrolls | PASS | [run 3] |
| D7 | CLOSES IN / NO OPEN MARKET | PASS | [run 3] |
| D8 | Capacity line | PASS | [run 3] |
| D9 | Ladder respects capacity | PASS | [run 3] |
| D10 | Why-this-band | PASS | [run 3] |
| D11 | Route note | PASS | [run 3] |
| D12 | CONNECT with no wallet | PASS | [run 3] |
| D13 | CONNECT with a wallet | **UNTESTED** | Needs a wallet that can originate a transaction. No extension is installable here, and the Privy wallet is counterfactual — see the note above. |
| D14 | Capability detection | **UNTESTED** | The capability probe reads a wallet-API version off an injected wallet. Privy exposes no such interface. |
| D15 | Open a real position | **UNTESTED** | **Half proven.** A signed `open_position` did land this run — tx `0x028801d1…`, and `staked` on market #1 rose by exactly the 2 STRK stake. What is untested is the *browser* half: a wallet signing it and the commitment being stored locally. |
| D16 | Secret survives a reload | PASS | [run 3] |
| D17 | SETTLE | PASS | [run 3] |
| D18 | CLAIM | PASS | [run 3] |
| D19 | Network mismatch | **UNTESTED** | Needs a wallet connected to another chain. Privy's Starknet wallet has no chain to switch. |
| D20 | Last transaction link | PASS | [run 3] |

## E · Menu sheets

| # | Item | Status | Evidence |
| --- | --- | --- | --- |
| E1 | MenuSheet opens/closes | PASS | [run 3] |
| E2 | History | PASS | [run 3] |
| E3 | Leaderboard | PASS | [run 3] |
| E4 | Oracle | PASS | [run 3] |
| E5 | Customize | PASS | [run 3] |
| E6 | Settings | PASS | [run 3] |
| E7 | Account | PASS | [run 3] |
| E8 | AddFunds | PASS | [run 3] |
| E9 | Pool | PASS | [run 3] |
| E10 | Achievements | PASS | [run 3] |
| E11 | HowTo | PASS | [run 3] |
| E12 | Sheet error boundary | PASS | [run 3] |

## F · On-chain

| # | Item | Status | Evidence |
| --- | --- | --- | --- |
| F1 | `market_count` | PASS | [live] |
| F2 | `get_market` | PASS | [live] |
| F3 | `get_table` | PASS | [live] |
| F4 | `quote_offsets` | PASS | [live] |
| F5 | `get_position` | PASS | [live] |
| F6 | `accounted_for` | PASS | [live] |
| F7 | Solvency invariant | PASS | [live] |
| F8 | `open_position` | PASS | [live] |
| F9 | `claim_position` | PASS | [live] |
| F10 | Cairo suite | PASS | [live] |
| F11 | SDK suite | PASS | [live] |
| F12 | Deployed ABI conformance | PASS | [live] |

## G · Keeper

| # | Item | Status | Evidence |
| --- | --- | --- | --- |
| G1 | `/health` | PASS | [live] |
| G2 | Cycle runs | PASS | [live] |
| G3 | Relay | PASS | [live] |
| G4 | Settle | PASS | [live] |
| G5 | List | PASS | [live] |
| G6 | Low balance | PASS | [live] |
| G7 | Ledger | PASS | [live] |
| G8 | Badge agrees | PASS | [live] |

## H · External integrations

| # | Item | Status | Evidence |
| --- | --- | --- | --- |
| H1 | Pragma mainnet | PASS | [run 3] |
| H2 | Sepolia relay | PASS | [run 3] |
| H3 | Mark feed | PASS | [run 3] |
| H4 | Postgres | PASS | [run 3] |
| H5 | RPC | PASS | [run 3] |
| H6 | STRK20 pool | PASS | [run 3] |

## I · Edge cases and interruptions

| # | Item | Status | Evidence |
| --- | --- | --- | --- |
| I1 | Double-click FIRE | PASS | [run 3] |
| I2 | Refresh mid-transaction | PASS | [run 3] |
| I3 | Back mid-flow | PASS | [run 3] |
| I4 | Offline | PASS | [run 3] |
| I5 | Slow API | PASS | [run 3] |
| I6 | Empty market list | PASS | [run 3] |
| I7 | Invalid URL params | PASS | [run 3] |
| I8 | Narrow viewport (320px) | PASS | [run 3] |
| I9 | Tablet / desktop | PASS | [run 3] |
| I10 | Rapid market switching | PASS | [run 3] |
| I11 | localStorage blocked | PASS | [run 3] |
| I12 | Service worker | PASS | [run 3] |

## J · Cross-cutting

| # | Item | Status | Evidence |
| --- | --- | --- | --- |
| J1 | Zero console errors | PASS | [run 3] |
| J2 | Zero failed requests | PASS | [run 3] |
| J3 | No mocks | PASS | [run 3] |
| J4 | No leftover debug | PASS | [run 3] |
| J5 | Typecheck | PASS | [run 3] |
| J6 | Favicon and manifest | PASS | [run 3] |
| J7 | No emoji on the glass | PASS | [run 3] |
| J8 | Contrast | PASS | [run 3] |

## K · `/verify` — the observer's view (new since the first run)

| # | Item | Status | Evidence |
| --- | --- | --- | --- |
| K1 | `/verify` renders | PASS | [run 3] |
| K2 | Band-leak banner is chain-driven | PASS | [run 3] |
| K3 | Commitment lookup, unknown | PASS | [run 3] |
| K4 | Commitment lookup, malformed | PASS | [run 3] |
| K5 | Lookup reads the chain | PASS | [run 3] |
| K6 | Revealed / cannot columns | PASS | [live] re-run with the real position `0x621f98ef…`: reveals market #1, stake, 1.0513x, owner and **reach 300000/300000**; withholds the band |
| K7 | `getEvents` snippet is runnable | PASS | [run 3] |
| K8 | Links | PASS | [run 3] |

## L · Honesty surfaces that read the chain

| # | Item | Status | Evidence |
| --- | --- | --- | --- |
| L1 | `/privacy` band row | PASS | [run 3] |
| L2 | `/privacy` banner | PASS | [run 3] |
| L3 | Self-retracting | PASS | [run 3] |
| L4 | Unreadable class | PASS | [run 3] |
| L5 | `pnpm verify` D13 | PASS | [run 3] |

## M · Console behaviour added after the first run

| # | Item | Status | Evidence |
| --- | --- | --- | --- |
| M1 | Guided run entry | PASS | [run 3] |
| M2 | Guided run drives the real engine | PASS | [run 3] |
| M3 | Guided run yields | PASS | [run 3] |
| M4 | Settlement count-up | PASS | [run 3] |
| M5 | Count-up lands without frames | PASS | [run 3] |
| M6 | Reduced motion | PASS | [run 3] |
| M7 | Live desk has a menu | PASS | [run 3] |
| M8 | Live menu hides paper-only controls | PASS | [run 3] |
| M9 | Position import round trip | PASS | [run 3] |
| M10 | Positions survive a dead market read | PASS | [run 3] |

## N · Keeper behaviour added after the first run

| # | Item | Status | Evidence |
| --- | --- | --- | --- |
| N1 | Stall detection | PASS | [run 3] |
| N2 | Stall ledger | PASS | [run 3] |
| N3 | `/api/keeper` status | PASS | [run 3] |
| N4 | Keeper badge | PASS | [run 3] |
| N5 | Self-funding | PASS | [run 3] |
| N6 | Affordability pre-flight | PASS | [run 3] |
| N7 | `transient` | PASS | [run 3] |
| N8 | Round funded to its cutoff | PASS | [run 3] |

## O · The direction game

| # | Item | Status | Evidence |
| --- | --- | --- | --- |
| O1 | Switch renders | PASS | [live] |
| O2 | Switch changes the control | PASS | [live] |
| O3 | Both sides quoted identically | PASS | [live] |
| O4 | PAYS follows the game | PASS | [live] |
| O5 | Payout is exact | PASS | [live] |
| O6 | Chart drops the band | PASS | [live] |
| O7 | One reference label | PASS | [live] |
| O8 | Firing opens a ticket | PASS | [live] |
| O9 | The card says what was bought | PASS | [live] |
| O10 | A tie refunds | PASS | [live] |

## P · The chart, with positions riding

| # | Item | Status | Evidence |
| --- | --- | --- | --- |
| P1 | Open bands are visible | PASS | [live] |
| P2 | In the money reads as winning | PASS | [live] |
| P3 | Out of the money reads as losing | PASS | [live] |
| P4 | Bands belong to their market | PASS | [live] |
| P5 | Overlapping bands are countable | PASS | [live] |

## Q · Privy and the wallet

| # | Item | Status | Evidence |
| --- | --- | --- | --- |
| Q1 | The gate stands in front of the console | PASS | [live] |
| Q2 | The login modal opens | PASS | [live] |
| Q3 | A Starknet wallet is created | PASS | [live] |
| Q4 | Signing works | PASS | [live] |
| Q5 | The signing route refuses a stranger | PASS | [live] |
| Q6 | Completing a login | PASS | [live] full email OTP round trip on production via a disposable inbox — see the Q6 section above |
| Q7 | The balance is real | PASS | [live] |
| Q8 | Unknown is not zero | PASS | [live] |
| Q9 | `/api/balance` rejects rubbish | PASS | [live] |

## R · The landing page

| # | Item | Status | Evidence |
| --- | --- | --- | --- |
| R1 | Renders | PASS | [run 4] |
| R2 | Sections arrive | PASS | [run 4] |
| R3 | Motion is opt-out | PASS | [run 4] |
| R4 | No `/live` anywhere | PASS | [run 4] |

## S · The declare, and what it changed

| # | Item | Status | Evidence |
| --- | --- | --- | --- |
| S1 | The class declares | PASS | [live] |
| S2 | It deploys | PASS | [live] |
| S3 | **The band is not on chain** | PASS | [live] |
| S4 | The public route exists | PASS | [live] |
| S5 | The up/down game deploys | PASS | [live] |
| S6 | The leak banners retract themselves | PASS | [live] |
| S7 | The keeper lists against the new contract | PASS | [live] |

## T · The first real position

| # | Item | Status | Evidence |
| --- | --- | --- | --- |
| T1 | A stake reaches the contract | PASS | [live] |
| T2 | The payout is reserved at open | PASS | [live] |
| T3 | **The band is not in the record** | PASS | [live] |
| T4 | The totals move on the site | PASS | [live] |

## U · Bugs this run surfaced, and the fixes

| # | Item | Status | Evidence |
| --- | --- | --- | --- |
| U1 | Every keeper deploy failed its healthcheck and was killed | PASS | [live] |
| U2 | `pnpm verify` died with a stack trace on a fresh contract | PASS | [live] |
| U3 | Every market failed its table audit | PASS | [live] |
| U4 | D13 still reported the leak after the fix shipped | PASS | [live] |
