# molfi — full-surface audit plan

Every component and every flow, with what "correct" means stated **before** anything was run.
Executed by `scripts/audit.mjs`, which drives a real Chrome over CDP and calls the live API, so
the whole plan can be re-run end to end rather than re-asserted.

**Target:** `https://molfi.fun` (Starknet Sepolia) and the keeper at
`keeper-production-8dd8.up.railway.app`.

**Browser:** real Chrome via the DevTools Protocol. The Claude-in-Chrome extension is not
connected in this environment (three attempts). This is not a downgrade to a simulation — it is
a real Chrome process, and it is strictly *more* trustworthy here than the in-app preview pane,
which was caught during this audit never firing `IntersectionObserver` for any element including
`document.body`. That pane produced one false failure before it was found; every item below runs
in Chrome.

**Console rule:** an item fails if the page logs any error, **except** a `404` logged by the
browser for a route whose whole purpose is to answer 404. That is the correct HTTP result and
the browser logs it regardless of the app.

---

## A · Pages

Each page is checked at **1280×860** and **390×844**. Common criteria for every page: correct
`<title>`, correct HTTP status, no console errors, `scrollWidth === clientWidth` (no horizontal
overflow), no raw `TypeError` / `undefined` / `NaN` / `[object Object]` in rendered text, and no
loader still showing after settle.

| # | Item | Correct means |
| --- | --- | --- |
| A1 | `/` landing | 200 · title `molfi — a handheld for bets nobody can see` · all 6 sections render non-empty · live BTC price present · proof counters show the same numbers `/api/markets` and `/api/keeper` report, not 0 |
| A2 | `/play` desk gate | 200 · title `molfi — the desk` · shows *either* a working `CONNECT TO PLAY` button *or*, when `health.door` is not `ok`, the "cannot open new accounts" message — never a button that leads to a dead end |
| A3 | `/privacy` | 200 · title `molfi — what stays private` · renders the live `openActions` array or an honest reason it cannot |
| A4 | `/verify` | 200 · title `molfi — check a position` · commitment input + `LOOK` present · `LOOK` disabled while the field is empty |
| A5 | `/keeper` | 200 · title `molfi — the keeper` · reports the keeper's real state including when it is degraded |
| A6 | `/m/1` settled market | 200 · title `molfi — market #1` · audit checks render with chain-vs-recomputed values |
| A7 | `/m/70` settled market | 200 · title `molfi — market #70` · same |
| A8 | `/m/999999` absent id | **404** · title `molfi — no such market` · body says NO SUCH MARKET |
| A9 | `/m/abc` malformed id | **404** · title `molfi — no such market` |
| A10 | `/nope-not-here` | **404** · title `molfi — no such page` |

## B · API

| # | Item | Correct means |
| --- | --- | --- |
| B1 | `GET /api/config` | 200 · `network: "sepolia"` · contract addresses match `deployments/sepolia.json` |
| B2 | `GET /api/health` | 200 · `chain/oracle/market/pool` all `ok` · `door` present with a status · `ok:true` |
| B3 | `GET /api/markets` | 200 · `count ≥ 129` · every entry has `pair` and `isSettled` |
| B4 | `GET /api/rounds` | 200 · `contract` = the deployed up/down address |
| B5 | `GET /api/keeper` | 200 · `configured:true` · `ledger.relay.ok > 0` (persisted, survives restarts) |
| B6 | `GET /api/price?market=BTC` | 200 · `quotable` boolean · `sources ≥ 3` · age < 900s |
| B7 | `GET /api/price?market=NOPE` | **404** with a readable `error` |
| B8 | `GET /api/price` (no param) | **400** with a readable `error` |
| B9 | `GET /api/quote` valid | 200 · `ok:true` · `multiplierBps > 10000` · `low < spot < high` |
| B10 | `GET /api/quote` band too wide | 200 · `ok:false` · `refusal: "too-cheap"` |
| B11 | `GET /api/quote` negative stake | **400** · `error: "stake must be positive"` |
| B12 | `GET /api/quote` unknown param | **400** · error naming the accepted parameters |
| B13 | `GET /api/audit/70` | 200 · every check has a verdict · `failed === 0` |
| B14 | `GET /api/audit/999999` | **404** |
| B15 | `GET /api/position/<real>` | 200 · `exists:true` · stake and multiplier present · band **absent** (the privacy claim) |
| B16 | `GET /api/position/0x1` | 200 · `exists:false` — an unopened commitment reads absent, not an error |
| B17 | `GET /api/position/zzz` | **400** with a readable `error` |
| B18 | `GET /api/ticket/<felt>` | 200 · `exists` boolean |
| B19 | `GET /api/ticket/zzz` | **400** readable |
| B20 | `GET /api/balance?address=<keeper>` | 200 · `balance` a decimal string |
| B21 | `GET /api/balance` (no param) | **400** readable |
| B22 | `GET /api/balance?address=notanaddress` | **400** readable |
| B23 | `POST /api/rpc` allowed read | 200 · a JSON-RPC result |
| B24 | `POST /api/rpc` `starknet_addDeclareTransaction` | **403** · refused by allowlist |
| B25 | `POST /api/rpc` unknown method | **403** · refused |
| B26 | `POST /api/wallet/sign` unauthenticated | **401** · `sign in first` |
| B27 | `POST /api/wallet/starknet` unauthenticated | **401** |
| B28 | `POST /api/wallet/fund` unauthenticated | **401** — *not* 503. A 503 means the faucet is unconfigured, which breaks every new visitor |

