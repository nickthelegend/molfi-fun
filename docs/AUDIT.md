# Contract audit — molfi, before mainnet

> **All three findings below are fixed** in the commit that follows this file, along with a
> fourth thing the fixing turned up: finding 2 existed in **two** places, not one, and the
> boundary had no test at all — changing the public route alone passed all 116 existing tests.
> Three tests now pin it. The findings are kept in full rather than rewritten as a changelog,
> because what was wrong and why is the useful part.

Read against `cairo/src/` at the commit this file lands in. Every finding below was reached by
reading the money paths and the privacy paths line by line, and each one names the file and the
condition rather than a category. Where something is safe, the reason it is safe is written
down, because "no finding" is only useful if you can see what was looked at.

**Scope.** `market.cairo` (the range game), `updown.cairo` (the direction game),
`pricing.cairo` (the shared kernel), `relay.cairo` (testnet only, not deployed to mainnet),
`objects.cairo` (type definitions). `devnet.cairo` is excluded: it is a pair of test doubles
and `scripts/deploy.mjs` refuses to put it on anything but a local devnet.

---

## Findings

### 1 · `open_inner` omits `paid` from its solvency check — latent, not exploitable

`market.cairo`, `open_inner`:

```cairo
let backing = m.staked + amount.into() + m.bankroll;
assert(m.reserved + payout <= backing, errors::OVER_RESERVED);
```

`claim_position` checks `m.paid + payout <= m.staked + m.bankroll`. This one does not subtract
`m.paid`, so on a market that had already paid out it would authorise reservations against
money that has left the contract.

**Why it cannot fire today.** A claim requires `is_settled`, and an open requires both
`!is_settled` and `get_block_timestamp() < m.cutoff_at`. The two windows do not overlap, so
`m.paid` is necessarily zero whenever this line runs.

**Why it is still a finding.** The safety of this line lives entirely in a property of a
different function. Anything that ever allows opening on a settled market — a re-open feature, a
rollover, a market that settles early — turns a latent inconsistency into an insolvency, and the
line itself gives no hint that it depends on that. `updown.cairo` includes `r.paid` in the same
check for this reason; the range market should match before mainnet.

**Severity:** low today, high if the open window ever changes.
**Fixed:** `m.paid` is now in the sum, with the reasoning in the code rather than only here.

### 2 · A settled price exactly on a band edge loses

`market.cairo`, `claim_position`:

```cairo
assert(m.settled_price > band_low && m.settled_price < band_high, errors::OUT_OF_BAND);
```

The bounds are exclusive, so a price landing exactly on an edge pays nothing. The desk sells the
band as a range the price must finish *inside*, and nothing in the UI or the pricing tables says
the endpoints are excluded — `prob_inside` integrates over the closed interval, so the trader is
charged for an interval fractionally wider than the one they are paid on.

The probability of an exact hit at 8 decimal places is negligible, and that is precisely the
argument for making it inclusive: it costs nothing to be right, and an undocumented
house-favouring edge case is the kind of thing that reads badly when someone finds it rather
than when you disclose it.

**Severity:** very low in expectation, non-zero in credibility.
**Fixed, in both routes.** The first attempt changed `claim_position` only and every existing
test still passed — the pool route in `privacy_invoke`'s `claim` carried its own copy of the
comparison, and no test exercised a price on a boundary. Three now do: both edges pay, and one
unit past either still loses.

### 3 · Saturating subtraction hides an invariant violation

`market.cairo`, `claim_position`:

```cairo
m.reserved = if m.reserved > payout { m.reserved - payout } else { 0 };
```

`reserved` is incremented by exactly `payout` when a position opens and decremented by exactly
`payout` when it claims, and a position claims once. So `reserved >= payout` always holds, and
the `else` branch is unreachable. If it ever became reachable the accounting has already gone
wrong somewhere upstream, and silently clamping to zero is the worst response: it papers over
the bug and lets the market keep selling.

`updown.cairo` uses a plain `r.reserved -= full`, which panics on underflow. That is the correct
behaviour — a broken invariant should stop the transaction, not be rounded away.

**Severity:** low. It is a masked assertion, not a live bug.
**Fixed:** plain subtraction, so it halts instead of clamping.

---

## Checked, and sound

