# Full test plan

Every surface, every endpoint, every flow, with an explicit definition of correct. Written
before any of it was run, so the plan is the standard rather than a description of whatever
happened to occur.

"Correct" below always means a specific observable result. An item that produces a console
error, a failed network request, or a number that cannot be reconciled against its source
fails, regardless of how it looks.

## A — molfi.fun (hub), pages

| # | Item | Correct means |
| --- | --- | --- |
| A1 | `/` renders | 200, `<h1>` reads "Games where the privacy is the mechanic", four stat cells present |
| A2 | `/` proof strip is live | Each of the four cells reconciles against its source: games probe, chain read, keeper aggregate, node head |
| A3 | `/` block height moves | Two loads at least 20s apart return different Sepolia block numbers |
| A4 | `/crewkill` renders | 200, four counters, and each equals the keeper's `/api/stats` exactly |
| A5 | `/poker` renders | 200, four numbered deal steps, "All 4 answering on Sepolia" |
| A6 | `/contracts` renders | 200, six rows, "Written and deployed here 2", "Integrated dependencies 4" |
| A7 | `/contracts` class hashes are real | Each displayed hash equals `starknet_getClassHashAt` for that address |
| A8 | `/contracts` provenance labels | The two CrewKill rows say "ours"; the four poker rows say "integrated" and name the source repo |
| A9 | `/privacy` renders | 200, non-empty prose |
| A10 | `/terms` renders | 200, non-empty prose |
| A11 | `/robots.txt` | 200, `text/plain`, contains sitemap URL |
| A12 | `/sitemap.xml` | 200, XML, six `<url>` entries matching real routes |
| A13 | `/opengraph-image` | 200, `image/png`, exactly 1200x630 |
| A14 | Unknown hub route | 404 status **and** the hub's own 404 copy, not a framework default |
| A15 | Copy button works | Clicking copies the **full** address, not the truncated display form |
| A16 | Nav is consistent | Header and footer identical across all hub pages; every link resolves |

## B — molfi.fun, failure behaviour

| # | Item | Correct means |
| --- | --- | --- |
| B1 | Keeper unreachable | Counters read "offline", never `0`; page still renders |
| B2 | Node unreachable | Block cell reads "offline"; contract rows read "unreadable", never "not deployed" |
| B3 | Game front end down | That game's dot reads "not responding"; the other is unaffected |

## C — CrewKill, pages

| # | Item | Correct means |
| --- | --- | --- |
| C1 | `/` renders | 200, logo, four metrics, a call to action |
| C2 | `/` counters are totals | "Settled" and "Seats played" equal `/api/stats`, not the 25-row page |
| C3 | `/` empty lobby | With zero seats filled, says nothing starts until somebody joins; does not auto-start |
| C4 | `/history` renders | 200, lists settled matches, each openable |
| C5 | `/history` detail | Opening a match shows ship, rounds, outcome, impostors, per-seat rows |
| C6 | `/history` ballot disclosure | Recovers real ballots by recomputing receipts against the contract |
| C7 | Unknown CrewKill route | 404 status and CrewKill's own copy |
| C8 | Ship map renders | An SVG with rooms, straight corridors, no cross paths, fixed view |

## D — CrewKill verifier (the permissionless audit)

| # | Item | Correct means |
| --- | --- | --- |
| D1 | `/verify` renders | 200, input, disabled button while empty |
| D2 | `/verify/<settled id>` | Auto-loads, "checks out", 5 of 5 agreeing |
| D3 | Each check expands | Shows the contract's value and the recomputed value side by side, plus why it matters |
| D4 | Tampered data is caught | Altering `crewWon`/`impostorCount` in flight yields "does not check out" and flags exactly those checks |
| D5 | Unsettled match | Says there is nothing to check yet and explains why; does not error |
| D6 | Non-existent match | Says no match with that number on this deployment; does not error |
| D7 | Non-numeric input | Rejected before any request is made; button stays disabled |
| D8 | Keeper unreachable | Reports the failure reason, distinct from "match not found" |
| D9 | Permalink is shareable | `/verify/604` loads the result with no prior state |
| D10 | Reachable from the product | Archive links to it per settled match; hub links to it |

## E — Keeper API

