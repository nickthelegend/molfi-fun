# 100 more, ranked

Third pass. The first list built CrewKill, the second made the hub read the chain instead of
asserting things about it. This one is about the ninety seconds a judge actually spends here,
and about the parts that break when something upstream restarts.

Scored impact x feasibility x fit, each out of 5. Fit does real work: several of these would
be genuinely impressive and are ranked down because they widen the pitch instead of sharpening
it, and a wide pitch is how a technically strong project loses to a narrow one.

## Tier 1 — build now

| # | Idea | Surface | Score |
| --- | --- | --- | --- |
| 1 | Deployment identity by address, so a restart cannot rewrite history | keeper | 125 |
| 2 | Transaction uniqueness scoped to deployment, not chain name | keeper | 125 |
| 3 | Retired deployments kept and labelled rather than overwritten | keeper | 100 |
| 4 | Live "what just happened" ticker on the hub, from real events | hub | 100 |
| 5 | Verifier shows the poseidon inputs, not just the verdict | crewkill | 100 |
| 6 | Seat-secret download as a file, not just a copy button | crewkill | 100 |
| 7 | Match countdown ring that reads phase time remaining | crewkill | 80 |
| 8 | Role reveal as a card flip, once, at kickoff | crewkill | 80 |
| 9 | Ejection cutscene with the airlock | crewkill | 80 |
| 10 | Vote-lock tick per confirmed ballot | crewkill | 80 |
| 11 | Hub ticker of settlements as they land | hub | 80 |
| 12 | Contract page shows bytecode size and declare cost | hub | 60 |
| 13 | Archive filter by outcome, ship and round count | crewkill | 60 |
| 14 | Verifier diff view when a check disagrees | crewkill | 75 |
| 15 | Deployment history page: every deployment, live or retired | hub | 75 |
| 16 | Keyboard shortcut overlay on `?` | crewkill | 60 |
| 17 | Sound cue per phase change, muted by default | crewkill | 45 |
| 18 | Task progress bar from real on-chain completions | crewkill | 60 |
| 19 | Impostor kill cooldown shown as a timer | crewkill | 45 |
| 20 | Copy-as-markdown for a verification result | crewkill | 45 |

## Tier 2 — worth building if time

21 Poker seat rotation so you sit at the bottom. 22 Showdown card flip stagger. 23 Chip stack
that scales with the real stack. 24 Dealer button that moves. 25 Side-pot display. 26 Action
timer ring per seat. 27 Fold animation to the muck. 28 Last-action badge that fades.
29 Hand-history export. 30 Pot-odds already built, extend to implied odds. 31 Table felt that
reads as felt. 32 Muck reveal on request. 33 Rabbit hunt after a fold. 34 Seat-relative colour
coding. 35 All-in equity readout. 36 Blind-level clock. 37 Sit-out toggle. 38 Rebuy flow.
39 Waiting-list for a full table. 40 Table chat with signed messages.

41 Hub leaderboard across both games. 42 Per-seat career stats. 43 Detective-pool explainer
with worked numbers. 44 Privacy score history. 45 Shield-timing coach. 46 Anonymity-set size
readout. 47 Note-lifecycle diagram. 48 Nullifier explainer. 49 Viewing-key primer.
50 Withdraw flow walkthrough.

51 Replay scrubber for a settled match. 52 Kill-cam of the last movement. 53 Heatmap of where
kills happen. 54 Per-map win rates. 55 Persona win rates. 56 Strategy-family comparison.
57 Agent decision log. 58 Round-by-round vote graph. 59 Ballot recovery visualiser.
60 Seed-commitment timeline.

61 Status page with real uptime. 62 Structured JSON-LD. 63 Changelog from git history.
64 Press kit. 65 Embeddable verification badge. 66 OG image per match. 67 Shareable result
card. 68 QR to a verification permalink. 69 Public REST docs. 70 SDK for third parties.

71 Mainnet deploy. 72 Real-pool house agents. 73 Proving service integration. 74 Indexer
integration. 75 Viewing-key custody. 76 Paymaster for gasless play. 77 Session keys.
78 Account abstraction. 79 Multi-chain. 80 L3 appchain.

81 Tournament mode. 82 Custom lobbies. 83 Private tables. 84 Friend lists. 85 Achievements.
86 Seasons. 87 Referrals. 88 Daily quests. 89 NFT skins. 90 Governance token.

91 i18n. 92 RTL. 93 Screen-reader pass on the map. 94 Reduced-motion audit. 95 High-contrast
theme. 96 Print stylesheet. 97 PWA install. 98 Offline archive. 99 Service-worker cache.
100 Load testing.

### Why the bottom half is the bottom half

Most of 71-100 are real product work that a real product would want, and almost none of it
helps a judge in ninety seconds. Several actively hurt: a governance token or NFT skins on a
privacy-pool game reads as unfocused. 71 is the mainnet deploy, which is a decision with money
attached rather than a task.
