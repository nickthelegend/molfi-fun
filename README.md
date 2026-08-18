# CrewKill

**Staked social deduction on Starknet. Your wallet never touches the table, your role is a
secret even we can't read, and reading the room correctly pays even when you lose.**

Built for the [STRK20 Private Sprint](https://github.com/starkience/strk20-hackathon).
CrewKill was previously a spectator game on OneChain testnet where humans bet on AI agents.
This is the rebuild: humans now *play*, stakes are real, and every rule that decides money
lives in a Cairo contract that settles itself.

---

## The one-paragraph version

A match has N seats. You buy one by staking through the STRK20 privacy pool, so the game
contract records a commitment and never an address. When the roster locks, the chain fixes a
seed from the operator's pre-commitment plus every player's — and each seat's role falls out
of `poseidon(seed, your_role_secret)`. Only you can compute it. Not the other players, not
the servers, not us. You vote by *spending a ballot note* through the pool, so the tally is
public and the ballots are not. At the end, seats publish their role secrets, a
permissionless `settle` replays the whole match on-chain, and the pot splits. A slice of it —
the **Detective Pool** — goes to anyone who voted for a real impostor, weighted toward
earlier rounds, *whether or not their side won*.

---

## Why it is unusual

**Nobody can read the roles, including the operator.** Most on-chain social deduction hands
role assignment to a trusted server that then knows everything. Here the role draw needs
`role_secret`, which never leaves your browser. The operator commits its half of the
randomness before the lobby opens and cannot change it; you commit yours before the seed is
public and cannot grind it. It is a real commit-reveal, and the thing being protected is not
just fairness but *confidentiality* — the server literally cannot tell you who the impostors
are because it does not have the inputs.

**The number of impostors is itself hidden.** Every seat draws independently at
`impostor_bps`, so a match might have one impostor, or three, or none at all. That falls
straight out of the cryptography — an exactly-K assignment would require someone to know the
whole mapping — and it turns out to be the better game. You are not deducing *who* against a
known count; you are deducing whether there is anyone to catch. A "ghost ship" match plays to
its full length, because ending it early would announce the twist.

**A vote is a spent note.** Ballot notes (`CKBALLOT`) are issued into your shielded balance
when you buy a seat. Casting a vote spends one through the pool, which proves you own *a*
ballot without revealing *which*. The game contract increments a counter and learns nothing
else. This is the anti-bribery property: a briber cannot verify a bribe was honoured, because
there is nothing to check.

**The Detective Pool.** 12% of the pot is set aside before play. It pays out to anyone whose
ballots named a seat that turned out to be an impostor, weighted so an early read is worth
more than a late one. You can lose the match and still get paid for being right, which gives
a dead crewmate and a doomed round something to play for. We could not find prior art for
this as a staked on-chain mechanic.

**Empty seats fill themselves.** Any seat humans do not buy is taken at kickoff by a house
agent that stakes real value from the treasury and plays a persona carried over from the
original CrewKill. A funded match always runs on schedule — which is the whole answer to
"will strangers coordinate in real time to deposit into a group wager".

**It is still the game you built.** The Skeld's fourteen rooms, the vent network, the cameras
in Security, four kinds of sabotage, kill cooldowns, one emergency meeting per seat, tasks
that take two rounds of standing in the right room — all ported from the OneChain
`GameStateManager`, along with all ten agent behavioural styles. Opening positions and task
assignments come from `final_seed`, so even the starting spread is unbiasable; movement after
that is free, because the game is about what people choose to do.

---

## What is private, and what is not

Being precise about this matters more than sounding impressive.

| Private | Public |
| --- | --- |
| Which wallet holds which seat | The pot, the stake, the seat count |
| Which seat cast which ballot | Per-round vote tallies |
| Every seat's role, during play | Every seat's role, after the reveal window |
| Which notes funded a stake or a payout | That a payout of size X was made |
| — | Where everyone is, what they have finished, who is dead |

Movement and tasks are deliberately public: they are the evidence a meeting argues about. A
game where nobody can see anything is not a deduction game.

Deposits into the pool are public and name the depositor — shield ahead of time and in a
separate transaction, and nothing on-chain ties the deposit to the seat. After the reveal
window the whole match becomes auditable: role secrets are published, so anyone can recompute
every receipt and check the settlement. Privacy during play, transparency after it.

### Residual risks we are not going to pretend away

- **The keeper knows the roles of agent seats**, because it generated their secrets. It
  cannot read a human's. An agent operator could also leak a role out of band; the mitigation
  is a staked bond if third-party agents are ever allowed, not cryptography.
- **Gameplay actions are keeper-attested.** Moving, working, venting, reporting and calling a
  meeting go through the keeper over HTTP, because at a pool fee per action an on-chain step
  would cost more than the stake. A seat is driven by a capability token only its holder can
  compute, bound trust-on-first-use. A griefer who won that race could stop a seat walking
  around the ship; they could not touch its role, its ballots, or a unit of its payout, all
  of which are on-chain.
- **`reveal_seat` is relayed by the keeper** so players do not have to stamp their own address
  next to their seat. The keeper does not log requesters, but it is a trusted relay, and a
  hostile one could correlate timing. Sending the reveal yourself is always possible.
- **Kill validity is enforced economically, not cryptographically.** A crewmate can spend a
  ballot as if it were a night action; settlement detects it from the published secrets and
  the bluffer forfeits their entire stake. That is a deterrent, not an impossibility proof.
- **This is a wagered game.** Seats cost real value and payouts are real. STRK20's viewing-key
  disclosure is the compliance posture, in line with the rest of the ecosystem; it is not a
  claim of regulatory compliance, and StarkWare has said as much about STRK20 generally.

---

## Architecture

```
Browser ──── privacy wallet (STRK20 Wallet API) ────┐
   │  role computed locally from a local secret     │
   │                                                ▼
   │                                        STRK20 privacy pool
   │                                                │  withdraw → privacy_invoke → credit
   ▼                                                ▼
Keeper API ──── reads ────────────────────► CrewKill (Cairo)
   │  phase clock, house agents, mirror            │  seats, ballots, settlement, payouts
   ▼                                                │
Postgres  ◄──────── indexed from ───────────────────┘
```

| Path | What it is |
| --- | --- |
| [`apps/hub/`](apps/hub) | molfi.fun. The hub itself: what this place is, and which games are open. Shares CrewKill's tokens and typefaces so the house reads as one house. |
| [`apps/crewkill/`](apps/crewkill) | CrewKill, at crewkill.molfi.fun. Its client and its keeper, kept together because they are one game. |
| [`cairo/`](cairo) | The contracts. `CrewKill` is both the settlement layer and a STRK20 anonymizer; `BallotToken` is the ballot note. 39 tests, including a full match through a mock pool. |
| [`apps/poker/`](apps/poker) | Poker, at poker.molfi.fun. Texas Hold'em with no dealer: the players shuffle and deal between themselves and each step is proved. Ported from [dpinones/mental-poker](https://github.com/dpinones/mental-poker), whose Sepolia verifier contracts it uses rather than redeploying. |
| [`packages/mental-poker/`](packages/mental-poker) | The poker cryptography: threshold ElGamal on Grumpkin, the shuffle and decrypt proofs, and the deck encoding both the table and the contracts agree on. |
| [`packages/protocol/`](packages/protocol) | Commitment scheme, types, personas, network config. Shared verbatim by the keeper and the browser. |
| [`apps/crewkill/keeper/`](apps/crewkill/keeper) | The ship (`game/world.ts`), the agent brains (`game/strategies.ts`, `game/memory.ts`), the phase clock, the chain mirror, and the read API. |
| [`apps/crewkill/web/`](apps/crewkill/web) | The client. Holds your seat secrets; the only thing that can compute your role. |

**The keeper cannot cheat.** It can only advance phases and play its own agents. Roles,
tallies, the win condition and every payout are computed by `settle`, which is permissionless
— anyone can call it and everyone gets the same answer, because the inputs are public and the
rules are in the contract.

### Check a match yourself

`/verify/<match>` on the CrewKill app replays any settled match from its published data and
puts its own answer next to the contract's, line by line. The recomputation runs in the
reader's browser: the keeper is asked for the published inputs and nothing else, so a server
that wanted to report a different outcome would have to change the seed or the role secrets,
both of which were committed before anyone knew what they would be.

You need no account, no wallet, and no part in the match. That is the point — "permissionless
settlement" is a claim until a stranger can run it.

Full protocol write-up: [`docs/PROTOCOL.md`](docs/PROTOCOL.md).

---

## Run it

A fresh clone needs one build step first. The Cairo artifacts and the Prisma client are
generated, so they are not in the tree:

```bash
pnpm install && pnpm setup
```


You need Docker, Node 24+, pnpm, and [Scarb + Starknet Foundry](https://github.com/software-mansion/starkup).

```bash
pnpm install
pnpm cairo:test                     # 23 Cairo tests
pnpm --filter @crewkill/protocol test   # cross-language hash vectors
```

A local devnet is a real Starknet chain with real accounts and real signatures — it just
costs nothing. A whole match runs on it end to end.

```bash
docker compose up -d postgres devnet
pnpm cairo:build

cd apps/keeper
cp .env.example .env                # then paste in a devnet account, see below
pnpm prisma:migrate
pnpm deploy:contracts               # writes deployments/devnet.json
pnpm dev                            # the keeper: clock, agents, API on :8080
```

Get a devnet account for `.env`:

```bash
curl -s -X POST http://localhost:5050/rpc -H 'content-type: application/json' -d '{"jsonrpc":"2.0","id":1,"method":"devnet_getPredeployedAccounts","params":{}}' | jq '.result[0]'
```

Then the client:

```bash
pnpm web:dev                        # http://localhost:3100
```

Click **Use devnet key**, **Stake and take a seat**, and play. Matches open on a loop; empty
seats fill with agents at kickoff.

Two scripts prove the thing works without a browser:

```bash
cd apps/keeper
pnpm exec tsx scripts/smoke.ts       # the contract layer: one match, start to finish
pnpm exec tsx scripts/human-e2e.ts   # the player path, against a running keeper
```

`human-e2e` buys a seat through the pool, derives its role locally, drives gameplay actions,
votes on-chain, reveals, settles and claims — asserting the chain agrees at every step.

Demo pacing is configurable so a full match fits in a minute:
`PHASE_LOBBY=8 PHASE_NIGHT=5 PHASE_MEETING=5 PHASE_VOTING=6 PHASE_REVEAL=8 pnpm dev`.

---

## Sepolia and mainnet

The contracts are network-agnostic; only the pool address changes. Both live pools are
pinned in [`packages/protocol/src/networks.ts`](packages/protocol/src/networks.ts) and
re-checked against the chain at boot:

| Network | STRK20 privacy pool |
| --- | --- |
| Sepolia | `0x0254a6b2997ef52e9f830ce1f543f6b29768295e8d17e2267d672c552cfe0d91` |
| Mainnet | `0x040337b1af3c663e86e333bab5a4b28da8d4652a15a69beee2b677776ffe812a` |

```bash
NETWORK=sepolia KEEPER_ADDRESS=0x… KEEPER_PRIVATE_KEY=0x… pnpm --filter @crewkill/keeper deploy:contracts
```

On a real pool the browser stops using a local key and talks to the user's privacy wallet
(`strk20InvokeTransaction`), so viewing keys stay in the wallet — see
[`apps/crewkill/web/src/lib/strk20.ts`](apps/crewkill/web/src/lib/strk20.ts). House agents on a real pool need
the Privacy SDK's proving service and discovery indexer; without those endpoints the keeper
disables agents at boot and says so, rather than pretending to run them.

**Live on Sepolia. Not on mainnet.** CrewKill and CKBALLOT are deployed and answering, and
every deployment transaction is finalised on L1 — the addresses and hashes are in
[`docs/DEPLOYMENTS.md`](docs/DEPLOYMENTS.md) and can be checked on Voyager. What has *not*
happened on Sepolia is a played match: the keeper has only ever been pointed at devnet, where
it has run 604 settlements through 21,000-odd signed transactions. Mainnet spends real STRK,
so it stays a deliberate, human-run step — see [`docs/DEPLOYING.md`](docs/DEPLOYING.md).

---

## Credits

The game itself is the original OneChain CrewKill: the Skeld map, the sabotage rules, the
vent and camera systems, the personas, and both strategy families are ported from
the original OneChain build. What is new is everything underneath — Cairo contracts, the
commitment scheme, the anonymizer, private staking and ballots, and the Detective Pool.

MIT. See [`LICENSE`](LICENSE).
