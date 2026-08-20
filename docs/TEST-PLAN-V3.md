# Test plan v3

Written for the surface as it stands after the MCP server, the ship camera, the settings
menu, and the poker rebrand. Every item states a specific observable result. An item fails on
a console error, a failed network request, or a number that cannot be reconciled against its
source — however good it looks.

## A — Hub (16)

| # | Item | Correct means |
| --- | --- | --- |
| A1 | `/` renders | 200, hero heading, four live stat cells |
| A2 | `/` stats reconcile | Each cell matches its source exactly |
| A3 | `/` ticker | Real keeper events, newest first |
| A4 | `/crewkill` counters | Equal to `/api/stats` exactly |
| A5 | `/poker` | Four numbered deal steps, all four contracts answering |
| A6 | `/contracts` | Six rows, "deployed here 2 / integrated 4" |
| A7 | `/contracts` sizes | All six show real on-chain sizes |
| A8 | `/deployments` | Row per deployment, counts matching the API |
| A9 | `/api-docs` | Nine endpoints, each answering |
| A10 | `/detective-pool` | Worked example matching `detectiveWeight` |
| A11 | `/balance` | Rates equal to `/api/balance` |
| A12 | `/how-privacy-works` | Five lifecycle steps, public/hidden pairs |
| A13 | `/status` | Measured uptime distinct from a live probe |
| A14 | `/press` | Descriptions, live facts, refused claims |
| A15 | `/robots.txt`, `/sitemap.xml`, `/opengraph-image` | Correct types; every sitemap entry 200 |
| A16 | Unknown hub route | 404 with the hub's own copy |

## B — CrewKill chrome (7)

| # | Item | Correct means |
| --- | --- | --- |
| B1 | No hub bar in the game | The molfi strip does not appear above the game |
| B2 | Header is four controls | Phase, clock, wallet, Settings — nothing else |
| B3 | Settings opens | Nine items grouped: look, sound, help, hub link |
| B4 | Substrate applies | Each of four modes applies and persists |
| B5 | Sound default | Off with no stored preference; persists on toggle |
| B6 | Tab title | CrewKill's own, not the hub's |
| B7 | Escape / outside click | Closes the menu |

## C — Ship camera (6)

| # | Item | Correct means |
| --- | --- | --- |
| C1 | Default frame | Whole ship, all rooms visible, no interaction needed |
| C2 | Zoom in | `+` narrows the viewBox about the centre |
| C3 | Zoom out | `−` widens it, floor at fit |
| C4 | Fit | Returns exactly to the default frame |
| C5 | Keyboard | `+`, `−`, `0` work; arrows pan when zoomed |
| C6 | Bounds | Never below 1x, never above 4x |

## D — CrewKill pages (7)

| # | Item | Correct means |
| --- | --- | --- |
| D1 | `/` metrics | Equal to `/api/stats` |
| D2 | `/history` filters | Chip counts match reality; empty chip shows empty state |
| D3 | Archive detail | Ship, rounds, outcome, verify link |
| D4 | `/verify/<settled>` | Checks out, 5 of 5 |
| D5 | Tamper detection | Flipped fields flagged, exactly those checks |
| D6 | Edge cases | Unsettled explained, unknown named, non-numeric rejected pre-request |
| D7 | `/badge`, `/qr` | Correct SVG; invalid input handled |

## E — Keeper API (11)

| # | Item | Correct means |
| --- | --- | --- |
| E1-E11 | All endpoints | 200 with correct shape; 404 unknown; 400 non-numeric; stats equal DB |

## F — MCP server (10)

| # | Item | Correct means |
| --- | --- | --- |
| F1 | Server starts | Advertises name `crewkill`, version 1.0.0 |
| F2 | Tool list | Exactly ten tools |
| F3 | `crewkill_lobby` | Real lobby, matching `/api/lobby` |
| F4 | Acting without a seat | Every play tool errors, does not crash |
| F5 | `crewkill_join` | Real shield + join transactions, seat index from the contract |
| F6 | `crewkill_look` | Only what the seat can see |
| F7 | `crewkill_transcript` | Real events |
| F8 | `crewkill_vote` | Accepted in a voting phase, rejected outside one |
| F9 | Death handled | A killed agent is told, and cannot act |
| F10 | No privileged read | No tool reveals a hidden role |

## G — Poker (7)

| # | Item | Correct means |
| --- | --- | --- |
| G1 | Lobby renders | Create and join panels |
| G2 | Wordmark | Ours, not the reference logo |
| G3 | No false claim | The reference's hackathon submission line is gone |
| G4 | Attribution | Protocol credit to dpinones present |
| G5 | Config guard | Wrong-network config refused with a real message |
| G6 | Wallet gating | Actions disabled until connected |
| G7 | Play a hand | Needs the Garaga verifiers |

## H — Chain (4)

