# molfi — test plan

Every component and every distinct flow, with what "correct" means stated before anything is
run. This file is the checklist; a result that is close, mostly-working, or merely
error-free is not a pass.

**Method.** Executed against the deployed app at `https://molfi.fun` in a real browser, one
item at a time, reading the console and the network log on every item — not only the ones
that look wrong. A console error or a failed request anywhere in an item fails that item.

**Environment.** Starknet Sepolia · market
`0x03b00e6e0efd3d35aeb6885ccb5e21a32f5f68a54222094196a7264da158b068` · relay
`0x0275a7fdecdb539060b1e7cb2c857f88d505ed0a6c0ea2aafbbcc383456dfcbb` · keeper
`0x788e67ade3c9e65e04c391518e9de7036a548e9733193d7d6a63ab85f0e9e8f`.

**Known external constraint.** The keeper account holds 0.08 STRK. Items that require a
*new* on-chain write (opening a position, listing a round, relaying a print) cannot be
executed until it is funded, and are marked UNTESTABLE with the reason rather than passed.
Every read path, every UI path and every already-settled market is fully testable now.

---

## A · Pages

| # | Item | Correct means |
| --- | --- | --- |
| A1 | `/` renders | 200; wordmark, 3D console, headline, START, demo link, three doors, live strip. No console error. |
| A2 | `/` live strip populates | Within 15s replaces `READING SEPOLIA…` with `<n> ROUNDS`, a last-settlement age, and either a ticking `CLOSES m:ss` or `NEXT ROUND PENDING`. `n` equals `/api/markets`'s `count`. |
| A3 | `/` live strip counts down | The `CLOSES` value decreases by ~1 per second between polls, and is derived from `chainNow`, not the browser clock. |
| A4 | `/` live strip on a dead API | With `/api/markets` failing, prints the route-named error in caps, not a blank or a fake number. |
| A5 | `/` doors navigate | Live → `/live`, Private → `/privacy`, Who runs it → `/keeper`, all 200. |
| A6 | `/` START → `/play` | Navigates to the console. |
| A7 | `/live` renders | 200; the last settled price as the masthead with its publisher count and print age, then any open rounds with a ticking cutoff, then every result newest-first. No operator fields anywhere on the page — no staked, bankroll, reserved, paid or raw cutoff timestamp. |
| A8 | `/live` numbers match chain | Every settled price on the page equals `get_market`'s `settled_price` for that id read directly from a public node. |
| A9 | `/live` recompute link | Each result links to `/m/<id>` and that page 200s; the masthead's CHECK THIS PRICE points at the market whose price it shows. |
| A10 | `/privacy` renders | 200; the two routes, the HIDDEN / PUBLIC, AND IT HAS TO BE / WHAT AN OBSERVER COULD STILL INFER groups, and live totals read from the chain. |
| A11 | `/privacy` action list | Renders the real `openActions` array for a real market id, with a withdraw leg and an invoke leg, a placeholder secret marked as one, and a stake the market could cover. |
| A12 | `/privacy` closed-round notice | When the subject market's window has closed, says so explicitly rather than implying it is live. |
| A13 | `/keeper` renders | 200; keeper address, cycle count, balance, ledger totals, last actions. |
| A14 | `/m/<settled id>` | 200; pair, settled price, publishers, print age, every audit check with chain value and recomputed value. |
| A15 | `/m/<id>` verify command | A copyable curl; running it verbatim returns the same settled price the page shows. |
| A16 | `/m/<open id>` | 200; price checks marked NOT RUN rather than failed or passed. |
| A17 | `/m/<nonexistent id>` | 200 with "No market #id", not a crash and not a zeroed-out market. |
| A18 | `/m/<non-numeric>` | Same "no market" page, no unhandled error. |
| A19 | `/nope` 404 | HTTP 404, styled in the console's language, four working doors. |
| A20 | `/opengraph-image` | 200 image/png, 1200×630, the band mark, no cream. |
| A21 | `/m/<id>/opengraph-image` settled | 200 png; pair, settled price, publishers, print age and verdict all equal what `/m/<id>` shows. |
| A22 | `/m/<id>/opengraph-image` missing | 200 png reading NO SUCH MARKET, never accusing a nonexistent market of failing checks. |
| A23 | Page metadata | Every page has a distinct `<title>`; `/` and `/m/<id>` have OG tags pointing at their image. |

## B · API routes

