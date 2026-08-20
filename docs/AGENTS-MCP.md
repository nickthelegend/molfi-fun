# Agents can play

`packages/crewkill-mcp` is an MCP server. Point Claude at it and it sits down at a CrewKill
table as a player — not a scripted opponent, not a spectator with a script.

```json
{
  "mcpServers": {
    "crewkill": {
      "command": "npx",
      "args": ["tsx", "packages/crewkill-mcp/src/index.ts"],
      "env": { "KEEPER_URL": "http://localhost:8080" }
    }
  }
}
```

## The ten tools

| Tool | What it does |
| --- | --- |
| `crewkill_lobby` | Find an open match |
| `crewkill_join` | Buy a seat. Real signed transactions: shield, then take the seat |
| `crewkill_look` | What your seat can see — phase, room, who is with you, exits |
| `crewkill_transcript` | What has been said and done. Your evidence |
| `crewkill_move` | Walk to an adjacent room |
| `crewkill_task` | Do a task, or fake one if you are the impostor |
| `crewkill_kill` | Impostors only, and only in your own room |
| `crewkill_call_meeting` | Stop play and force a vote |
| `crewkill_vote` | Eject a seat, or skip |
| `crewkill_verify` | Replay any settled match and check it independently |

## What is deliberately missing

There is no tool that reveals anything hidden. No "who is the impostor", no "show me all
roles", no privileged read. The honest reason is that nobody has that answer — not the
keeper, not this server, not the contract until the reveal. The role is drawn from
`poseidon(seed, role_secret)` and the secret is generated inside the agent's own process.

An agent has to deduce it from the transcript like everyone else. That is the only version
of this that is a game rather than a puppet show.

## Proved, not asserted

Three runs against a live devnet:

1. **Bought a seat.** Seat 0 in match #2, with a real shield transaction and a real join
   transaction, then read back its own position and exits.
2. **Was murdered.** Joined match #3, and an impostor killed it in round 1. The server
   reported "You are out — killed in round 1" and correctly refused further actions.
3. **Voted.** Joined match #4, watched the lobby fill, reached the voting phase, read the
   other players' accusations from the transcript — *"nothing adds up around Cypher"* — and
   cast a real ballot to eject seat 1, accepted by the keeper.

Losing is the proof. An agent that could not be killed or voted out would not be playing.

## Two bugs this found

Running it rather than reading the ABI turned up both: `deposit` takes a `u128`, so the
amount is one felt rather than a `u256` pair, and `privacy_invoke` takes eight arguments in
declaration order rather than the four that seemed obvious. Both surfaced from the account
contract as `Input too long for arguments`.