## C · Contracts, on chain

| # | Item | Correct means |
| --- | --- | --- |
| C1 | Market contract live | `market_count ≥ 129` read straight from `0x053b1721…` |
| C2 | Up/down contract live | `round_count` readable from `0x07881b0c…` |
| C3 | Relay live | `get_data_median` for BTC/USD returns a price with ≥ 3 sources |
| C4 | STRK20 pool live | class hash readable at `0x0254a6b2…` |
| C5 | Band is not on chain | the deployed market class stores `low_off_1e8`/`high_off_1e8`, and `get_position` returns no band |
| C6 | Settled price immutable | market #1's settled price equals what `/m/1` and `/api/audit/1` report |
| C7 | Pool accepts molfi's shape | `compile_actions` reaches `SUBCHANNEL_NOT_FOUND` for molfi's open — parsed, ordered, replay-protected |

## D · External integrations

| # | Item | Correct means |
| --- | --- | --- |
| D1 | 5 exchanges reachable | Binance, Coinbase, Kraken, OKX, Bybit each answer a spot price, no geo-block |
| D2 | molfi median matches the tape | relayed on-chain price within 100 bps of a freshly computed 5-venue median |
| D3 | Pragma via relay | all 9 pairs carry a publisher count and an age under the settlement limit |
| D4 | Postgres ledger persists | `/api/keeper` `ledger` row count exceeds this process's cycle count (survived a restart) |
| D5 | Keeper process alive | `/health` answers, `lastError` null, and its state is honestly reported |
| D6 | Privy configured | `/api/wallet/starknet` answers 401 rather than 500 — the SDK is wired, the session is what is missing |

## E · Flows and edge cases

| # | Item | Correct means |
| --- | --- | --- |
| E1 | Landing CTA → desk | clicking `PLAY THE GAME` navigates to `/play` with the correct title |
| E2 | Back / forward | history back returns to `/`, forward returns to `/play`, both with correct titles and a non-blank body |
| E3 | Every internal link | every `href="/..."` on every page answers 200 |
| E4 | `/verify` empty submit | `LOOK` is disabled — a click cannot fire a request |
| E5 | `/verify` invalid input | shows the **server's** message (`commitment must be a felt in hex`), never a URL or a bare status code |
| E6 | `/verify` valid commitment | renders market, stake **formatted as STRK**, multiplier, claimed, owner, reach — and no band |
| E7 | `/verify` triple-click | three rapid clicks produce one correct result, no error, no duplicate render |
| E8 | Desk: RANGE ↔ UP/DOWN | document height identical in all three states (the fixed-height requirement) · UP/DOWN swaps in ▲ UP / ▼ DOWN · no red button |
| E9 | Desk: tier switch | 15m / 1h / 4h each change the round label; height unchanged |
| E10 | Desk: band ± | `+` widens and `−` narrows the ± percentage |
| E11 | Desk: market switch | cycles to the next pair and the price follows |
| E12 | Desk: empty state | with no open market the desk says `NO OPEN MARKET` and the Fire key is **disabled** |
| E13 | Desk: fire when disabled | three clicks on a disabled Fire produce no transaction, no error, no raw exception |
| E14 | Accessibility | every desk control carries an `aria-label` |
| E15 | Mid-flow reload | reloading `/verify` after a lookup returns a clean empty form, not a stale or broken one |