| # | Item | Correct means |
| --- | --- | --- |
| B1 | `GET /api/markets` | 200 JSON `{markets[], count, chainNow}`; newest first; ≤60 items; `count` is the true total; `chainNow` within 60s of the chain head. |
| B2 | `/api/markets` field shape | Every market carries id, pair, cutoffAt, roundSeconds, sigma1e4, houseEdgeBps, settledPrice, settledAt, settledBlockAt, settledSources, isSettled, staked, paid, bankroll, reserved, token. |
| B3 | `GET /api/price?market=BTC` | 200; a real mark with its source named, plus the relay's oracle state with `quotable` and a refusal string when not quotable. |
| B4 | `/api/price` tape | `&history=1` returns `returns[]` — real one-minute log returns from the named exchange — long enough for the desk to replay (≥ 8), with `returnsInterval` stated. |
| B5 | `/api/price` bad market | An unknown market key returns a 4xx with a readable reason, not a 500 and not a silent default. |
| B6 | `GET /api/quote` | Returns the same multiplier for a band as the contract's `quote_offsets` for the same reach. |
| B7 | `/api/quote` invalid band | Answers 200 with `ok:false`, a machine-readable `refusal` and a detail naming both numbers — and **no** `multiplierBps`, so a careless caller cannot read a price off a refused band. |
| B8 | `GET /api/health` | 200; per-pair `settleable` (900s) and `quotable` (600s) flags that agree with the relay's actual print age. |
| B9 | `GET /api/keeper` | 200; when configured, reachable/cycles/balance/stoppedListing; when not configured, `{configured:false}` with a reason. |
| B10 | `GET /api/config` | 200; network, addresses, and nothing secret — no private key, no API key, no full RPC URL with credentials. |
| B11 | `GET /api/audit/<id>` | 200; the same checks and verdicts `/m/<id>` renders. |
| B12 | `/api/audit/<bad id>` | 4xx or an explicit not-found, never a zeroed market audited as failing. |
| B13 | `GET /api/position/<commitment>` | 200 for a real commitment with its market; a clear not-found for an unknown one. |
| B14 | `POST /api/rpc` read | Forwards a read method and returns the node's result. |
| B15 | `/api/rpc` write refused | A write method (`starknet_addInvokeTransaction`) is refused, so the browser-facing proxy cannot be used to send transactions. |
| B16 | `/api/rpc` key not leaked | No response and no error body contains the upstream API key. |
| B17 | All routes: no secrets | No route response contains `KEEPER_PRIVATE_KEY`, an Alchemy key, or a database URL. |

## C · Console — paper desk (`/play`)

