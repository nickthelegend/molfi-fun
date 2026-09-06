# Verification run — the plan, written before anything was tested

Every item below states what **correct** means as a specific, checkable result. "It rendered"
is not a result. Each is marked PASS only when the real product produced exactly this, with a
clean console and no failed network request on the same interaction.

Target: `http://localhost:3400`, Starknet Sepolia, real contracts, real STRK, real Privy.

## A · Pages

| # | Item | Correct means |
| --- | --- | --- |
| A1 | `/` landing | Renders; live market count read from chain (not a constant); "PLAY THE GAME" links `/play`; no console error |
| A2 | `/play` before login | Shows the gate with CONNECT TO PLAY; no desk behind it; no wallet address anywhere |
| A3 | `/play` after login, new account | Gate shows SETTING UP → PUTTING ON CHAIN → desk. Account ends deployed and funded |
| A4 | `/privacy` | States what leaks, and reads the **deployed class** to say whether the band is on chain — not the repo |
| A5 | `/verify` | Accepts a commitment, recomputes from chain, agrees with `/api/position` or `/api/ticket` |
| A6 | `/keeper` | Shows the live keeper's health from its real endpoint, not a placeholder |
| A7 | `/m/[id]` | Recomputes one market from published data; a settled market shows its settled price |
| A8 | `/m/999999` (absent) | An honest "no such market", not a crash and not a fabricated market |

## B · API routes

| # | Item | Correct means |
| --- | --- | --- |
| B1 | `GET /api/markets` | 200, `markets.length > 0`, ids match single `get_market` reads, < 3s |
| B2 | `GET /api/rounds` | 200, rounds newest-first, ids match single `get_round` reads |
| B3 | `GET /api/price?market=BTC` | 200, a real spot price, named source |
| B4 | `GET /api/quote` (valid) | 200, multiplier matching the SDK's own computation for the same band |
| B5 | `GET /api/quote` (no spot) | 4xx with a sentence naming what is missing — never a made-up quote |
| B6 | `GET /api/balance?address=…` | 200, matches a direct `balanceOf` call |
| B7 | `GET /api/position/<real>` | 200, `exists: true`, fields match the contract |
| B8 | `GET /api/position/<absent>` | 200 `exists: false` — an answer, not an error |
| B9 | `GET /api/ticket/<real>` | 200, `exists: true`, ticket + its round, from the up/down contract |
| B10 | `GET /api/ticket/<garbage>` | 400 naming the felt format |
| B11 | `GET /api/health` | 200, reports which RPC endpoint actually answered |
| B12 | `GET /api/config` | 200, the deployed addresses, no secret of any kind in the body |
| B13 | `GET /api/keeper` | 200, the live keeper's real ledger |
| B14 | `POST /api/rpc` (allowed) | Forwards and returns the node's answer |
| B15 | `POST /api/rpc` (declare) | 403 `method not permitted` — the allowlist still refuses what it should |
| B16 | `POST /api/wallet/starknet` (no auth) | 401, no wallet created |
| B17 | `POST /api/wallet/sign` (no auth, prod semantics) | Refuses without a session; dev key only outside production |
| B18 | `POST /api/wallet/fund` (no auth) | Refuses, or serves only the dev wallet outside production — never an address from the body |
| B19 | `GET /api/audit/[id]` | 200, the published audit trail for a settled market |

## C · Contracts / on-chain

| # | Item | Correct means |
| --- | --- | --- |
| C1 | Range market | `open_position` lands; `reserved` rises by the exact payout |
| C2 | Up/down market | `open_ticket` sends exactly 4 felts; event carries no direction |
| C3 | Settlement | Round settles from the oracle median with ≥ 1 source; reference vs settled decides |
| C4 | Claim (win) | Pays exactly stake × multiplier; ticket marked claimed |
| C5 | Claim (loss) | **Succeeds**, pays 0, releases the reservation — does not revert |
| C6 | Account deploy | A counterfactual Privy account deploys itself, signed by its own key |
| C7 | Faucet drip | Server funds only the caller's derived address; never one from the body |

## D · Flows

| # | Item | Correct means |
| --- | --- | --- |
| D1 | Fresh login → playable | Email OTP → wallet → funded → deployed → desk, with no manual step |
| D2 | Game switch | RANGE ↔ UP/DOWN swaps controls, quote, copy, and the contract named in the footer |
| D3 | Direction trade | UP/DOWN fires, `staked` rises on chain, `reserved` = stake × multiplier |
| D4 | Range trade | Band fires, position exists on chain, band absent from calldata |
| D5 | Settle + claim | Round settles on schedule; claim pays; balance rises by payout − fee |
| D6 | RIDING counter | Counts live tickets on both games; excludes tickets the chain says don't exist |
| D7 | No open round | Says so plainly; the fire key refuses rather than sending |
| D8 | Round handover | A funded round is always available — no window where the desk is shut |
| D9 | Reload mid-session | Positions survive; the same account is resolved, not a new one |
| D10 | Keeper timing | Rounds list, fund and settle unattended on the configured cadence |

## E · Cross-cutting

| # | Item | Correct means |
| --- | --- | --- |
| E1 | Console | Zero errors across every page and interaction above |
| E2 | Network | Zero failed requests (4xx/5xx) except the ones asserted as correct refusals |
| E3 | No mocks | No stub, fallback constant, or synthesised value anywhere in the tested surface |
| E4 | No secrets client-side | No private key, app secret, or faucet key in any bundle or response |
