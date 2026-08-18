# Deployments

Everything here is verifiable. Each address and hash below can be opened on Voyager or
queried directly against a Starknet node.

## Sepolia (live)

| What | Address |
| --- | --- |
| CrewKill | [`0x55ac4a110992e9ced1f3133a9bff040adaaa6aeee4ed57e9b9cb89cb7586ca`](https://sepolia.voyager.online/contract/0x55ac4a110992e9ced1f3133a9bff040adaaa6aeee4ed57e9b9cb89cb7586ca) |
| CKBALLOT | [`0x38cea8475ecba6984807bf50eebc2d6174672f567d709d8b74c661904ec3bb8`](https://sepolia.voyager.online/contract/0x38cea8475ecba6984807bf50eebc2d6174672f567d709d8b74c661904ec3bb8) |
| STRK20 privacy pool | `0x0254a6b2997ef52e9f830ce1f543f6b29768295e8d17e2267d672c552cfe0d91` |
| STRK | `0x04718f5a0fc34cc1af16a1cdee98ffb20c31f5cd61d6ab07201858f4287c938d` |

Deployment transactions, all confirmed `SUCCEEDED`:

| Step | Hash |
| --- | --- |
| Deploy CKBALLOT | [`0x14a0296edbd71f934b3732ab5e21e8a3fa02aa2b1cb80cc1de39da391c6f8ce`](https://sepolia.voyager.online/tx/0x14a0296edbd71f934b3732ab5e21e8a3fa02aa2b1cb80cc1de39da391c6f8ce) |
| Declare CrewKill | [`0x55542510b493effa787e4c2559aa0d245694fb3f4d261813e3df419fc4aa67e`](https://sepolia.voyager.online/tx/0x55542510b493effa787e4c2559aa0d245694fb3f4d261813e3df419fc4aa67e) |
| Deploy CrewKill | [`0x47c89bb978122b999be8180b9e0e506a354b7b4450a8b0f7571361f2a82b487`](https://sepolia.voyager.online/tx/0x47c89bb978122b999be8180b9e0e506a354b7b4450a8b0f7571361f2a82b487) |
| Hand ballot minting to the game | [`0xd21900721abc54c8ca1d4e4fe821ad05048703d47f9b64f5c5492ef34a4741`](https://sepolia.voyager.online/tx/0xd21900721abc54c8ca1d4e4fe821ad05048703d47f9b64f5c5492ef34a4741) |

Run `pnpm --filter @crewkill/keeper exec tsx scripts/verify-sepolia.ts` to check the
deployment yourself. It opens a real match with a real signed transaction, reads the state
back, and reports what passed.

## Mainnet

Not deployed. The `transactions` array in `strk20.json` stays empty until three real
mainnet transactions have touched the STRK20 pool at
`0x040337b1af3c663e86e333bab5a4b28da8d4652a15a69beee2b677776ffe812a`.

## Devnet

`deployments/devnet.json` is rewritten on every local deploy and is not stable across
runs. Use `pnpm devnet:up && pnpm deploy:contracts` to recreate it.

## RPC

The keeper reads `SEPOLIA_RPC` and falls back to a public endpoint. Point it at your own
node or an Alchemy key:

```
SEPOLIA_RPC=https://starknet-sepolia.g.alchemy.com/v2/<YOUR_KEY>
```

Keys live in `.env`, which is gitignored. Nothing in this repository contains one.

## Who deployed what

Six contracts back the two games, and they did not all come from here. The distinction
matters for the submission: listing somebody else's deployment without saying so reads as a
claim to have written it.

| Contract | Deployed by |
| --- | --- |
| CrewKill | This project |
| CKBALLOT | This project |
| Texas Hold'em table | [dpinones/mental-poker](https://github.com/dpinones/mental-poker) |
| Shuffle verifier | [dpinones/mental-poker](https://github.com/dpinones/mental-poker) |
| Decrypt verifier | [dpinones/mental-poker](https://github.com/dpinones/mental-poker) |
| Key aggregator | [dpinones/mental-poker](https://github.com/dpinones/mental-poker) |

The poker contracts were already live on Sepolia when this project's poker client was ported
from that repository, and the client points at them rather than redeploying. They are real
dependencies of a real integration, not work done here. The hub's contracts page labels each
one the same way, so nobody has to read this file to find out.

## Transactions

The four in `strk20.json` are CrewKill's own deployment, and all four are finalised:

| What | Status |
| --- | --- |
| Declare CrewKill | SUCCEEDED, ACCEPTED_ON_L1, block 13579652 |
| Deploy CrewKill | SUCCEEDED, ACCEPTED_ON_L1, block 13579657 |
| Deploy CKBALLOT | SUCCEEDED, ACCEPTED_ON_L1, block 13579627 |
| Hand ballot minting to the game | SUCCEEDED, ACCEPTED_ON_L1, block 13579666 |

No poker transaction is listed, because this project sent none.