| # | Item | Correct means |
| --- | --- | --- |
| C1 | Chassis renders | Graphite body, bezel, black glass, radii nesting; no cream anywhere. |
| C2 | Status bar | Left: network/desk name with a lit LED when the desk has a price. Right: the true count of open positions with an LED lit only above zero. |
| C3 | Price header | Market chip (coin disc + symbol + ▾), price at 34px tabular, AVAILABLE with the real balance. |
| C4 | Market chip cycles | Tapping moves BTC → ETH → STRK → BTC; the price, decimals and coin tone all change with it; STRK is purple, not orange; STRK shows 5 decimals. |
| C5 | Price is live | The price changes over time and matches `/api/price` for the selected market. |
| C6 | Chart draws | A green walk from the left, the now-dot, and an amber dashed band box projecting right. Never a flat slab on first paint. |
| C7 | Band control − | Tightens the band; the fill shrinks; the reach label decreases; the multiplier rises. |
| C8 | Band control + | Widens it; fill grows; reach rises; multiplier falls. |
| C9 | Band control clamps | At the tightest and widest sellable band the keys stop rather than producing a band the market would refuse. |
| C10 | Band drag on chart | Dragging an edge moves that edge only and re-prices. |
| C11 | `[` and `]` keys | Same as − and +. |
| C12 | House battery | Ten cells against the 80% cap, lit in proportion to real utilisation, colour changing past 75% and at the cap. |
| C13 | Round tiers | 15m / 1h / 4h switch the round; the selected one is amber; sigma and the multiplier change accordingly. |
| C14 | Oracle strip | A readout, not a button. `PRAGMA <VERDICT>` with source count, age and drift, all matching `/api/price`'s oracle block. |
| C15 | PAYS panel | Stake → payout, the multiplier at 38px, and the payout equals `payoutFor(stake, multiplier)`. |
| C16 | Quick stakes | $1 / $2.50 / $5 / $10 each set that exact stake and are never all disabled at a healthy balance. |
| C17 | Quick stake unaffordable | A stake above the balance is disabled with a reason in its title, not silently clamped. |
| C18 | AGAIN | Disabled until a band has been accepted; then restores that exact shape, clamped into the current window. |
| C19 | Knob drag | Dragging up steps the stake up, down steps it down, the ribs move with the pointer, and the detent tracks the step. |
| C20 | Knob wheel | Scrolling steps the stake. |
| C21 | Knob keyboard | Arrow keys step it; the control is focusable and announces its value. |
| C22 | Stake readout | Shows the current stake and the detents either side; `—` at the ends rather than a wrong number. |
| C23 | FIRE opens a position | The position appears, the balance falls by the stake, the status bar count rises, and a card exists on the POSITIONS screen. |
| C24 | FIRE refused | An illegal band shakes the glass and prints the specific reason (BAND TOO WIDE / TOO TIGHT / NO FUNDS / HOUSE FULL), never a generic failure. |
| C25 | Cutoff ring | Appears when a position is open, drains anticlockwise, turns red under 20%, shows `+N` for more than one. |
| C26 | Settlement | At the cutoff the position settles, a win or loss amount pops on the chart, the balance moves by exactly that amount, and the position moves to the settled tape. |
| C27 | POSITIONS screen | Open cards with symbol, band at that market's decimals, stake · multiplier, and a countdown; settled tape below; session P&L summing settled positions only. |
| C28 | POSITIONS empty states | `NOTHING RIDING · FIRE A BAND` and `NO TAPE YET`, centred in the region they occupy. |
| C29 | Fixed glass height | The glass is exactly the same height on the range screen, the positions screen, and after firing. |
| C30 | POSITIONS badge | Shows the open count, and is absent at zero rather than showing `0`. |
| C31 | GO LIVE | Present and switches to the live desk. |
| C32 | Sound toggle | `♪` mutes and unmutes; muted prints `MUTE`; unmuting plays one confirmation click. |
| C33 | Volume rail | Dragging changes the level, the printed number, the fill width and the thumb position together; the thumb is not visible at zero; the level audibly scales the voices. |
| C34 | MENU / HOME pills | MENU opens the sheet; HOME navigates to `/`. |
| C35 | Key travel | Every raised key travels down 2px on press and the coloured keys' ledges collapse. |
| C36 | Attract mode | After idle it fires real paper rounds through the same engine, blinks ATTRACT in the status bar, and stops on the first interaction. |
| C37 | Position belongs to its market | Switching market with a position open settles that position against its own market's price and formats it at its own decimals. |
| C38 | Reduced motion | With `prefers-reduced-motion`, animations shorten rather than disappear; shake and roll do not play. |

## D · Console — live desk

| # | Item | Correct means |
| --- | --- | --- |
| D1 | Live glass renders | Status bar says STARKNET SEPOLIA with a lit LED when the chain is readable; price is the relay/mark for the selected pair. |
| D2 | SHIELDED unknown | With no wallet the shielded balance prints `—`, never `0.000 STRK`. |
| D3 | Chart from chain | Draws only from real reads; before the first read it says it is reading, not a fake trace. |
| D4 | Chain error surfaced | A failing read prints the reason over the chart rather than leaving a stale trace looking live. |
| D5 | No-wallet state | A persistent block naming the situation, two real wallet links, and a DEMO DESK key back. |
| D6 | Glass scrolls | With the no-wallet block present the glass stays the same fixed height and the region under the price scrolls. |
| D7 | CLOSES IN / NO OPEN MARKET | States which, from the chain clock. |
| D8 | Capacity line | When the market cannot cover the whole rail, prints what it can cover; the value equals `maxStakeFor` for the quoted multiplier. |
| D9 | Ladder respects capacity | No offered stake exceeds the printed capacity; when nothing fits, FIRE refuses with a readable reason instead of letting the chain revert. |
| D10 | Why-this-band | Prints the reach in sigmas, the calibrated hit rate and the edge, and the three agree with the displayed multiplier. |
| D11 | Route note | Names the route actually in use and what it hides; never claims size is hidden on a direct trade. |
| D12 | CONNECT with no wallet | Says no Starknet wallet was found, in words, and does not leave a developer string on screen. |
| D13 | CONNECT with a wallet | Opens the wallet, and on approval shows the short address; on rejection prints `cancelled — nothing was sent`. |
| D14 | Capability detection | The privacy route is offered only when the wallet advertises wallet API ≥ 0.10.3; `strk20Balances` is never probed. |
| D15 | Open a real position | A signed transaction lands, the commitment is stored locally, the position appears, and `staked` on that market rises by the stake. |
| D16 | Secret survives a reload | Reloading mid-transaction does not destroy the secret; the position reappears if it opened. |
| D17 | SETTLE | Any expired market can be settled by anyone; the key appears only when one is due and reports the hash. |
| D18 | CLAIM | A winning position claims and pays the multiplier exactly. |
| D19 | Network mismatch | A wallet on another chain is refused with a message naming both chains. |
| D20 | Last transaction link | The hash links to the block explorer for the active network. |

