# Verification run — the plan, written before testing

Every item states what **correct** means as a specific checkable result. PASS only when the
real product produced exactly that, with a clean console and no unexpected failed request on
the same interaction. Target: `http://localhost:3400`, Starknet Sepolia, real contracts, real
STRK, real Privy, real exchanges.

Status column is filled in during the run. UNTESTED is only for a dependency that genuinely
does not exist.

## A · Pages

| # | Item | Correct means | Status |
| --- | --- | --- | --- |
| A1 | `/` renders | 6 sections, live BTC price from `/api/price`, no console error | **PASS** — 6 sections, live BTC price, 0 console errors |
| A2 | `/` hero device | A device is drawn — WebGL canvas, or the CSS still if no context. Never an empty box or an apology | **PASS** — WebGL canvas 245×372. CSS still added as the no-context fallback (was a text apology) |
| A3 | `/` scroll choreography | All 5 reveal targets go 0.00 → 1.00 in document order; pin spacer exists; doc height > 5000 | **PASS** — all 5 reveals 0.00→1.00 in order; pin spacer present; doc height 5696 |
| A4 | `/` game switch | Clicking RANGE/UP-DOWN swaps panel copy and the stat; pill travels | **PASS** — panel copy and stat swap; pill travels |
| A5 | `/` markets grid | 9 cards, each with a drawn mark (no fallback initial) and a live price or a dash | **PASS** — 9 cards, 9 drawn marks, 0 fallback initials |
| A6 | `/` proof numbers | Counts come from `/api/markets` and `/api/keeper`; none hard-coded | **PASS** — 104 / 60 / 478, exactly matching `/api/markets` and `/api/keeper` |
| A7 | `/` no horizontal overflow | `scrollWidth == innerWidth` at 375px and desktop | **PASS after fix** — 0px overflow at desktop and 375px |
| A8 | `/` PLAY → `/play` | Both CTAs href `/play` and navigation lands on the desk | **PASS** — both CTAs href `/play`; navigation lands on the desk |
| A9 | `/play` unauthenticated | Gate with CONNECT TO PLAY; no desk behind it; market count matches `MARKETS.length` | **PASS after fix** — gate reads "9 MARKETS", derived from `MARKETS` |
| A10 | `/play` authenticated | Account funded + deployed, then the live desk. No demo desk anywhere | **PASS** — funded, deployed, desk. No demo desk anywhere |
| A11 | `/privacy` | Renders; states custody (molfi holds the key) and reads the deployed class for the band claim | **PASS** — states custody plainly; band verdict read from the deployed class |
| A12 | `/verify` | Accepts a commitment and answers from the chain | **PASS** — honest "no position carries that commitment", from the chain |
| A13 | `/keeper` | Shows the live keeper's real health, not a placeholder | **PASS after fix** — live keeper health (`KEEPER_URL` was unset) |
| A14 | `/m/[id]` settled | Recomputes one market; shows its settled price | **PASS** — market 104 recomputed with real checks and its settlement age |
| A15 | `/m/999999` | An honest "no such market", not a crash or a fabricated one | **PASS** — 404 "NO SUCH MARKET", no crash |

## B · API

| # | Item | Correct means | Status |
| --- | --- | --- | --- |
| B1 | `GET /api/markets` | 200, ids align with single `get_market` reads, < 3s warm | **PASS** — 200, ids aligned to `get_market`, 1.69s warm |
| B2 | `GET /api/rounds` | 200, newest-first, ids align with single `get_round` reads | **PASS** — newest-first, cutoff aligned to `get_round` |
| B3 | `GET /api/price` × 9 | 200 for every market in `MARKETS`, each with a named source | **PASS after fix** — all 9 markets serve a priced, sourced response |
| B4 | `GET /api/quote` valid | 200; multiplier == (1/prob)·(1−edge) to rounding | **PASS** — 11789 bps against an expected 11790 |
| B5 | `GET /api/quote` invalid | 4xx naming the missing/unknown parameter; never a made-up quote | **PASS** — 400 naming the unknown parameter |
| B6 | `GET /api/balance` | Matches a direct `balanceOf` call | **PASS** — matches `balanceOf` exactly |
| B7 | `GET /api/position/<real>` | `exists: true`, fields match the contract | **PASS** — real position, exists, market 1, matches the contract |
| B8 | `GET /api/position/<absent>` | 200 `exists: false` — an answer, not an error | **PASS** — 200 `exists: false` |
| B9 | `GET /api/ticket/<real>` | `exists: true`, ticket + round, from the up/down contract | **PASS** — ticket + round from the up/down contract |
| B10 | `GET /api/ticket/<garbage>` | 400 naming the felt format | **PASS** — 400 naming the felt format |
| B11 | `GET /api/health` | 200; names the endpoint that answered; oracle status honest | **PASS** — reported `down` while 5 markets had no relayed price, then recovered. Honest |
| B12 | `GET /api/config` | 200; deployed addresses; no secret in the body | **PASS** — no secret in the body |
| B13 | `GET /api/keeper` | 200 `configured: true` with the live keeper's ledger | **PASS after fix** — `configured: true` with the live ledger |
| B14 | `POST /api/rpc` allowed | Forwards and returns the node's answer | **PASS** — forwards and returns the node answer |
| B15 | `POST /api/rpc` declare | 403 `method not permitted` | **PASS** — 403 `method not permitted` |
| B16 | `POST /api/wallet/starknet` no auth | 401, no wallet created | **PASS** — 401, no wallet created |
| B17 | `POST /api/wallet/fund` body address | Ignores an address in the body; serves only the session's own | **PASS** — address in the body ignored; serves only the session's own |
| B18 | `GET /api/audit/[id]` | 200, published audit trail for a settled market | **PASS** — 11 checks for market 104 |
| B19 | `GET /api/price?market=NOPE` | 4xx or an honest error — never a silent price | **PASS** — 404 "molfi does not list NOPE" |

