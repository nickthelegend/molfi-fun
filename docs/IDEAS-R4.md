# 100 more, ranked

Fourth pass, written after the test plan found the shared header breaking fourteen pages at
once and after the devnet restart took the whole stack down. The theme this time is the gap
between "the demo works on my machine right now" and "this is a product": both games actually
playable end to end, and the stack surviving the things that killed it twice today.

Scored impact x feasibility x fit. Fit does real work: several would be impressive and are
ranked down for widening the pitch rather than sharpening it.

## Tier 1 — the demo is not real without these

| # | Idea | Surface | Score |
| --- | --- | --- | --- |
| 1 | Poker playable end to end on devnet, with real Garaga verifiers not the mock | poker | 125 |
| 2 | Poker devnet config that actually points at devnet, not Sepolia | poker | 125 |
| 3 | A full 2-player hand proved: shuffle, deal, four betting rounds, showdown | poker | 125 |
| 4 | One command that brings the whole stack up from cold | repo | 100 |
| 5 | Stack survives a devnet restart without manual repair | keeper | 100 |
| 6 | Poker table state recovered after a refresh mid-hand | poker | 100 |
| 7 | Seat a second player from the same browser for a solo demo | poker | 80 |
| 8 | Poker hand history written to a real database | poker | 80 |
| 9 | Verifier for a poker hand, the way CrewKill has one | poker | 100 |
| 10 | Showdown that proves the winner from revealed cards | poker | 80 |

## Tier 2 — real polish

| # | Idea | Surface | Score |
| --- | --- | --- | --- |
| 11 | Card deal animation, one card at a time, seat order | poker | 60 |
| 12 | Chip motion from stack to pot on every bet | poker | 60 |
| 13 | Dealer button that moves each hand | poker | 45 |
| 14 | Action timer ring per seat | poker | 45 |
| 15 | Winner spotlight at showdown | poker | 60 |
| 16 | Side pots displayed when someone is all in | poker | 36 |
| 17 | Muck reveal on request | poker | 27 |
| 18 | Seat rotation so you always sit at the bottom | poker | 45 |
| 19 | Fold slides your cards to the muck | poker | 36 |
| 20 | Blind level clock | poker | 27 |

## Tier 3 — breadth

21 CrewKill kill cam. 22 Replay scrubber. 23 Heatmap of kill locations. 24 Per-map win rates.
25 Persona win rates. 26 Strategy comparison. 27 Agent decision log. 28 Round-by-round vote
graph extension. 29 Seed commitment timeline extension. 30 Emergency meeting cutscene.
31 Airlock ejection cutscene. 32 Task progress from real completions. 33 Kill cooldown timer.
34 Sabotage countdown. 35 Vent animation. 36 Camera view. 37 Body discovery. 38 Sabotage
repair minigame. 39 Crewmate walk cycle. 40 Ship ambience.

41 Hub leaderboard. 42 Career stats per seat. 43 Privacy score history. 44 Anonymity set
readout. 45 Shield timing coach. 46 Note lifecycle diagram. 47 Nullifier explainer.
48 Viewing key primer. 49 Withdraw walkthrough. 50 Detective pool calculator.

51 Embeddable verification badge for poker. 52 OG image per match. 53 Shareable result card.
54 QR for a poker hand. 55 Public REST docs for poker. 56 SDK for third parties. 57 Webhooks.
58 Uptime history chart. 59 Structured JSON-LD. 60 Press kit assets.

61 Mainnet deploy. 62 Real pool house agents. 63 Proving service integration. 64 Indexer
integration. 65 Viewing key custody. 66 Paymaster for gasless play. 67 Session keys.
68 Account abstraction. 69 Multi chain. 70 L3 appchain.

71 Tournament mode. 72 Custom lobbies. 73 Private tables. 74 Friend lists. 75 Achievements.
76 Seasons. 77 Referrals. 78 Daily quests. 79 NFT skins. 80 Governance token.

81 i18n. 82 RTL. 83 Screen reader pass on the map. 84 Reduced motion audit. 85 High contrast
already built, extend to poker. 86 Print stylesheet. 87 PWA install. 88 Offline archive.
89 Service worker cache. 90 Load testing.

91 Chaos testing the keeper. 92 Fuzzing the Cairo. 93 Formal verification. 94 Bug bounty page.
95 security.txt. 96 Rate limiting. 97 Admin console. 98 Anti collusion detection.
99 Analytics. 100 A/B testing.

### Why the bottom is the bottom

61 is the mainnet deploy: a decision with money attached, not a task. 71-80 are real product
work that would read as unfocused on a privacy-pool game. The top ten are the only ones that
change whether a judge can sit down and play both games, which is the thing this pass exists
to fix.