## E · Menu sheets

| # | Item | Correct means |
| --- | --- | --- |
| E1 | MenuSheet opens/closes | Slides up, scrim, closes on the scrim and on Escape. |
| E2 | History | Lists real settled positions from this session, none invented. |
| E3 | Leaderboard | Real data or an honest empty state; never fabricated names. |
| E4 | Oracle | The relay's real state, matching `/api/health`. |
| E5 | Customize | Four graphite cabinets; selecting one repaints the body and persists across a reload; no cream. |
| E6 | Settings | Every switch changes behaviour; reduced-motion and sound take effect immediately. |
| E7 | Account | Real wallet state; no fake address. |
| E8 | AddFunds | Real paper top-up on the demo desk; on live, honest about what it can and cannot do. |
| E9 | Pool | Shield / withdraw / positions against the real pool address. |
| E10 | Achievements | Derived from real session history. |
| E11 | HowTo | Opens and closes; explains the round actually selected. |
| E12 | Sheet error boundary | A throwing view shows a contained error, not a white screen. |

## F · On-chain

| # | Item | Correct means |
| --- | --- | --- |
| F1 | `market_count` | Matches `/api/markets`'s `count`. |
| F2 | `get_market` | Round-trips through `decodeMarket` with every field matching the raw felts. |
| F3 | `get_table` | Returns the pricing table; `/api/quote` and the contract agree on the multiplier it produces. |
| F4 | `quote_offsets` | The same reach gives the same multiplier as the TS kernel, to the basis point. |
| F12 | Deployed ABI conformance | Every call the shipped app builds exists on the **deployed** class with exactly that signature — felt count and widths — and any route the deployed contract lacks is not offered in the UI. |
| F5 | `get_position` | An unknown commitment returns an empty position rather than reverting. |
| F6 | `accounted_for` | Never less than staked + bankroll − paid for the settlement token. |
| F7 | Solvency invariant | For every market, `paid + reserved <= staked + bankroll`. |
| F8 | `open_position` | Rejects a stake the market cannot cover, with `MARKET_CANNOT_COVER_PAYOUT`. |
| F9 | `claim_position` | Rejects a band that does not match the commitment. |
| F10 | Cairo suite | `snforge test` passes in full. |
| F11 | SDK suite | `pnpm test` passes in full. |

## G · Keeper

| # | Item | Correct means |
| --- | --- | --- |
| G1 | `/health` | Returns its state; `ok` false when it cannot act. |
| G2 | Cycle runs | `cycles` increases and `lastCycleAt` stays within a few cycle periods of now. |
| G3 | Relay | Republishes only when the held print is older than the threshold, and batches pairs, falling back to one at a time. |
| G4 | Settle | Settles every market past its cutoff once a fresh print exists; `STALE_PRICE` is a wait, not a logged failure. |
| G5 | List | Lists and funds a round in one transaction, falling back per pair. |
| G6 | Low balance | Stops listing before it can strand an unfunded market and says so in its status. |
| G7 | Ledger | Every action is written to Postgres and survives a restart. |
| G8 | Badge agrees | The site's keeper badge state matches `/api/keeper`. |

## H · External integrations

| # | Item | Correct means |
| --- | --- | --- |
| H1 | Pragma mainnet | Read directly; a print mainnet would refuse is never relayed. |
| H2 | Sepolia relay | The contract the desk quotes and settles against; its age drives every freshness verdict. |
| H3 | Mark feed | A real exchange mark, named on screen. |
| H4 | Postgres | Real persisted ledger; counts increase and survive a redeploy. |
| H5 | RPC | Real node; the browser never holds a credential. |
| H6 | STRK20 pool | Real deployed pool address; the action list matches its ABI. |

## I · Edge cases and interruptions

| # | Item | Correct means |
| --- | --- | --- |
| I1 | Double-click FIRE | Paper desk: each press opens a position, because stacking is the advertised product ("top up as often as you like") and no money is at stake. Live desk: FIRE is disabled while a transaction is pending and sends are queued, so two presses cannot collide on a nonce or spend twice from one intent. |
| I2 | Refresh mid-transaction | Nothing is lost that cannot be recovered; a secret is retained unless the send provably failed. |
| I3 | Back mid-flow | Browser back from any page lands somewhere valid with no error. |
| I4 | Offline | Going offline shows the offline banner and the desk says it cannot read, rather than showing stale data as live. |
| I5 | Slow API | A hung request errors with the route named within its deadline. |
| I6 | Empty market list | With no markets the pages say so rather than rendering an empty frame. |
| I7 | Invalid URL params | `/play?market=NOPE&lowBps=x` does not break the console. |
| I8 | Narrow viewport (320px) | No horizontal page scroll; every control reachable. |
| I9 | Tablet / desktop | Layout stays centred and legible; no stretched device. |
| I10 | Rapid market switching | Switching markets quickly never leaves a price from the wrong market on screen. |
| I11 | localStorage blocked | With site data blocked the app still renders and does not throw. |
| I12 | Service worker | No stale service worker serves an old build. |