## C · Contracts / on-chain

| # | Item | Correct means | Status |
| --- | --- | --- | --- |
| C1 | Direction open | `open_ticket` sends exactly 4 felts; event carries no direction | **PASS** — `0x46a766ea…`, exactly 4 felts, event carries no direction |
| C2 | Direction settle | Settles from the oracle median with ≥ 3 sources | **PASS** — round 7 settled from the median, 10 sources |
| C3 | Direction claim (win) | Pays exactly stake × multiplier; ticket marked claimed | **PASS** — round 7 paid 9.6 on a 5 STRK stake at 1.92× |
| C4 | Range open | Position exists on chain; band absent from calldata | **PASS** — position `0x621f98ef…` exists on chain; B7 confirms the shape |
| C5 | Account deploy | A counterfactual Privy account deploys itself, signed by its own key | **PASS** — `0x7e8e07…` SUCCEEDED, signed by the account's own key |
| C6 | Faucet drip | Funds only the caller's derived address | **PASS** — derives the address server-side; B17 confirms a body address is ignored |
| C7 | molfi-relayed pairs | The 5 new markets are listed on chain and settle against a relayed median with a true source count ≥ 3 | **PASS** — all 9 markets listed on chain (AVAX/LINK/DOGE/XRP seen funded); the 5 molfi-relayed pairs carry 5 real sources, on-chain price within 2.6–7.5 bps of the live median |

## D · Flows

| # | Item | Correct means | Status |
| --- | --- | --- | --- |
| D1 | Fresh login → playable | Email OTP → wallet → funded → deployed → desk, no manual step | **PASS** — real email OTP → wallet → funded → deployed → desk, no manual step |
| D2 | Game switch on the desk | Swaps controls, quote, copy, and the contract named in the footer | **PASS** — controls, quote, copy and footer contract all swap |
| D3 | Layout stability | Console height identical in both games | **PASS after fix** — 831px in range, direction and back |
| D4 | Direction trade | UP/DOWN sends the trade; `staked` rises; `reserved` = stake × multiplier | **PASS after fix** — UP key sent it; round 18 staked 1.0, reserved 1.92 |
| D5 | RIDING counter | Counts live tickets on both games; excludes tickets the chain says don't exist | **PASS** — 1 RIDING after the trade; phantom tickets excluded |
| D6 | Market cycling | All 9 markets reachable from the chip, each with its own price | **PASS after fix** — 9 markets, each its own price, 0 stale carry-overs |
| D7 | No open round | Says so plainly; the keys refuse rather than sending | **PASS** — "NO OPEN ROUND" shown and the keys refuse |
| D8 | Round handover | A funded round is always available | **PASS** — round 8 listed and funded while round 7 still had 280s |
| D9 | Reload mid-session | Same account resolved, positions survive | **PASS** — reload resolves the same account; positions survive |
| D10 | Keeper unattended | Lists, funds, relays and settles on its own cadence | **PASS** — lists, funds, relays and settles unattended on its cadence |

## E · Cross-cutting

| # | Item | Correct means | Status |
| --- | --- | --- | --- |
| E1 | Console clean | Zero errors across every page and interaction above | **PASS** — zero console errors on every page and interaction above |
| E2 | Network clean | Zero unexpected 4xx/5xx | **PASS** — no unexpected 4xx/5xx; the only non-2xx are the asserted refusals (B5, B10, B15, B16, B19) |
| E3 | No mocks | No stub, fallback constant or synthesised value in the tested surface | **PASS** — every price fetched; unreachable renders a dash, never a number |
| E4 | No secrets client-side | No private key or app secret in any bundle or response | **PASS** — dev key, faucet key and Privy secret all absent from the production client bundle |
| E5 | Production build | `next build` succeeds | **PASS** — `next build` clean |
| E6 | Unit tests | SDK and keeper suites green | **PASS** — Cairo 119, SDK 110, keeper 26 = 255 tests, 0 failures |