| # | Item | Correct means |
| --- | --- | --- |
| E1 | `GET /health` | 200, `{ok:true}`, real network name and a block number |
| E2 | `GET /api/config` | 200, contract addresses matching the active deployment |
| E3 | `GET /api/matches` | 200, array, at most 25, newest first |
| E4 | `GET /api/stats` | 200, totals equal to direct database counts |
| E5 | `GET /api/matches/:id` | 200, full match view for a real id |
| E6 | `GET /api/matches/:id` unknown | 404, not a 500 and not an empty 200 |
| E7 | `GET /api/matches/:id` non-numeric | 4xx, not a 500 |
| E8 | `GET /api/matches/:id/disclosure` | 200, ballots recovered by real on-chain reads |
| E9 | `GET /api/lobby` | 200, either a lobby or an explicit null |
| E10 | Network scoping | Only the active deployment's matches are ever served |

## F — On-chain

| # | Item | Correct means |
| --- | --- | --- |
| F1 | Six contracts live | `getClassHashAt` succeeds for all six on Sepolia |
| F2 | Both STRK20 pools live | Sepolia and mainnet pool addresses both answer |
| F3 | Submission transactions | All four in `strk20.json` are SUCCEEDED and ACCEPTED_ON_L1 |
| F4 | Real signed transactions | The database holds thousands, with kinds covering the full match lifecycle |
| F5 | Settlement is real | Settled matches audit clean against an independent recomputation |

## G — Poker

| # | Item | Correct means |
| --- | --- | --- |
| G1 | Lobby renders | 200, create and join panels |
| G2 | Table options | Player count and buy-in selectable |
| G3 | Wallet gating | Create/Join disabled until a wallet connects; CONNECT visible |
| G4 | Join input validation | Digits only; non-numeric rejected |
| G5 | Contracts live | All four poker contracts answer on Sepolia |
| G6 | No stray polling | Zero requests to dead URLs over a 13s window |
| G7 | Card rank encoding | Client display agrees with the SDK for all 52 values |
| G8 | Create a table | Requires a funded wallet |
| G9 | Play a hand | Requires two funded wallets |

## H — Cross-cutting

| # | Item | Correct means |
| --- | --- | --- |
| H1 | Console clean | Zero console errors on every page tested |
| H2 | Network clean | Zero failed requests on every page tested |
| H3 | Mobile viewport | No horizontal overflow at 380px on any page |
| H4 | Test suites | Cairo, protocol, keeper, poker all green |
| H5 | Typecheck | All three apps typecheck clean |
| H6 | No mocks in shipped paths | Every mock hit is devnet-only or a bundling shim, and named |

---

# Results

67 items. **65 PASS, 2 untested** (both need a credential that does not exist here). Two
items failed on the first run and were fixed; both were re-run from the start afterwards,
then the whole plan was run again top to bottom.

## The two failures, and the fixes

**B2/A2 — the hub reported a node outage as six undeployed contracts.** With the Starknet
node unreachable the proof strip printed "0 of 6 contracts live on Sepolia". That is a
different and much worse claim than the truth, which is that nobody could ask. The contracts
page already separated "unreadable" from "not deployed"; the home page did not, so the two
pages disagreed about the same event. Now reads "unreadable / contract status", worded
distinctly from the block cell so the two do not read as one repeated message. The games
cell deliberately keeps its zero: a probe that fails is a real answer about that game.

**H3 — the archive overflowed 56px at 380px.** A regression from adding the "Verify a match"
link: four controls on a row that could not wrap. It wraps now.

## What was verified by playing, not by reading

The map, the seat purchase and settlement were tested by playing a real match rather than
inspecting code. Connected the devnet key, bought seat #0 with real signed transactions,
watched the house agents fill the table, match 624 start, the ship render with straight
orthogonal corridors and a fixed frame, and the match settle as a crew win over 4 rounds.

Match 624 then audits 5 of 5 against an independent recomputation, and its ballots come back
through 107 real contract reads. The counters moved with it, 604 settled to 605, and the hub
and the keeper still reconcile exactly.

## Untested, and honestly so

| # | Item | Why |
| --- | --- | --- |
| G8 | Create a poker table | Needs a funded Sepolia wallet signing through Cartridge |
| G9 | Play a poker hand | Needs two funded Sepolia wallets |

Everything up to the signature is verified for both: the controls exist, they are correctly
gated, and they point at contracts confirmed live on chain. Neither is marked PASS.

## Confirmation

Zero console errors and zero failed network requests on every page tested. Zero mocks or
stubs in any shipped path: every remaining hit is a devnet-only pool driving real signed
transactions on a real chain, a Cairo test double, a browser shim for a Node logger, or a
read-only account that never signs. Each is named in the sweep rather than filtered out.
