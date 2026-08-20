# Mainnet readiness

Run `NETWORK=mainnet pnpm --filter @crewkill/keeper exec tsx scripts/preflight-mainnet.ts`.
It reads only — it never signs, never writes, and never asks for a key it does not need.

## Current result: not ready, and nothing has been spent

| | Check | Result |
| --- | --- | --- |
| PASS | P1 | Chain is SN_MAIN |
| PASS | P2 | STRK20 pool deployed on mainnet |
| PASS | P3 | STRK token deployed |
| PASS | P4 | CrewKill builds, 700 KB sierra |
| PASS | P5 | Deployer configured |
| **BLOCK** | P6 | **Deployer account does not exist on chain** — fund it, then run `deploy-account.ts` |
| **BLOCK** | P7 | **Balance does not cover the deploy** — 0.00 STRK held |
| WARN | P8 | House agents need `PROVING_SERVICE_URL`, `INDEXER_URL`, `AGENT_VIEWING_KEY`. Contracts still deploy; no agents fill seats |
| PASS | P9 | No mainnet deployment file yet, which is correct before a deploy |

**6 of 9 clear, 2 blocking, 1 to be aware of.**

## What the two blockers actually need

Both are the same thing: a funded mainnet account. That spends real money, so it is a
deliberate human step and this repository will not take it. Once the deployer address holds
enough STRK, `deploy-account.ts` deploys the account and the preflight turns green.

The warning is separate and is an operator credential problem, not a money problem: house
agents on the real STRK20 pool need a proving service, a discovery indexer and a viewing key.
Without them the keeper disables agents at boot and says so rather than pretending to run
them, which means a mainnet deployment would have working contracts and no automatic seat
filling until those endpoints exist.

## What is already mainnet-shaped

Both pool addresses are pinned and verified live on their chains. The contracts are
network-agnostic — only the pool address changes. Deployment identity is keyed on contract
addresses rather than chain name, so a mainnet deployment cannot inherit testnet history.
Settlement is permissionless and independently checkable at `/verify/<match>`.