## J · Cross-cutting

| # | Item | Correct means |
| --- | --- | --- |
| J1 | Zero console errors | No error or unhandled rejection on any page in the tested surface. |
| J2 | Zero failed requests | No 4xx/5xx in the network log on any page, except the ones deliberately provoked. |
| J3 | No mocks | No mock, stub, fixture or fallback datum stands in for real data anywhere in the shipped app. |
| J4 | No leftover debug | No `console.log`, `console.debug`, `debugger` or `data-debug` **in the browser bundle or the SDK**, and no TODO/FIXME/HACK anywhere in shipped source. The keeper's `console.log` calls are excluded deliberately: a server's stdout is its operator interface, not debug residue — those lines are what diagnosed production all session. |
| J5 | Typecheck | All three packages typecheck clean. |
| J6 | Favicon and manifest | Both resolve; the icon is the band mark. |
| J7 | No emoji on the glass | The device surface carries none. |
| J8 | Contrast | Glass text is the two permitted greys, nothing dimmer. |


## K · `/verify` — the observer's view (new since the first run)

| # | Item | Correct means |
| --- | --- | --- |
| K1 | `/verify` renders | 200; headline, the contract address, the observer panel, the `getEvents` snippet, three doors. |
| K2 | Band-leak banner is chain-driven | The red "the band is one of the things revealed" box is drawn from the **deployed class's ABI**, not a constant — present exactly when the deployed `Position` has `band_low`. |
| K3 | Commitment lookup, unknown | A well-formed commitment that was never opened answers "No position on this contract carries that commitment" — a real answer, not an error state. |
| K4 | Commitment lookup, malformed | A non-felt input fails with the route's named error, not an unhandled throw. |
| K5 | Lookup reads the chain | The request goes to `/api/position/<commitment>` and returns 200; nothing is computed from local storage. |
| K6 | Revealed / cannot columns | With a real position, the left column lists market, stake, multiplier, claimed, and (on this class) the band in red; the right column omits any claim the deployed class does not honour. |
| K7 | `getEvents` snippet is runnable | The printed curl is valid JSON-RPC against the configured node and returns events or an empty set. |
| K8 | Links | `/privacy`, `/live`, `/play` doors all 200. |

## L · Honesty surfaces that read the chain

| # | Item | Correct means |
| --- | --- | --- |
| L1 | `/privacy` band row | States the **deployed** behaviour. While the deployed class stores the band, the row says so and the "Hidden" claim is not asserted. |
| L2 | `/privacy` banner | Red box present, drawn from the ABI read at render, linking to `/verify`. |
| L3 | Self-retracting | Both L1 and L2 are computed from `bandIsOnChain(address)`; neither is hardcoded, so a class without the band removes them with no code change. |
| L4 | Unreadable class | If the ABI cannot be read, the claim is reported as *unverified*, never as confirmed. |
| L5 | `pnpm verify` D13 | Fails while the deployed class stores the band, with the member names in the detail. |

## M · Console behaviour added after the first run

| # | Item | Correct means |
| --- | --- | --- |
| M1 | Guided run entry | MENU → "Show me how it works, narrated" starts it. |
| M2 | Guided run drives the real engine | Six captioned steps in order; the balance falls by a real stake and a real position opens. Not a recording. |
| M3 | Guided run yields | Any pointer or key input ends it immediately. |
| M4 | Settlement count-up | The settled amount eases to its exact value; integer-scaled, no drift from the paid amount. |
| M5 | Count-up lands without frames | With `requestAnimationFrame` never firing, the final value is still displayed — never `$0.00`. |
| M6 | Reduced motion | With the preference on, the amount renders immediately rather than animating. |
| M7 | Live desk has a menu | A MENU key exists on the live desk and opens the sheet with the pool view reachable. |
| M8 | Live menu hides paper-only controls | No paper balance figure and no RESET DEMO DESK on the live desk. |
| M9 | Position import round trip | A file whose commitment does not match its secret is refused by name; a valid one is accepted with the commitment recomputed, listed, and exportable. |
| M10 | Positions survive a dead market read | With `/api/markets` failing, stored positions still list (degraded to "not found on chain"), never disappear. |

