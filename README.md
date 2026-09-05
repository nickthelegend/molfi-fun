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

## Layout

| Path | What it is |
| --- | --- |
| [`apps/hub/`](apps/hub) | molfi.fun. The site: the pitch, the markets, and the proof. |
| [`packages/protocol/`](packages/protocol) | Network wiring. Pool and token addresses as protocol facts rather than app config. |

## Run it

```bash
pnpm install
pnpm dev
```

## Networks

The contracts are network agnostic; only the pool address changes. Both live STRK20 pools are
pinned in [`packages/protocol/src/networks.ts`](packages/protocol/src/networks.ts) and checked
against the chain rather than trusted.

| Network | STRK20 privacy pool |
| --- | --- |
| Sepolia | `0x0254a6b2997ef52e9f830ce1f543f6b29768295e8d17e2267d672c552cfe0d91` |
| Mainnet | `0x040337b1af3c663e86e333bab5a4b28da8d4652a15a69beee2b677776ffe812a` |

Testnet only for now. Mainnet spends real STRK, so it stays a deliberate, human-run step.
