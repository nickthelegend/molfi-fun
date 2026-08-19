# Test plan v2

Written for the surface as it stands after this session's builds, before any of it was run.
Every item states a specific observable result. An item fails on a console error, a failed
network request, or a number that cannot be reconciled against its source, regardless of how
it looks.

## A — Hub pages (14)

| # | Item | Correct means |
| --- | --- | --- |
| A1 | `/` | 200, hero heading, four live stat cells |
| A2 | `/` stats reconcile | Each cell matches its source: games probe, chain read, keeper aggregate, node head |
| A3 | `/` ticker | Real events from the keeper's log, newest first, with relative ages |
| A4 | `/crewkill` | 200, four counters equal to `/api/stats` exactly |
| A5 | `/poker` | 200, four numbered deal steps, "All 4 answering on Sepolia" |
| A6 | `/contracts` | 200, six rows, "Written and deployed here 2 / Integrated dependencies 4" |
| A7 | `/contracts` sizes | All six show external-function and Sierra-instruction counts matching the chain |
| A8 | `/deployments` | 200, one live and one retired row, counts matching `/api/deployments` |
| A9 | `/api-docs` | 200, nine endpoints listed, each one actually answering |
| A10 | `/detective-pool` | 200, worked example whose arithmetic matches `detectiveWeight` |
| A11 | `/balance` | 200, rates equal to `/api/balance`, small-sample warning when under 20 |
| A12 | `/how-privacy-works` | 200, five lifecycle steps each with a public and hidden column |
| A13 | `/status` | 200, measured uptime distinct from a live probe |
| A14 | `/press` | 200, three descriptions, live facts, five refused claims |

## B — Hub generated + failure (6)

| # | Item | Correct means |
| --- | --- | --- |
| B1 | `/robots.txt` | 200, text/plain, names the sitemap |
| B2 | `/sitemap.xml` | 200, XML, every entry resolves 200 |
| B3 | `/opengraph-image` | 200, image/png, exactly 1200x630 |
| B4 | Unknown hub route | 404 with the hub's own copy |
| B5 | Keeper unreachable | Counters read offline, never 0 |
| B6 | Node unreachable | Contracts read unreadable, never "not deployed" |

## C — CrewKill (8)

| # | Item | Correct means |
| --- | --- | --- |
| C1 | `/` | 200, metrics equal to `/api/stats`, CTA present |
| C2 | `/history` | 200, filter chips with counts matching reality |
| C3 | Archive filters | Each chip filters correctly; an empty one shows its empty state |
| C4 | Archive detail | Opening a settled match shows ship, rounds, outcome, and a verify link |
| C5 | Substrate switch | Three modes, each persisting; contrast clears WCAG AA |
| C6 | Sound toggle | Off by default, persists, silent on enabling |
| C7 | Role flip | With a seat held, both faces mount and the card turns |
| C8 | Unknown route | 404 with CrewKill's own copy |

## D — Verifier (12)

| # | Item | Correct means |
| --- | --- | --- |
| D1 | `/verify` | 200, button disabled while empty |
| D2 | `/verify/<settled>` | Auto-loads, checks out, 5 of 5 |
| D3 | Check expansion | Contract value and recomputed value side by side |
| D4 | Tampered data | Flipping fields yields "does not check out" naming exactly those checks |
| D5 | Unsettled match | Explains nothing to check yet |
| D6 | Unknown match | Says no match with that number |
| D7 | Non-numeric input | Rejected before any request |
| D8 | Seed timeline | Real commitment, seat count, final seed, in order |
| D9 | Vote graph | Per-round bars proportional to real tallies, impostors coloured |
| D10 | Said-versus-was | Lines annotated by revealed role; impostor path exercised |
| D11 | Ballot recovery | Real chain-read count, recovered targets, sealed seats explained |
| D12 | Copy-as-markdown | Clipboard receives verdict, all checks, seed, permalink |

## E — CrewKill endpoints (4)

| # | Item | Correct means |
| --- | --- | --- |
| E1 | `/badge/<settled>` | 200, SVG, title states the real verdict |
| E2 | `/badge/<non-numeric>` | 200, SVG reading "invalid" |
| E3 | `/qr/<match>` | 200, SVG encoding that match's verify URL |
| E4 | `/qr/<non-numeric>` | 400, not a broken image |