**Reentrancy.** Every state change precedes every external call. `claim_position` writes the
position as claimed and writes the market before it calls `transfer`; `claim_ticket` in
`updown.cairo` does the same. A hostile ERC-20 reentering a claim hits `ALREADY_CLAIMED`. A
reentrant claim of a *different* position is just a normal claim and re-reads the market from
storage, so its solvency check sees the updated figures.

**Stakes are measured, not believed.** Both contracts compare the token balance before and after
the transfer and refuse on a mismatch. This matters more than it looks: the pool's
`InvokeExternalInput` carries a contract address and calldata and nothing else, so the tokens
arrive by a separate action in the same transaction and the contract cannot infer from the call
that they did. Taking `amount` on trust would let anyone reaching `privacy_invoke` record a
position backed by nothing. It also catches fee-on-transfer tokens.

**The pool is the only caller of `privacy_invoke`.** `assert_pool()` first, before the operation
byte is even read, and an unknown operation panics rather than falling through.

**Route separation on claim.** A position opened through the pool records no owner, and
`claim_position` refuses it with `WRONG_ROUTE`; a public position records its opener and refuses
anyone else with `NOT_OWNER_OF_POSITION`. This is load-bearing rather than tidy: the secret
becomes public the instant a claim is in a block, so without the owner check the first observer
could resubmit it and take the payout.

**The band cannot be swapped after the fact.** The commitment is recomputed from the revealed
preimage, and `assert_band_matches` re-derives the reach ratios from that band and compares them
to the ones the position was priced with. A cheap wide band cannot be claimed as an expensive
narrow one.

**The price cannot be moved into a position.** The multiplier is fixed at open and priced about
the band's own midpoint rather than a spot the contract reads, so an oracle update landing in the
same block cannot change what a trader was sold.

**Oracle freshness is asserted both ways.** `age` is computed with an explicit branch rather than
an unsigned subtraction, so a print timestamped in the future does not wrap to a tiny age. Both
contracts refuse prints older than 900s or backed by fewer than three publishers.

**No owner withdrawal.** Neither contract has a sweep, a drain, or an upgrade hook. The bankroll
is committed once and can only leave as a payout. The cost of that is real and worth stating: the
Sepolia market currently holds **0.6 STRK more than it accounts for** — surplus, not deficit, so
no user is at risk — and there is no path to recover it.

**Settled prices are immutable.** `settle` writes the price once and refuses a second call.
`set_oracle` can repoint future settlement but cannot rewrite a market that already has one.

---

## Trust assumptions, stated rather than buried

These are not defects. They are the things a reader has to accept, and they should be visible
before mainnet rather than discovered after.

1. **The owner chooses each market's token.** A hostile token could misreport balances; the
   measured-delta pattern blunts that but does not remove it. On mainnet this is STRK.
2. **The owner can repoint the oracle** for future markets. Documented in the contract, logged
   with both addresses, and unable to touch a settled price.
3. **The owner lists markets and sets the edge.** They cannot take a position's money, but they
   choose what is on offer.
4. **The relay is a single publisher — us.** It exists only because Pragma stopped publishing to
   Sepolia. It must not be deployed to mainnet, where Pragma is read directly, and
   `scripts/deploy.mjs` enforces that.

---

## The privacy claim, checked against the code

**`updown.cairo` holds.** The direction is never a parameter to `open_ticket` and never a field
on `Ticket`. Both sides are sold at one multiplier, which is what stops the public `reserved`
figure disclosing which side a ticket took — a genuinely subtle channel, and the reason the quote
is symmetric by construction rather than by coincidence. Two tickets the same way are
byte-identical to two opposite ones, pinned by test.

**`market.cairo` holds in this repository and not on the deployed class.** The source stores
`low_off_1e8` / `high_off_1e8` — reach ratios with the price divided out. The class live on
Sepolia stores `band_low` / `band_high` in the clear, so on that deployment anyone can enumerate
a market's positions and read what each one bought. `/privacy` and `/verify` both say so, drawn
from the deployed ABI rather than a constant, and `pnpm verify` D13 fails until it changes.

**All of this is still undeployed.** The three fixes and the reach-ratio `Position` are all in
`market.cairo`, and a declare is the only way any of them reaches a chain — about 60 STRK, which
the deployer does not have. Until then the class live on Sepolia has the exclusive bounds, the
masked assertion, and the public band.
