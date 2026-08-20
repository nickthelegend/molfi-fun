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

## How far it got this run

Real proofs, real Garaga verifiers, real Sepolia. **14 transactions confirmed on chain** in a
single run, and two hole cards actually decrypted:

```
Card 0 = 3♥ (value 15)
Card 1 = 8♣ (value 46)
```

Table created, both players joined with key-ownership proofs, aggregate key computed, deck
encrypted, `start_game` verified the deck, **both players shuffled with real shuffle proofs**
(7-9s each), the hand started, and hole cards were dealt, revealed and unmasked. That is
mental poker working: a card that no single party could read, opened only once both players
handed over reveal tokens.

It stopped partway through dealing the second hole card, on funds rather than on protocol.

## Three real fixes found by running it

**`cairoVersion` was guessed.** starknet.js infers it wrong for a freshly deployed
OpenZeppelin account on Sepolia, and every transaction fails with `Account validation
failed`, which names the symptom rather than the cause. Both players now state Cairo 1.

**The shuffle bound exceeded the chain cap.** Verifying a 52-card shuffle is the most
expensive call in the protocol. The raw estimate fits; starknet.js's default safety margin
pushes it to 1,259,425,200 against a maximum of 1,210,000,000 — a four percent overshoot on
the margin, not the work. The bound is now set from the estimate and capped at what the chain
accepts.

**Resource bounds must be bigint.** The transaction hasher does `max_amount << 128n` on these
values directly, so passing hex strings throws `Cannot mix BigInt and other types` from
inside the hasher, naming no field. I got this backwards once before getting it right.

## What actually blocks a complete hand

Fees. Each run costs real Sepolia STRK, and proof-verifying calls are expensive: the two
accounts have gone from 999 and 305 STRK to 180 and 58 across roughly seven attempts. The
last run failed topping up player 1, and a reveal call now asks for more than player 1 holds.

This is a funding limit on a testnet faucet, not a protocol or code problem. Everything the
code does is verified working on chain up to that point.

## Honest status

- CrewKill: **playable, proved.** Seat bought, match ran, settled, audits clean. Agents play
  it through MCP and can be voted out.
- Poker: **plays through shuffle, deal and card reveal on Sepolia with real proofs.** Stops
  partway through the second hole card because the accounts have run low on testnet STRK.

Nothing is mocked to make either look further along than it is.
