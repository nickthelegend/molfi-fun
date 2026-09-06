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

So the position is a commitment, never an address, and the band is never sent to the chain
at all. What the contract is told is how far the band reaches from its own midpoint — a pair
of ratios, with the price divided out — which is exactly enough to charge the right price and
nothing at all about what the position predicts.

## Two ways in

molfi has two routes into a market, and they hide different amounts. Both keep the band
sealed until settlement; that is the part molfi will not trade away for reach.

| | Via the STRK20 pool | Direct from your address |
| --- | --- | --- |
| Your band | hidden | hidden |
| How much you staked | hidden | **public** |
| That it was you | hidden | **public** |
| Wallet needed | one that speaks STRK20 | any Starknet account |

> **The class deployed on Sepolia today does not keep the band row.** Its `Position` struct
> stores `band_low` and `band_high` outright, so anyone can list a market's positions and read
> what each one bought. The contract in this repository replaced both fields with reach ratios
> and never stores the band — it has not been declared, because that costs about 60 STRK and
> the deployer does not have it. [molfi.fun/privacy](https://molfi.fun/privacy) and
> [molfi.fun/verify](https://molfi.fun/verify) both say so on the page, drawn from the deployed
> ABI rather than from a config file, so they retract themselves the moment a class without the
> band goes live. This note is here for the same reason.

The pool route is the better one and it is the default wherever the wallet supports it. The
direct route exists because for most of a year most wallets have not, and a market only one
kind of wallet can reach is a market nobody trades. molfi learned that the expensive way:
seventeen rounds settled on Sepolia against real oracle prices, every one of them with a
stake of zero.

## What stays private, and what does not

Every project claims privacy. This is the part most of them leave out.

| Sealed until settlement | Public, always |
| --- | --- |
| The band you picked *(on the class in this repo — not the one deployed; see above)* | That a position was opened |
| How wide it is — no, that one is public | The total staked in a market |
| How much you staked *(pool route)* | The price the market settled at |
| Which positions are yours *(pool route)* | Every payout the contract made |

Your deposit into the pool names you. What it buys is that the market never sees that name.
[molfi.fun/privacy](https://molfi.fun/privacy) states every claim per route, with the
mechanism behind each.

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

Markets settle on Starknet Sepolia unattended, against a price backed by ten to twelve
independent publishers — 48 of them so far. Nothing on those pages needs a wallet.

Rounds are currently listed at one hour (`KEEPER_TIER=1`), which is what a 5 STRK daily drip
from the Foundation faucet can keep settleable to its own cutoff; the console still offers 15m,
1h and 4h. The keeper funds itself from that faucet and pauses listing when it drops below its
floor, which it says on [molfi.fun/keeper](https://molfi.fun/keeper) rather than going quiet.

## Layout

| Path | What it is |
| --- | --- |
| [`cairo/`](cairo) | `MolfiMarket`, the anonymizer the pool invokes, and `PriceRelay`. 88 tests. |
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
