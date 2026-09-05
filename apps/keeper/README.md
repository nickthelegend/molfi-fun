# @molfi/keeper

molfi needs nobody to run it. Settlement is permissionless — anyone may poke an expired
market — and that is a real property of the contract rather than a claim about it.

Which is also why, left alone, nothing happens. A market with no one watching stays open past
its cutoff, and a demo shows a countdown that never reaches zero. This is the somebody.

## What a cycle does

1. **Relay.** Reads mainnet Pragma's median and republishes it to the Sepolia relay. A print
   mainnet itself would refuse never crosses — the relay cannot improve a bad number and must
   not launder one.
2. **Settle.** Pokes every market past its cutoff. Anyone could do this; the keeper doing it
   is convenience, not control.
3. **List.** Opens and funds a fresh round for any pair whose latest has settled, so a visitor
   never lands on "no open markets". Funding happens in the same cycle: a market with no
   bankroll can sell nothing, and an unfunded listing is worse than no listing.

Every action is written to Postgres with its transaction hash and what the chain said, which
is the difference between "the market settles itself" as a claim and as something a stranger
can query.

## Endpoints

| path | what |
| --- | --- |
| `/health` | Whether it has run *recently*, not whether the process is up. A keeper that is alive and stuck is exactly the failure a health check exists to catch. |
| `/actions` | The ledger — every relay, settle and listing with its hash. |
| `/settled` | Markets that have resolved, with the price and publisher count they resolved on. |

## Configuration

| variable | |
| --- | --- |
| `MOLFI_MARKET` | the market contract |
| `MOLFI_RELAY` | the price relay |
| `MOLFI_TOKEN` | STRK |
| `KEEPER_ADDRESS` / `KEEPER_PRIVATE_KEY` | the signing account |
| `DATABASE_URL` | Postgres. Absent means no ledger, and the keeper still settles. |
| `KEEPER_CYCLE_MS` | default 60s |
| `KEEPER_BANKROLL` | what each new market is funded with |
| `KEEPER_LOW_BALANCE` | below this it stops listing but keeps settling |

**The key is a testnet key.** It signs relays, settlements and listings on Sepolia and holds
testnet STRK. It should still be rotated when this stops being a demo, because a key that has
been in a hosted environment is not a key you keep.