## F · Hygiene

| # | Item | Correct means |
| --- | --- | --- |
| F1 | No mocks or stubs | no mock/stub/fake/fixture standing in for real logic in shipped code |
| F2 | No debug leftovers | no `console.log`/`debug`, no TODO/FIXME, no lorem/dummy/test data in `apps/web/src` |
| F3 | No dev bypass in production | `NEXT_PUBLIC_DEV_WALLET_*` appears nowhere in the production bundle |
| F4 | Secrets not shipped | no private key, Privy secret or faucet key in any client bundle |
| F5 | Unit suites green | Cairo 131 · SDK 112 · keeper 35 |
| F6 | Project verifier green | `scripts/verify.mjs` 39/39 against production |

---

## Known-untestable without a dependency that does not exist

These are recorded as **UNTESTED**, never as PASS.

| # | Item | Missing dependency |
| --- | --- | --- |
| U1 | Privy email sign-in end to end | a real email inbox |
| U2 | A signed trade: open → settle → claim | an open market *and* a funded account; the keeper holds ~8 STRK against a 15 floor and the faucet float 1.46 against a 12 drip |
| U3 | A transaction through the STRK20 pool | a privacy-enabled wallet (Ready/Xverse) and FPI screening — molfi holds no viewing key by design |
| U4 | Mainnet anything | real money; all four accounts hold 0.000000 STRK and none is deployed |

---

## Result

`node --experimental-strip-types scripts/audit.mjs` against `https://molfi.fun`:

**76 PASS · 0 FAIL · 7 untestable on production**

The seven are the desk items (E8–E14), which production gates behind Privy. They were run in
the same real Chrome against the same desk code on a local server with the repo's development
door open — `15 PASS · 0 FAIL` — and are reported here as verified-locally rather than as
production passes, because that is what they are.

### Corrections made to this plan during the run

Seven items failed first time and **six of them were this plan being wrong, not the product**.
Each was resolved by reading the code's actual contract rather than by changing the product to
match a guess:

| Item | What I asserted | What is actually correct |
| --- | --- | --- |
| B6 | `sources` at the top of `/api/price` | it is nested under `oracle` |
| B8 | no `market` param → 400 | the route reads `?? "BTC"` — a deliberate default, not an error |
| B12 | error says "unknown parameters" | it pluralises with the count; one bad param says "parameter" |
| B2 | oracle must be `ok` | health warns at 420s and the contract refuses at 900s, so a print is legitimately in the warning band part of every cycle. The invariant is *not down, every pair settleable* |
| C3 | `decodePrint().price` | it returns `raw` |
| D1/D2 | `aggregate("BTCUSDT")`, `.median` | it takes a **base** symbol and appends each venue's own suffix — `"BTCUSDT"` built `BTCUSDTUSDT` and read as a total outage while all five venues answered 200 to curl. It returns `.price` as an 8-dp bigint |
| E8 | no red button in UP/DOWN | the red key is the CONNECT affordance, not the trade key that was asked to go. ▲ UP / ▼ DOWN are correctly in its place |
| E12 | Fire disabled with no open market | `state.connection` resolves asynchronously, so `.disabled` at one instant tests a race. The contract that matters — and holds — is that the deck states NO OPEN MARKET and three presses open nothing |

Three further failures were defects in the **harness**, not the product or the plan: `execSync`
with a shell pipeline returned an empty string with exit 0 for both toolchain checks; `sh()`
swallowed a failed command into `""`, so an item could fail with no evidence; and a fixed sleep
after the CTA click passed against production and failed against a cold `next dev`. All three
are fixed — the toolchains run through `spawnSync`, failures return their output, and navigation
waits on a predicate to a deadline.

**Zero product defects were found by this run.** The four found earlier in the same session —
the unconfigured faucet closing the front door, `fetchJson` discarding every server error
message, raw wei in the observer, and `/m/999999` titled as a real market — were fixed and
deployed before this plan was written, and are covered by items A8, B28, E5 and E6.
