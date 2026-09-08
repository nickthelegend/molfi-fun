# molfi

**Prediction markets where nobody can see your position.**

You pick a price range, pick how long it has to hold, and stake on it. Your range and your
size stay sealed until the market settles, so nobody can front run you, copy you, or lean on
your position because they saw it coming.

---

## Live on Starknet mainnet

- **Live demo — [molfi.fun](https://molfi.fun)**
- **Demo video — [molfi.fun/molfi-demo.mp4](https://molfi.fun/molfi-demo.mp4)**
- **Public repository — [github.com/nickthelegend/molfi-fun](https://github.com/nickthelegend/molfi-fun)**

**Market contract** — [`0x215dc0b029cfa4d3671494ad4ddcd9ceede531867487a9970b094a665a3aaf9`](https://starkscan.co/contract/0x215dc0b029cfa4d3671494ad4ddcd9ceede531867487a9970b094a665a3aaf9)

**molfi.fun runs on this contract.** It reads **Pragma mainnet directly** — no relay, because
Pragma publishes to mainnet itself — and the keeper lists four one-hour rounds against it,
funded with house bankroll so the desk can take a position rather than refuse every one. The five pairs Pragma does not carry (SOL, XRP, DOGE, LINK, AVAX) were
deliberately **not** listed: a market whose oracle cannot be read is one that could take a stake and
never resolve.

### Mainnet transactions

Every one below succeeded on Starknet mainnet; the deployment set is finalised on Ethereum.

| # | What it did | Transaction |
| --- | --- | --- |
| 1 | Account deployed | [`0xd87d1a99356044…`](https://starkscan.co/tx/0xd87d1a993560448ca27ed54ab8b0b2f56aa34d01133d881928aa528fbb3524) |
| 2 | Deploy MolfiMarket | [`0x1b5c98db224b3e…`](https://starkscan.co/tx/0x1b5c98db224b3e1547363401480feb8449989011b02d868bb76a7c787393104) |
| 3 | Listed BTC/USD 14400s | [`0x5216ca2e525199…`](https://starkscan.co/tx/0x5216ca2e525199f2b8a9ab4ac252093e7ba4ea696d0c91f2686a9834039bddc) |
| 4 | Listed ETH/USD 14400s | [`0x5d013bcd0833a2…`](https://starkscan.co/tx/0x5d013bcd0833a2b6bef47de3aac8ac504df7fe43ae6baa8b4dd231fd92ba548) |
| 5 | Listed STRK/USD 14400s | [`0x427053cb94b8e3…`](https://starkscan.co/tx/0x427053cb94b8e3a167f00bd6c3568f1f2e183f14ef5617ffa820b8e2f8d32d0) |
| 6 | Listed WBTC/USD 14400s | [`0x32e99b955f617f…`](https://starkscan.co/tx/0x32e99b955f617fe80aadd8a8d5e27f47cab51eee44d0f73303fa6e6a79c51eb) |
| 7 | Sent bankroll for market 1 | [`0x4008e34322365b…`](https://starkscan.co/tx/0x4008e34322365bd19c07714dba5451cc1ddaf6c6711be2aaef4d35b806b2cff) |
| 8 | Funded market 1 | [`0x68791d225e83f5…`](https://starkscan.co/tx/0x68791d225e83f581bd18c66acd4516fcf91cfd14042e166d5a8f4a1903abc65) |
| 9 | Sent bankroll for market 2 | [`0x7445742d327a10…`](https://starkscan.co/tx/0x7445742d327a10a9395df7f82284c8af2cc04031c2e5ca1e63889293d13a24a) |
| 10 | Funded market 2 | [`0x1d7d11f35aae50…`](https://starkscan.co/tx/0x1d7d11f35aae5078e375cccc53a8cf86aebfb711eec7867b95e57bd266ec4f5) |
| 11 | Sent bankroll for market 3 | [`0x36733490c36806…`](https://starkscan.co/tx/0x36733490c36806889348b6ab0d3879b439699b4c88729b0e63393b06c012e62) |
| 12 | Funded market 3 | [`0x698df34713efea…`](https://starkscan.co/tx/0x698df34713efeac5b6da0424d7a9a139e6cc0b13517940a7a2111beb7271c1c) |
| 13 | Sent bankroll for market 4 | [`0x7a1bfd57939b05…`](https://starkscan.co/tx/0x7a1bfd57939b05f5245d3a945e32b04f913eb6a1280f42adb50c680804809b0) |
| 14 | Funded market 4 | [`0x3977ebb9896e69…`](https://starkscan.co/tx/0x3977ebb9896e69052857a2f18459e39792550514b5a5136c9052baddba8a76d) |
| 15 | Settled market 1 (BTC/USD) | [`0x4c0af89fe96650…`](https://starkscan.co/tx/0x4c0af89fe96650260a78e7a5897aed6908a71ef82088ff79f7b9a830de1de43) |
| 16 | Settled market 2 (ETH/USD) | [`0x454fab7db36f4b…`](https://starkscan.co/tx/0x454fab7db36f4b8d97da30b45e6ddd2d0555fd414eb4f4cb78490576545a3c) |
| 17 | Settled market 3 (STRK/USD) | [`0x69c3b6c5507e59…`](https://starkscan.co/tx/0x69c3b6c5507e59d742d4da9f66422ad4c60ee94bebd6b3be9e0cc46b6f650b6) |
| 18 | Settled market 4 (WBTC/USD) | [`0x1a9dd70496e244…`](https://starkscan.co/tx/0x1a9dd70496e244112bce6b9d98964278d3f17a4a033763e903e8cb5c5ba6dd7) |

`strk20.json` carries the same list in machine-readable form.

### Still to come

Three transactions **through the STRK20 pool itself** are the sprint's own bar and are not done
yet. molfi's pool route is built and shape-validated — `scripts/pool-probe.mjs` runs the deployed
pool's own `compile_actions` against exactly the actions molfi would send and gets as far as
`SUBCHANNEL_NOT_FOUND`, which means the withdraw and the `InvokeExternal` parsed, ordered and
replay-protected correctly. What it needs is a privacy-enabled wallet to sign them; molfi holds no
viewing key by design, so that step belongs to a person.

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

> **This is now true on the deployed class, and it was not until 2026-09-06.**
> The contract molfi ran on for its first fifty-two markets stored `band_low` and `band_high`
> outright, so anyone could list a market's positions and read what each one bought. The class
> now live — `0x053b1721…` — stores `low_off_1e8` and `high_off_1e8` instead: how far the band
> reaches from its own midpoint, with the price divided out. That prices a position exactly and
> says nothing about what it predicts.
>
> The first position opened on it reads, on chain, as
> `lowOff1e8 300000, highOff1e8 300000, stake 2e18` — and the band it was bought at appears
> nowhere. [molfi.fun/privacy](https://molfi.fun/privacy) and
> [molfi.fun/verify](https://molfi.fun/verify) both carried a red banner about the old leak,
> drawn from the deployed ABI rather than a config flag, and both retracted it by themselves
> the moment this class went live.

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

Markets settle on Starknet Sepolia unattended, against a price backed by eight to twelve
independent publishers. Four markets — BTC, ETH, STRK and WBTC — chosen because those are the
pairs Pragma aggregates from enough publishers to settle against. Nothing on those pages needs a wallet.

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
| [`apps/hub/`](apps/hub) | A small separate site — what molfi is, how it works, privacy and terms. Runs with `pnpm dev:hub`; it is not the console and does not need to be running for the desk to work. |
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
| molfi market | `0x053b1721…d3298f1f` | [`0x0215dc0b…65a3aaf9`](https://starkscan.co/contract/0x215dc0b029cfa4d3671494ad4ddcd9ceede531867487a9970b094a665a3aaf9) |
| molfi up/down | `0x07881b0c…45c17ce9` | not deployed — one contract was the budget, so mainnet is range-only |
| Price relay | `0x0275a7fd…456dfcbb` | not deployed, and should not be |
| Settles against | the relay | Pragma directly |
| What molfi.fun serves | — | **this one** |

### Why Sepolia needs a relay

Pragma stopped publishing to Sepolia months ago — BTC's last print there is close to a year
old — so a market deployed against it can be opened and can never resolve. `PriceRelay`
republishes **mainnet Pragma's own median** onto Sepolia, presenting the same interface, so
the identical settlement path runs against a real multi-publisher price.

It is not an oracle. It is a relay with one publisher, us, and every value it serves carries
the mainnet block it was read at so the number can be checked against the chain it came from.
It serves Pragma's timestamp rather than its own, because returning the relay time would let
a stale price pass a freshness check it should fail. On mainnet it is not deployed at all.

Mainnet spends real STRK, so it stayed a deliberate, human-run step — taken on 2026-09-07 and
listed transaction by transaction under **[Live on Starknet mainnet](#live-on-starknet-mainnet)**
above. `pnpm preflight` checks everything that can be checked without spending anything, and
currently passes.