| # | Item | Correct means |
| --- | --- | --- |
| H1 | Six contracts live | `getClassHashAt` succeeds for all six |
| H2 | Both pools live | Sepolia and mainnet |
| H3 | Submission txs | All four SUCCEEDED and ACCEPTED_ON_L1 |
| H4 | Settlement | Settled matches audit clean |

## I — Cross-cutting (6)

| # | Item | Correct means |
| --- | --- | --- |
| I1 | Console clean | Zero errors on every page |
| I2 | Network clean | Zero failed requests |
| I3 | Mobile | No overflow at 380px anywhere |
| I4 | Suites | All four green |
| I5 | Typecheck | All apps and packages |
| I6 | No mocks shipped | Every hit devnet-only or a shim, each named |

---

# Results

64 items. **63 PASS, 1 untested.** No item failed on its own merits; three apparent failures
were faults in how I measured, corrected below.

## The one untested item

**G7 — play a poker hand.** Blocked on the three Garaga verifier contracts, which are 7,700
to 10,900 lines of generated Cairo and have now consumed well over two hours of CPU without
finishing. Everything up to the proof is verified: the contracts deploy, the two-player
harness runs, loads both players and all six artifacts, and reaches the first on-chain proof.

Deploying against `MockVerifier` would let the hand pass without verifying a single proof,
which is the exact green tick this project argues against. It stays untested rather than
being made to look finished.

## Three measurement faults, not code faults

Worth writing down because each one nearly became a false failure.

**"`/api/config` is never requested."** It was. I sliced the last six resource entries, and
a one-shot request had been evicted by pollers firing every few seconds. The page was simply
still loading.

**"Zoom does nothing."** I read the viewBox in the same tick as the click, before React had
re-rendered. With a wait, `+` narrows the frame about its centre and `−` widens it.

**"Fit does not return to the default."** It does. My baseline was already zoomed from the
previous test's clicks, so I was comparing against the wrong number.

## Two environment faults

Another project took port 3100 while CrewKill's dev server was down, so the browser was
briefly testing a manga tool. CrewKill now runs on 3101. The browser pane also hung twice and
needed a fresh tab.

## What was proved this run

The MCP server is a real player, verified in one process each time: it buys a seat with a
real shield and join transaction, sees only its own view, reads the transcript, is refused
when it votes outside a voting phase, is accepted inside one, and when an impostor kills it
in round 2 it is told and every subsequent action is refused. No tool reveals a hidden role,
because no such answer exists to reveal.

## Confirmation

Zero console errors and zero failed network requests on every page tested. Zero mocks or
stubs in any shipped path: every remaining hit is a devnet-only pool driving real signed
transactions, a Cairo test double, a browser shim for a Node logger, or a read-only account
that never signs — each named rather than filtered out.

---

# Re-run results

64 items. **63 PASS, 1 untested.** One genuine failure found and fixed; two apparent failures
were faults in how I measured.

## The genuine failure

**F6 — `crewkill_look` crashed on a seat the keeper had not mirrored yet.** Every MCP tool
reached its seat by array position, `match.seats[seatIndex]`, which quietly assumes the
mirror already holds a row. It does not, for about a second: the seat exists on chain the
moment the join lands, and the indexer catches up a beat later. An agent that looked around
immediately after sitting down got `Cannot read properties of undefined (reading 'alive')`
and no way to tell whether it had a seat at all.

Two things were wrong. Position is not identity — a seat's index is a property of the seat,
not where it sits in a list — so every lookup now finds by index. And a race deserves a
different answer from a missing seat, so the tools now say the mirror is catching up and to
retry. Verified: the message appears immediately after joining, and the same call returns the
seat, room, exits and a sealed role a few seconds later.

## Two measurement faults

**"Poker lost its attribution."** I grepped the served HTML of a Vite SPA, whose shell
contains no content. In the browser the credit to dpinones/mental-poker is present.

**"280px of horizontal overflow."** The browser pane was collapsed, so `clientWidth` was 0
and every element appeared to overflow. At a real 380px viewport the overflow is 0 — the wide
address spans scroll inside their own container, which is the intended pattern.

## Two environment faults

The hub died mid-run and, on restart, served 404 for every route except `/` and `/status`.
The cause was starting the server from a partially written `.next`: the build itself was
clean, listing all 20 routes. Rebuilt to completion first, then started — all 16 routes 200.

The Garaga verifier release builds were killed after 876 minutes of CPU across three
contracts with no artifact produced. A dev-profile build was started instead and has since
consumed 114 minutes, also without finishing.

## The untested item

**G7 — play a poker hand.** Still blocked on those verifiers. Everything up to the proof is
verified. Deploying against `MockVerifier` would let a hand pass without checking a single
proof, so it stays untested rather than being made to look finished.

## Confirmation

Zero console errors and zero failed network requests on every page tested. Zero horizontal
overflow at 380px. Zero mocks or stubs in any shipped path — each remaining hit named above.
