# 100 more, ranked

A second pass, written after the port of the poker client and the split of molfi.fun
away from the game consoles. The first list was about making CrewKill exist. This one is
about the three surfaces being one product rather than three tabs that happen to share a
domain, and about the parts a judge touches in the first ninety seconds.

Scored impact x feasibility x fit, each out of 5. Fit is doing real work in the ranking:
several ideas that would be genuinely impressive are scored down because they widen the
pitch instead of sharpening it, and a wide pitch is how a good project loses to a narrow one.

## Tier 1 - build first (score 60+)

| # | Idea | Surface | I | F | Fit | Score |
| --- | --- | --- | --- | --- | --- | --- |
| 1 | Hub reads the live keeper and shows real match/pot counts, not prose claims | hub | 5 | 5 | 5 | 125 |
| 2 | Per-game pages at /crewkill and /poker with real contract addresses linked to a live explorer | hub | 5 | 5 | 5 | 125 |
| 3 | Service status per game, from a real health probe, so a dead demo is visible not silent | hub | 5 | 5 | 5 | 125 |
| 4 | Contract registry page listing all six deployed addresses with verified-on-chain class hashes | hub | 5 | 5 | 4 | 100 |
| 5 | OG/Twitter cards for all three apps so a shared link renders as a card | all | 4 | 5 | 5 | 100 |
| 6 | Error boundaries on every app so one thrown render never blanks the page | all | 5 | 4 | 5 | 100 |
| 7 | Poker: keyboard shortcuts for fold/check/call/raise with a visible legend | poker | 4 | 5 | 5 | 100 |
| 8 | Crewkill: full keyboard play - move, vote, confirm - with a shortcut overlay | crewkill | 4 | 5 | 5 | 100 |
| 9 | Real empty states everywhere, written for the case not generic | all | 4 | 5 | 5 | 100 |
| 10 | robots.txt + sitemap.xml generated from real routes | hub | 3 | 5 | 4 | 60 |
| 11 | Shared header/footer so the three surfaces read as one product | all | 4 | 5 | 5 | 100 |
| 12 | Poker: reconnect to an in-progress hand after refresh rather than dropping you | poker | 5 | 3 | 5 | 75 |
| 13 | Hub: a real "how the privacy works" explainer with the actual commitment formula | hub | 4 | 5 | 4 | 80 |
| 14 | Crewkill: spectate mode - watch a live match without a seat | crewkill | 5 | 4 | 4 | 80 |
| 15 | Copy-to-clipboard on every address and hash, with real feedback | all | 3 | 5 | 5 | 75 |
| 16 | Network mismatch banner when the wallet chain is not the app chain | poker+ck | 5 | 4 | 4 | 80 |
| 17 | Poker: hand-strength readout on your own cards, computed by the real evaluator | poker | 4 | 5 | 4 | 80 |
| 18 | Crewkill: match permalink that deep-links to a specific match id | crewkill | 4 | 5 | 4 | 80 |
| 19 | Loading skeletons matched to final layout so nothing jumps on arrival | all | 3 | 5 | 5 | 75 |
| 20 | 404 and 500 pages per app, in that app's own voice | all | 3 | 5 | 5 | 75 |

## Tier 2 - build if time (score 30-59)

| # | Idea | Surface | Score |
| --- | --- | --- | --- |
| 21 | Hub: live block height ticking from a real RPC call | hub | 60 |
| 22 | Poker: showdown card flip with a real stagger, one card at a time | poker | 60 |
| 23 | Crewkill: kill cam - replay the last movement before an ejection | crewkill | 48 |
| 24 | Poker: pot-odds hint on the betting panel, computed not hardcoded | poker | 60 |
| 25 | Crewkill: role reveal card that flips once at match start | crewkill | 48 |
| 26 | Hub: game cards that preview real gameplay rather than a static image | hub | 45 |
| 27 | Poker: seat-relative rotation so you always sit at the bottom | poker | 45 |
| 28 | Crewkill: minimap legend that names what each glyph means | crewkill | 45 |
| 29 | Focus-visible rings audited across every interactive element | all | 60 |
| 30 | Reduced-motion honoured in every animation, not just the hub | all | 60 |
| 31 | Poker: action timer ring per seat | poker | 36 |
| 32 | Crewkill: sound design - one short cue per phase change, muted by default | crewkill | 36 |
| 33 | Hub: press kit page with logos and a one-paragraph description | hub | 36 |
| 34 | Poker: chip-stack visual that scales with the real stack size | poker | 45 |
| 35 | Crewkill: task progress bar driven by real on-chain task completions | crewkill | 45 |
| 36 | Retry with backoff on every fetch, surfaced not swallowed | all | 48 |
| 37 | Poker: fold animation that slides your cards to the muck | poker | 36 |
| 38 | Crewkill: vote-lock animation on the ballot, one tick per confirmed vote | crewkill | 45 |
| 39 | Hub: FAQ answering the three questions a judge actually asks | hub | 45 |
| 40 | Per-app favicons that differ so three tabs are distinguishable | all | 45 |
| 41 | Poker: dealer button that actually moves each hand | poker | 36 |
| 42 | Crewkill: emergency meeting cutscene | crewkill | 36 |
| 43 | Hub: real changelog page from git history | hub | 36 |
| 44 | Poker: all-in side-pot display | poker | 27 |
| 45 | Crewkill: seat colours that are colourblind-safe and named | crewkill | 45 |
| 46 | Structured JSON-LD on the hub so search renders it richly | hub | 36 |
| 47 | Poker: last-action badge per seat that fades | poker | 36 |
| 48 | Crewkill: countdown ring on the phase timer | crewkill | 45 |
| 49 | Hub: link to the deployed contracts on a real explorer, per network | hub | 60 |
| 50 | Poker: table felt that reads as a table, not a div | poker | 36 |

## Tier 3 - lower priority (below 30, or scoped out)

51 Poker tournament mode. 52 Crewkill custom lobbies. 53 Hub leaderboard across both games.
54 Poker hand history export. 55 Crewkill replay scrubber. 56 Achievements. 57 Friend lists.
58 Chat. 59 Emotes. 60 Avatar customisation. 61 Mobile-native gestures. 62 Push notifications.
63 Discord bot. 64 Twitter bot posting results. 65 Referral codes. 66 Daily quests.
67 Season pass. 68 NFT skins. 69 Governance token. 70 DAO treasury page. 71 Staking tiers.
72 Rake dashboard. 73 Admin console. 74 Match reporting. 75 Anti-collusion detection.
76 Rate limiting per IP. 77 Captcha. 78 Email digests. 79 Analytics dashboard. 80 A/B testing.
81 i18n. 82 RTL support. 83 Print stylesheet. 84 PWA install prompt. 85 Offline mode.
86 Service worker cache. 87 WebSocket instead of poll. 88 Server-sent events. 89 GraphQL API.
90 Public REST docs. 91 SDK for third parties. 92 Webhooks. 93 Bug bounty page.
94 Security.txt. 95 Uptime status page. 96 Load testing. 97 Chaos testing. 98 Fuzzing the Cairo.
99 Formal verification. 100 Mainnet deploy.

### Why tier 3 is tier 3

Most of these are real features that a real product would want. Almost none of them help a
judge in the ninety seconds they will spend here, and several actively hurt: a governance
token or an NFT skin system on a privacy-pool game reads as unfocused, and unfocused is
the most common way a technically strong hackathon project loses. 100 is deliberately the
mainnet deploy, which is a decision with sixteen days on it and money attached, not a task.
