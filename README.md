# molfi

**Prediction markets where nobody can see your position.**

You pick a price range, pick how long it has to hold, and stake on it. Your range and your
size stay sealed until the market settles, so nobody can front run you, copy you, or lean on
your position because they saw it coming.

---

## Why privacy is the mechanic here

On a public chain your order is a signal before it is a trade. Anyone watching the mempool or
the contract can price against it, crowd into it, or simply get there first. That is not a
side effect of trading onchain — it is the reason informed flow stays off it.

So the position is a commitment, never an address. You stake through the STRK20 privacy pool,
the market contract records the commitment, and the link between you and your position stops
there.

## What stays private, and what does not

Every project claims privacy. This is the part most of them leave out.

| Sealed until settlement | Public, always |
| --- | --- |
| The band you picked | That a position was opened |
| How much you staked | The total staked in a market |
| Which side of the range you took | The price the market settled at |
| Which positions are yours | Every payout the contract made |

Your deposit into the pool names you. What it buys is that the market never sees that name.

## Settlement

A market settles against a price at a stated block. Once it has settled, the inputs that made
it checkable are published, and anyone can recompute the outcome and compare it against what
the contract actually paid. You do not need an account, a wallet, or a position to do that —
"permissionless settlement" is a claim until a stranger can run it.

---

## Live right now

| | |
| --- | --- |
| Console | **[molfi.fun](https://molfi.fun)** |
| Watch a market resolve | [molfi.fun/live](https://molfi.fun/live) |
| What leaks, and what does not | [molfi.fun/privacy](https://molfi.fun/privacy) |
| Who settles these | [molfi.fun/keeper](https://molfi.fun/keeper) |
| Recompute a settled market | [molfi.fun/m/1](https://molfi.fun/m/1) |

Markets settle on Starknet Sepolia every fifteen minutes, unattended, against a price backed
by ten to twelve independent publishers. Nothing on those pages needs a wallet.

## Layout

| Path | What it is |
| --- | --- |
| [`cairo/`](cairo) | `MolfiMarket`, the anonymizer the pool invokes, and `PriceRelay`. 68 tests. |
| [`packages/sdk/`](packages/sdk) | The pricing kernel, mirrored by the Cairo one and pinned to it by generated vectors. Also the oracle adapter, the verifier, and the network wiring. |
| [`apps/web/`](apps/web) | The console, the verifier pages, and the API. |
| [`apps/keeper/`](apps/keeper) | Relays the price, settles what is due, opens the next round. |
| [`scripts/`](scripts) | Deploy, preflight, end-to-end, submission. |
| [`docs/API.md`](docs/API.md) | Every endpoint, and what each number means. |

## Run it

```bash
pnpm install
pnpm dev          # the console on :3400
pnpm test         # the SDK
pnpm test:cairo   # the contracts
pnpm api:check    # every endpoint, including the failure paths
```

## Networks

Contract addresses are protocol facts and live in
[`packages/sdk/src/networks.ts`](packages/sdk/src/networks.ts) rather than in app config,
checked against the chain rather than trusted.

| | Sepolia | Mainnet |
| --- | --- | --- |
| STRK20 privacy pool | `0x0254a6b2…cfe0d91` | `0x040337b1…6ffe812a` |
| molfi market | `0x03b00e6e…a158b068` | not deployed |
| Price relay | `0x0275a7fd…456dfcbb` | not deployed, and should not be |
| Settles against | the relay | Pragma directly |

### Why Sepolia needs a relay

Pragma stopped publishing to Sepolia months ago — BTC's last print there is close to a year
old — so a market deployed against it can be opened and can never resolve. `PriceRelay`
republishes **mainnet Pragma's own median** onto Sepolia, presenting the same interface, so
the identical settlement path runs against a real multi-publisher price.

It is not an oracle. It is a relay with one publisher, us, and every value it serves carries
the mainnet block it was read at so the number can be checked against the chain it came from.
It serves Pragma's timestamp rather than its own, because returning the relay time would let
a stale price pass a freshness check it should fail. On mainnet it is not deployed at all.

Mainnet spends real STRK, so it stays a deliberate, human-run step. `pnpm preflight` checks
everything that can be checked without spending anything, and currently passes.