## N · Keeper behaviour added after the first run

| # | Item | Correct means |
| --- | --- | --- |
| N1 | Stall detection | `/health` returns 503 once two consecutive cycles cannot list, with an `unhealthy` string naming which half failed. |
| N2 | Stall ledger | Exactly one `stall` row per transition into or out of not-listing — never one per cycle. |
| N3 | `/api/keeper` status | Answers **200** whenever the keeper answered, with the verdict in `ok`/`unhealthy`. It must not mirror the keeper's 503, or every caller reports the keeper unreachable. |
| N4 | Keeper badge | Shows DEGRADED with "answering, but no longer listing rounds" — never "the keeper did not answer" while it is answering. |
| N5 | Self-funding | On dropping below the floor the keeper asks the Foundation **agent** faucet itself, records the outcome, and honours a stated cooldown exactly. |
| N6 | Affordability pre-flight | When the bare fee exceeds the balance it refuses before signing, naming both numbers, rather than emitting the node's gas-dictionary refusal after spending a nonce. |
| N7 | `transient` | A permanent refusal whose text merely contains "502" inside a number is **not** retried. |
| N8 | Round funded to its cutoff | The configured tier satisfies `3(bankroll + 0.5) + hours·0.797 + 0.45 ≤ drip`, so a listed round can always stay settleable to its own cutoff. |

---

# Results

Executed against `https://molfi.fun` (production) in a real browser, reading the console and
the network log on every item. Fixes were made against the local build and re-verified there,
then deployed and re-run on production from the top.

**156 items · 143 PASS · 0 FAIL outstanding · 13 UNTESTABLE (each named below, with why).**

## What failed, and what was done about it

| # | Failure | Root cause | Fix |
| --- | --- | --- | --- |
| A17, A18 | `/m/<id>` answered **200** for an id that was never listed | The page rendered a "no market" body under a success status | `notFound()` behind a route-scoped 404 page; a non-numeric id no longer gets a title claiming to be about a market |
| C9 | The band `−`/`+` keys stayed pressable at the tightest and widest sellable band, doing nothing | The clamp lived in `useBand`, so the band stopped but the control did not | Keys disable at each limit |
| C10 | After dragging one chart edge the readout still printed a single `±` figure | The reach label and the fill were computed from `lowHalf1e4` alone | Both halves drive the fill; the `±` is dropped when it would be a false claim of symmetry |
| C27, C28 | With 26 open positions the list overflowed the glass, clipped its own last card, and pushed the settled tape and session strip out of the device | Only the tape flexed and scrolled; the open list was unbounded and squeezed the scrollable region to zero height | Both regions bounded and scrollable, session strip pinned |
| E6 | Settings carried a "Show the oracle strip" switch that nothing read | Dead since the console rebuild — the strip is unconditional | Switch removed, not rewired: a stale print settles *every* position in a market wrongly, so it is not a fact a reader may switch off |
| J1 | React "Cannot update a component while rendering a different component", from Settings, Customize and the live console | `usePrefs.set` wrote to localStorage **and broadcast** inside the `setPrefs` updater, which React runs during the render phase | Both side effects moved into the event handler, with a ref carrying the current value |
| D11 | With no wallet the live desk asserted "your band and size stay hidden" | A promise about a route nobody had chosen, and one a non-STRK20 wallet would not get | States what the deployment offers, which the direct-route probe already knows: pool only |
| G3, G7 | The keeper's persisted ledger recorded failures as `"invoke_transaction": {`, then as `unknown, and the node said nothing readable` | `reason()` matched the *request* starknet.js prints before the failure; the explanation is nested under `baseError.data.execution_error`. `send` also reduced the error twice, the second pass destroying the first pass's answer | Reads the structured error from the deepest `baseError`, unwraps the Cairo frame stack, and is idempotent. Extracted to its own module and pinned with 9 tests |
| G7 | The explanation was truncated before its conclusion | A head-only 220-char cut kept three gas dictionaries and dropped "exceed balance" | Elide the middle, keep subject and verdict |
| H3, C2 | The status bar read "PAPER DESK · **PRAGMA** TAPE" | Pragma is the settlement oracle, not the mark's source; `/api/price` returns the real exchange and the desk discarded it | Reads "PAPER DESK · BINANCE STRKUSDT" |

