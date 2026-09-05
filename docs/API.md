# molfi — the backend

Everything a client needs, and nothing that needs a client. Every route reads the chain or
the oracle live; none of them holds state, and none of them can move money.

Base URL is the console's own origin. All responses are JSON with `cache-control: no-store`.

## The one rule

**Amounts are integers, as strings.** A `bigint` does not survive JSON and a float loses the
last digits of an 18-decimal token, so every amount leaves as a decimal string in the
smallest unit. `/api/config` says which unit each field is in. The only place a human number
is accepted is the `stake` parameter on `/api/quote`, and it has a differently-named sibling
for raw units so the two can never be confused.

---

## GET `/api/config`

Everything static: addresses, markets, round lengths, units, and the rules the contract
enforces. Fetch once at boot; a UI that hardcodes any of it will be quietly wrong on some
network or after some redeploy.

Includes the full probability tables. They decide every multiplier, and publishing them is
what makes a quote checkable rather than a claim.

```jsonc
{
  "network": "mainnet",
  "chainId": "0x534e5f4d41494e",
  "contracts": { "market": "0x…", "pool": "0x…", "token": "0x…", "oracle": "0x…" },
  "units": { "priceDecimals": 8, "stakeDecimals": 18, "widthScale": "100000000", … },
  "rules": { "houseEdgeBps": 400, "maxPriceAgeSeconds": 900, "minPublishers": 3, … },
  "rounds": [{ "tier": 0, "key": "15m", "seconds": 900, "label": "15m" }, …],
  "markets": [{ "key": "BTC", "pair": "BTC/USD", "dp": 2, "rounds": [{ "sigma1e4": "171077", "probTable": [...] }] }]
}
```

`contracts.market` is `null` until molfi is deployed on that network. That is the honest
answer, and the console renders it as "not deployed yet" rather than as an empty market list.

---

## GET `/api/price?market=BTC[&history=1]`

Two prices, and the difference is the whole point.

- **`price`** is a live exchange mark, in 8-decimal fixed point. It is what a screen should
  show, because Pragma republishes every few minutes and a price frozen for seven of them is
  unusable. It settles nothing.
- **`oracle`** is Pragma's on-chain median — the only number that resolves a band — with its
  age, its publisher count, and whether the contract would accept it.

```jsonc
{
  "market": "BTC", "pair": "BTC/USD",
  "price": "7973205499999", "decimals": 8, "source": "binance:BTCUSDT",
  "oracle": {
    "price": "7973205499999", "updatedAt": 1788620257, "sources": 10,
    "ageSeconds": 71, "quotable": true, "refusal": ""
  },
  "oracleError": null,
  "returns": [ … ]        // only with history=1: real one-minute log returns
}
```

`quotable: false` means the contract would refuse to settle against this print, and
`refusal` says why in a sentence. Do not quote against it; the desk disables firing instead.

`oracle` is `null` with `oracleError` set when the node could not be read. The mark is still
returned, because losing the price display to an RPC hiccup helps nobody — but a null oracle
must never be rendered as a fresh one.

`history=1` adds ~1000 real one-minute log returns, the same tape the tables were fitted on.
That is what the demo desk replays; a Gaussian walk would quote one probability and deliver
another.

Rate limited per caller, and cached briefly server-side so every open tab does not become an
upstream request.

---

## GET `/api/quote`

Prices a band with the same integer kernel the contract mirrors.

| parameter | meaning |
| --- | --- |
| `market` | `BTC`, `ETH`, `STRK` |
| `tier` | round index, `0`-based, from `/api/config` |
| `spot` | current price in 8-decimal fixed point |
| `low`, `high` | band edges, same units — or: |
| `halfWidth` | symmetric half-width, fraction of spot × 1e8 — or: |
| `halfWidthPct` | symmetric half-width as a percentage, e.g. `0.171` |
| `stake` | whole STRK, e.g. `2.5` (default `1`) |
| `stakeUnits` | raw token units, if you would rather be explicit |

```jsonc
{
  "ok": true,
  "multiplierBps": "12511",     // 1.2511x
  "prob1e6": "767260",          // 76.7%
  "payoutUnits": "12511000000000000000",
  "window": { "minHalfWidthPct": 0.0428, "maxHalfWidthPct": 0.3024 }
}
```

A refusal is named rather than collapsed into an error, because the four cases need four
different responses:

```jsonc
{ "ok": false, "refusal": "too-cheap", "detail": "band is so wide the fee eats the whole edge; narrow it" }
```

`no-calibration` · `band-not-straddling` · `band-inverted` · `too-cheap` · `too-rich`

`window` is the range of half-widths the desk will actually sell at this spot. Bound your
slider to it and a user cannot paint a band that is then refused.

