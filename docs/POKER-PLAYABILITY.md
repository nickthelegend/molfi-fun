# Is poker actually playable?

Partly, and this file records exactly how far a hand gets on Sepolia against the real
verifiers, because the previous answers here were both wrong in different ways.

## Two wrong diagnoses, corrected

**"Needs a funded Sepolia wallet."** There is one. `.env.sepolia` holds a keeper account with
999 STRK and its key. That was true for several runs and never checked.

**"Blocked on compiling the Garaga verifiers."** They never needed compiling. All three are
already deployed on Sepolia, along with the table, and they are the ones the app points at.
The local build was only ever needed for devnet, and it consumed roughly a thousand minutes
of CPU across four contracts without producing an artifact before being abandoned.

## How far a hand gets

Against the real contracts on Sepolia, with real Noir proofs and no mock anywhere:

| Step | Result |
| --- | --- |
| Create table | Confirmed on chain |
| Player 0 key-ownership proof | Generated in ~0.6s, verified by the real Garaga verifier |
| Player 0 joins | Confirmed |
| Player 1 key-ownership proof | Generated in ~0.3s, verified |
| Player 1 joins | Confirmed, 2 of 2 seated |
| Aggregate public key | Computed from both players' shares |
| 52-card deck encrypted | Under the aggregate key |
| `start_game` with deck verification | Confirmed on chain |
| Shuffle permutation and re-encryption | Generated |
| Shuffle proof | Generated in 9.1s |
| Shuffle submission | **Rejected by the RPC** |

The rejection is `An unexpected error occurred` from `starknet_addInvokeTransaction`. A
52-card shuffle proof is very large calldata, and the public Cartridge endpoint declines it.
Everything before that point is real and confirmed.

## Two real fixes found on the way

**`cairoVersion` was being guessed.** The harness constructed accounts without stating it,
and starknet.js infers wrong for a freshly deployed OpenZeppelin account on Sepolia. Every
transaction then failed with `Account validation failed`, which names the symptom and not the
cause. Both players now state Cairo 1.

**A second player had to exist.** A hand needs two accounts and only one was funded. The
second was created, funded and deployed on Sepolia with real transactions. It then failed
until it held enough to cover a proof-verifying call — 5 STRK was not enough, 300 was.

## Honest status

- CrewKill: **playable, proved.** Bought a seat, the house agents filled the table, the match
  ran and settled, and it audits clean against an independent recomputation. Agents can also
  play it through MCP, and can be voted out.
- Poker: **plays up to the shuffle submission.** Table, both joins, key aggregation, deck
  encryption and deck verification all confirmed on chain with real proofs. The shuffle proof
  generates and is rejected in transit by the public RPC.

Nothing here is mocked to make it look further along. The remaining gap is a transport limit
on a large proof, and it is stated rather than worked around.