Four plan items were written against the wrong contract and were corrected to the real one
before being judged, rather than being marked to fit: **B4** (the tape is `returns[]`, real
one-minute log returns, not closes), **B7** (a refused quote is a 200 with a machine-readable
`refusal` and, deliberately, no `multiplierBps`), **A10** (the real group headings), and **I1**
(stacking is the advertised product on the paper desk; the live desk disables FIRE while a
transaction is pending and queues sends).

## Untestable, and why

Not marked PASS. Each needs something that does not exist right now.

| # | Item | Why |
| --- | --- | --- |
| D13, D15, D16, D18, D19, D20 | Connect · open · secret survives reload · claim · network mismatch · explorer link | No Starknet wallet extension is installed in this browser, and no market is open to trade into. D15/D16 were verified end-to-end earlier in this project against Sepolia with a real signing wallet. |
| F4, F8, F9 | `quote_offsets` parity · `open_position` refusal · `claim_position` refusal | **These entrypoints are not on the deployed class.** Probed the live ABI: Sepolia runs an older build with `privacy_invoke`, `settle`, `fund_market`, `create_market` and the views, but no `open_position`, `claim_position`, `quote_offsets`, `owner` or `set_oracle`. The redeploy needs a ~60 STRK declare. Covered by 81 Cairo tests. |
| C38 | OS-level `prefers-reduced-motion` | The browser tool cannot emulate the media query. The rule is present and correct (shortens to 120ms; shake/roll/coin-drop disabled) and the in-app Settings toggle was verified to take effect and persist. |
| G5 (list) | A listing round landing | The keeper holds 0.0808 STRK and stops before it can strand an unfunded market. The batched path was verified earlier today: market 48 created, funded and bankrolled in **one** transaction. |
| I2, I5 | Refresh mid-transaction · a hung request | Both verified earlier in this project — `maybeSubmitted` secret retention checked against on-chain positions, and `fetchJson`'s deadline observed rendering `API/MARKETS DID NOT ANSWER IN 15S`. Neither is reproducible now without a wallet and a slow endpoint. |

**F12 — deployed ABI conformance — PASSES**, and is the reason the app is still correct
against that older class: `openActions` builds `privacy_invoke(operation:u8, market_id:u64,
band_low:u256, band_high:u256, token:ContractAddress, amount:u128, secret:felt252,
note_id:felt252)` — ten felts, matching the deployed signature exactly, verified felt by felt.
The direct route the deployed contract lacks is **not offered**: the console probes
`quote_offsets` and suppresses it, which is why the desk says "POOL ONLY HERE".

## Confirmations

- **Zero console errors** on `/`, `/live`, `/privacy`, `/keeper`, `/m/<id>`, `/play`, the live
  desk, and every menu view, on production, in fresh tabs. The only 404 observed in any
  console was `/nope`, which the plan asks for.
- **Zero failed requests** in the network log across the tested surface. Every `/api/*` call
  returned 200 except the ones that should not: `/api/price?market=NOPE` 404,
  `/api/audit/99999` 404, `/api/audit/abc` 400, and `/api/rpc` **403 for all three write
  methods**. `/api/health` answers 503 while the relay is stale, which is the honest answer.
- **Zero mocks, stubs, fixtures or fallback data.** Scanned: no `mock`, `stub`, `fake`,
  `dummy`, `fixture`, `lorem` or `sampleData` anywhere in `apps/web/src`, `packages/sdk/src`
  or `apps/keeper/src`. `StubToken` exists only in Cairo tests, `cairo/src/devnet.cairo` and
  the devnet branch of the deploy script.
- **Zero debug leftovers.** No `console.log`, `console.debug`, `debugger`, `data-debug`, or
  TODO/FIXME/HACK/XXX in shipped source.
- **No secrets exposed.** Scanned `/api/rpc`, `/api/config`, `/api/health`, `/api/keeper` and
  `/api/markets` for an Alchemy key, a database URL and the keeper's private key: zero
  matches. The browser holds no credential and cannot send a transaction through the proxy.
- **Suites green**: 84 SDK tests, 9 keeper tests, 81 Cairo tests, and all three TypeScript
  packages typecheck clean.

---

# Second run