This is a quote, not an offer. The contract prices the band again at open against the table
it holds. They agree by construction, and if they ever did not, the contract is right.

---

## GET `/api/markets`

Every market the contract holds, read from `market_count` and `get_market`.

```jsonc
{
  "deployed": true,
  "contract": "0x…",
  "markets": [{
    "id": 1, "pair": "BTC/USD", "known": true,
    "cutoffAt": 1788624079, "roundSeconds": 900,
    "isSettled": true, "settledPrice": "7970000000000", "settledSources": 11,
    "staked": "1000000000", "paid": "1250700000",
    "bankroll": "1000000000000", "reserved": "0"
  }]
}
```

`deployed: false` carries a `reason` and an empty list — "not deployed" and "no markets open"
are different facts and are reported differently.

`known` is whether molfi lists that pair. A market for a pair molfi never published a
calibration for can still be settled honestly and cannot be checked against anything.

---

## GET `/api/position/<commitment>`

One position, by its commitment.

**There is no "positions of this address" route, and there cannot be.** The contract stores
`poseidon(tag, secret, market_id, band_low, band_high)` and nothing that links it to anyone.
That absence is the product.

The commitment is public and knowing it proves nothing — deriving it needs the secret, and
holding the secret is what claims the payout. Compute it client-side with `commitmentOf()`
from `@molfi/sdk`.

```jsonc
{
  "exists": true,
  "position": { "marketId": 1, "bandLow": "…", "bandHigh": "…", "stake": "…", "multiplierBps": "12507", "claimed": true },
  "market": { … },
  "won": true,             // null while the market is open — unresolved is not lost
  "claimable": false,
  "payoutUnits": "1250700000"
}
```

`exists: false` for a commitment nobody has opened. Saying so reveals nothing, because
anyone could have asked.

---

## GET `/api/audit/<id>`

The verifier, as JSON. Recomputes a settled market from published data and reports each
check with both answers side by side.

```jsonc
{
  "sound": true,
  "failed": [], "unchecked": [],
  "market": { … },
  "checks": [{
    "key": "table-is-the-published-one",
    "claim": "The table the contract prices with is the one molfi published for this round",
    "verdict": "ok",
    "onChain": "17 knots · 435f520e",
    "recomputed": "17 knots · 435f520e",
    "matters": "A market listed with a private table settles honestly and can still be checked against nothing."
  }]
}
```

Verdicts are `ok`, `failed`, or `unchecked`. **`unchecked` is not `ok`** — a check that could
not run reports so rather than turning absence of evidence into evidence.

Eleven checks: the table is a CDF; it is the published one; the round is one molfi
calibrates; the print was fresh at settlement; it was broad enough; it was positive; the
market did not settle early; conservation; commitments are covered; the quote is
reproducible; the fee is the disclosed one.

No wallet, no account, no position. A claim only a participant can check is not a claim
anyone should accept.

---

## GET `/api/health`

Whether this deployment is working, per component, with the evidence.

```jsonc
{
  "ok": true,
  "answeredBy": "configured",     // or "public fallback"
  "chain":  { "status": "ok",       "block": 1234567 },
  "oracle": { "status": "degraded", "detail": "oldest print is 480s…", "pairs": [ … ] },
  "market": { "status": "absent",   "detail": "no molfi market contract on mainnet…" },
  "pool":   { "status": "ok",       "address": "0x…" }
}
```

Four statuses, and `absent` is not `down`: a deployment with no market contract runs the demo
desk and has no market to be down. Returns 503 only when something is genuinely `down`.

`answeredBy` distinguishes "working" from "working on the backup because the configured key
is pointed at a network it cannot serve" — a distinction that otherwise survives to
production.

---

## POST `/api/rpc`

A read-only Starknet JSON-RPC proxy, so the browser never holds the API key and CORS is not
a problem. Reads only: `starknet_call`, `starknet_blockNumber`, `starknet_getEvents` and
friends. Anything else is refused with `-32601`.

Notably absent: `starknet_addInvokeTransaction`. Every transaction goes through the user's
wallet, which submits it itself. Proxying a signed transaction would put this server in a
path it has no business being in.

A dead node returns a JSON-RPC error with HTTP 200 — the proxy was reached, the node was
not — because clients turn a non-2xx into a generic transport complaint that points at the
request instead of at the node.

---

## Writing

There is no write API, deliberately.

Opening, claiming, shielding and withdrawing all go through the user's **privacy wallet**,
which holds the viewing key, discovers the notes, builds the proof, and submits. molfi never
sees a key. Build the action list with `openActions` / `claimActions` / `shieldActions` /
`unshieldActions` from `@molfi/sdk` and hand it to `strk20InvokeTransaction`.

Settling is a plain public call — it reads an oracle and writes a price — and anyone may
settle any expired market, not only its participants.