## F — Keeper API (11)

| # | Item | Correct means |
| --- | --- | --- |
| F1 | `/health` | 200, ok true, real network and block |
| F2 | `/api/config` | 200, addresses matching the active deployment |
| F3 | `/api/matches` | 200, at most 25, newest first |
| F4 | `/api/stats` | 200, totals equal to direct database counts |
| F5 | `/api/matches/:id` | 200 for real, 404 unknown, 400 non-numeric |
| F6 | `/api/matches/:id/disclosure` | 200, real chain reads |
| F7 | `/api/lobby` | 200, lobby or explicit null |
| F8 | `/api/activity` | 200, newest first |
| F9 | `/api/deployments` | 200, live flag correct |
| F10 | `/api/balance` | 200, rates consistent with settled matches |
| F11 | `/api/uptime` | 200, samples accumulating over time |

## G — Chain (4)

| # | Item | Correct means |
| --- | --- | --- |
| G1 | Six contracts | getClassHashAt succeeds for all six |
| G2 | Both pools | Sepolia and mainnet pool addresses answer |
| G3 | Submission transactions | All four SUCCEEDED and ACCEPTED_ON_L1 |
| G4 | Settlement | Settled matches audit clean independently |

## H — Poker (7)

| # | Item | Correct means |
| --- | --- | --- |
| H1 | Lobby | 200, create and join panels |
| H2 | Wallet gating | CONNECT visible, actions disabled until connected |
| H3 | Join validation | Digits only |
| H4 | Contracts | All four answer on Sepolia |
| H5 | No stray polling | Zero requests to dead URLs over 13s |
| H6 | Create a table | Requires a funded wallet |
| H7 | Play a hand | Requires two funded wallets |

## I — Cross-cutting (5)

| # | Item | Correct means |
| --- | --- | --- |
| I1 | Console clean | Zero console errors on every page tested |
| I2 | Network clean | Zero failed requests on every page tested |
| I3 | Mobile | No horizontal overflow at 380px on any page |
| I4 | Suites | Cairo, protocol, keeper, poker all green |
| I5 | No mocks shipped | Every mock hit devnet-only or a bundling shim, each named |

---

# Results

71 items. **69 PASS, 2 untested** (both need a funded wallet that does not exist here). One
item failed on the first run and was fixed; the whole plan was then re-run top to bottom.

## The failure, and the fix

**I3 — every hub page scrolled sideways 38px at 380px.** My own regression: adding
"Deployments" to the nav made the header row 418px against a 380px viewport, and because the
header is shared it broke all fourteen pages at once. The nav wraps now. A second line on a
phone is ordinary; a horizontally scrolling page is not. Re-measured across all fourteen:
zero.

## Two environment faults, neither a code defect

**A stale `.next` chunk** returned 500 on `/crewkill` while every other route served — the
dev server's incremental build had gone out of sync with the source.

**`EMFILE: too many open files`** then broke the hub entirely: with four dev servers and
several containers competing, macOS ran out of per-process file watches, so Next compiled
each route successfully and still fell through to `_not-found` because Watchpack could not
build a route manifest. Raising `ulimit -n` was the wrong instinct — the soft limit was
already a million. The hub now runs from a production build, which watches nothing and is
closer to what a judge would actually load.

## Untested, and honestly so

| # | Item | Why |
| --- | --- | --- |
| H6 | Create a poker table | Needs a funded Sepolia wallet signing through Cartridge |
| H7 | Play a poker hand | Needs two funded Sepolia wallets |

Everything up to the signature is verified for both: the controls exist, they are correctly
gated, and they point at contracts confirmed live on chain. Neither is marked PASS.

## Confirmation

Zero console errors and zero failed network requests on every page tested. Zero horizontal
overflow at 380px across all eighteen pages. Zero mocks or stubs in any shipped path: every
remaining hit is a devnet-only pool driving real signed transactions, a Cairo test double, a
browser shim for a Node logger, or a read-only account that never signs — each named in the
sweep rather than filtered out.