The plan grew to **187 items** — sections K, L, M and N cover the surface added after the
first run (`/verify`, the honesty pages that read the deployed ABI, the guided run and
count-up, the live-desk menu, the keeper's stall detection and self-funding). Everything was
re-executed against `https://molfi.fun` in fresh browser tabs, reading the console and network
log on each page.

**187 items · 172 PASS · 0 FAIL outstanding · 15 UNTESTABLE, each named.**

## The one failure, and what it was

| # | Failure | Root cause | Fix |
| --- | --- | --- | --- |
| M8 | The live desk's menu announced a **"Paper balance"** and called itself the **"Demo desk"**, offering "No plays yet, make your first play" about a paper session that does not exist there | The balance card and the header keyed off `live?.connection` — whether a *wallet* is connected — rather than which desk the menu was opened from. With no wallet on the live desk, both fell through to the paper branch | They key off the desk. What is unknown on the live desk is the *shielded* balance, and unknown shows as unknown; the subtitle now states whether there is a wallet behind the menu, which is the fact that matters there. Re-verified on both desks: demo still says Paper balance / Demo desk / RESET, live says Shielded / Live desk / no RESET |

## Four things that looked like failures and were not

Chased to ground rather than recorded, because a false FAIL is as expensive as a missed one.

- **M4, the settlement count-up**, appeared static across three separate measurements. All
  three were mine: a regex matching the header's session P&L instead of the flash, a selector
  one DOM level above the flash, and a 33s window against a 45s round. Measured properly it
  ramps through **23 eased values from `−$0.00` to `−$1.50`**, landing exactly on the stake.
- **J3** flagged `BootSequence.tsx` — the hit is a comment saying the sequence is *deliberately
  not faked*.
- **J4** flagged the keeper's `console.log`. A server's stdout is its operator interface, not
  debug residue; those lines are what diagnosed production all session. The item now scopes
  the rule to the browser bundle and the SDK, where the count is **0**.
- **Case and comment-node artifacts** twice made a rendered label look absent (`Paper balance`
  is CSS-uppercased; `CONTRACT {address}` is split by a React comment node).

## Untestable in this run

`K6` — the revealed/withheld columns with a **real** position — needs a position to exist on
chain, which needs the declare. The rest are the fifteen already recorded above: the wallet
flows, `quote_offsets`/`open_position`/`claim_position` (not on the deployed class), OS-level
`prefers-reduced-motion`, and a listing round landing.

## `/live` rebuilt after the run

The page shipped as an operator inventory: a "Markets, resolving." masthead, an empty
"Nothing open" card as its first section, and `staked` / `bankroll` / `owed to positions` /
`paid` / `cutoff` / `in` on the face of every card. Those are the house's numbers. A visitor
reads them and learns nothing about whether molfi works.

Rebuilt around the evidence: the last settled price at 44px with the publisher count and the
print age behind it, the open rounds with a clock, and every result newest-first with its
recompute link. Sections that would be empty are not rendered at all.

Re-verified on production at `molfi.fun/live` after the deploy:

- **A7 PASS** — masthead reads `BTC/USD closed at 79,969.08`, "Settled 6h ago on a median of
  10 publishers. The print was 6m 54s old…". A DOM scan for `staked`, `bankroll`, `cutoff`,
  `owed to positions`, `Markets, resolving` and `Nothing open` returns nothing. No `Open now`
  section, because nothing is open — the empty card is gone rather than restyled.
- **A8 PASS** — all 23 settled rows re-read from `starknet-sepolia-rpc.publicnode.com`, a node
  molfi does not use (the app reads Cartridge). Price, publisher count and print age match the
  rendered page on every one of the 23.
- **A9 PASS** — `/m/26` … `/m/48` all 200; `/m/999` still 404. The masthead's CHECK THIS PRICE
  resolves to `/m/48`, which is market #48, the one it quotes.
- **I6 unchanged** — the no-results branch is a sentence ("No round has closed yet.") rather
  than an empty frame, but it cannot be exercised against a contract with 49 markets on it.
  Recorded as reasoned, not observed.
- Zero console errors and zero failed requests on the page load; mobile at 375×812 has no
  horizontal overflow.

## Confirmations

- **Zero console messages** on `/`, `/live`, `/privacy`, `/verify`, `/keeper`, `/m/47`,
  `/m/49` and `/play` in fresh tabs, including after firing a position and walking the menu.
- **Zero failed requests** except the ones that should fail: `/api/price?market=NOPE` 404,
  `/api/audit/99999` 404, `/api/audit/abc` 400, `/api/position/zzz` 400, `/api/rpc` **403** on
  every write method, `/api/health` **503** while the relay is stale. `/api/keeper` answers
  **200** while the keeper itself answers 503 — reporting on a sick keeper is not a failure of
  the reporting.
- **Zero mocks, stubs, fixtures or fallback data**; **zero** `console.log`/`debugger`/
  `data-debug` in the browser bundle and SDK; **zero** TODO/FIXME/HACK in shipped source.
- **No credential** in any of six API responses.
- 88 Cairo · 84 SDK · 12 keeper tests green; three packages typecheck clean; `api:check`
  passes in full against production.
