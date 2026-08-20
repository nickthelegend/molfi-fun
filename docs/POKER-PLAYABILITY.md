# Is poker actually playable?

Not yet proven, and this file records exactly how far it got and what blocks it, because
"untested, needs a funded wallet" has been the recorded answer for several runs and that
answer was wrong. A funded Sepolia wallet was never the real blocker.

## What was wrong, and is now fixed

Devnet mode had never worked. The reference's `deploy-sepolia` target ends with
`cp deployed-poker-sepolia.json → poker-ui/public/deployed-poker.json`, so the file the app
loads on devnet held Sepolia addresses. Devnet mode fetched contracts from one chain while
signing with another chain's prefunded accounts, and every action failed with a provider
error naming neither problem.

Both config files now declare their network and the app refuses one that disagrees with the
network it is running on. Verified: devnet mode reports "no texas_holdem address" instead of
silently pointing the table at Sepolia.

## What was proved

The contracts deploy to a local devnet and the deployed TexasHoldem class hash is
`0x06f9fa6d172c7104ce53c91969b88642bccc24192f12a8adda75d903a7ee761a` — identical to the one
live on Sepolia, so this is the same contract code, not a variant.

The reference's full 2-player hand script runs against it: it connects, loads both players,
loads the circuits and verification keys, and reaches the first on-chain proof submission.

## What blocks it

The hand fails at the key-ownership proof, inside the verifier, with `Option::unwrap failed`.

The cause is not a bug. Devnet was being pointed at `MockVerifier`, which decodes test-shaped
public inputs from felt pairs and cannot parse a real proof. The e2e generates genuine Noir
proofs through Barretenberg, so it needs the real Garaga verifiers — the same three that are
deployed on Sepolia.

Those three are generated Cairo of 7,700 to 10,900 lines each. They are compiling as this is
written and have consumed over 105 minutes of CPU at ~350% without finishing. That is normal
for Garaga verifier contracts and is the only thing standing between here and a played hand.

## The honest status

- CrewKill: **playable, proved.** Bought a seat with real signed transactions, the house
  agents filled the table, the match ran four rounds and settled, and it audits 5 of 5
  against an independent recomputation.
- Poker: **not yet played.** Contracts deploy, the harness runs, the blocker is a compile
  that has not finished. It will not be marked playable until a hand completes.

Deploying with `MockVerifier` would make the hand "pass" without verifying a single proof.
That is exactly the kind of green tick this project exists to argue against, so it is not
being done.
