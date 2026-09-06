# The three-minute demo

`strk20.json.demo_video` is empty and it is a hard submission requirement. This is the shot
list, timed, with the exact clicks. Everything in it is live and was verified working on
production; nothing here needs funding, a wallet, or a market to be open.

**Updated 2026-09-06, after the declare landed.** The beats that described the band leak as a
live failure now describe it as history, because it is — and the strongest single moment in the
demo is no longer the honest admission of a broken promise but the transaction that closed it:
a position opened at a band the chain never saw, settled against a ten-publisher median, and
paid `2.1026 STRK` on a `1.0513x` quote. Exact, and checkable.

Record at **414 × 900 or narrower** — the console is designed mobile-first and a wide window
puts it in a letterbox.

---

## 0:00 – 0:20 · The claim, and why it is not decoration

**Open `molfi.fun`.**

> "A prediction market where your position is a commitment, not an address. On a public chain
> your order is a signal before it is a trade — anyone watching can price against it. Take the
> privacy away and this is a worse version of every public prediction market."

The live strip under the console reads the chain: rounds settled, when the last one settled,
and the countdown on the next cutoff.

## 0:20 – 0:50 · What leaks, stated before anyone asks

**Click `Private`** → `/privacy`.

> "Every project claims privacy. This is the page that says what does *not* stay hidden."

Scroll the three groups: **Hidden**, **Public and it has to be**, **What an observer could
still infer**.

**There used to be a red banner here. Say why there isn't.**

> "Until the sixth of September this page carried a red box saying the deployed contract did
> not keep the main promise — that class stored the band in the clear. The fix cost sixty STRK
> to declare and that had not been paid. It has now. The box was drawn from the deployed
> contract's own ABI rather than a config flag, so it retracted itself the moment a class
> without the band went live. Nobody edited the page."

**Then read the live totals.** They say `2.0000 STRK staked` — the first real position this
market has ever held, and the number that was `0.0000` for fifty-two settled markets.

## 0:50 – 1:10 · The integration, not a description of it

Still on `/privacy`, scroll to **"The private order, as it is actually built"**.

> "This is the real `STRK20_ACTION[]` the wallet receives — built by the same function the
> console calls. Two actions: the pool withdraws the stake to the contract, then invokes it.
> The withdraw leg is not optional, because the pool's invoke carries no token and no amount."

## 1:10 – 1:35 · Check a position without owning it

**Click `Check any position yourself`** → `/verify`. Paste any commitment (or leave it —
the empty answer is honest and the page says why).

> "Commitments are public — they are indexed keys on every `PositionOpened` event. This reads
> `get_position` straight off the chain and lays out what an observer learns beside what they
> cannot. No wallet, no account, and it works from anyone's browser."

The page also carries the `starknet_getEvents` call that lists every commitment in a market.

## 1:35 – 2:25 · The product, running

**Go to `molfi.fun/play`** → **MENU** → **"Show me how it works, narrated"**.

Then stop touching it. Six captioned steps drive the real engine:

1. the price is a real exchange tape, replayed second by second
2. pick a band — tighter pays more
3. the contract is never told the band, only how far it reaches
4. fire — the stake is locked, the band sealed
5. the cutoff is a block timestamp, the ring drains toward it
6. it settles against the oracle's median, and anyone can recompute it

> "That is not a recording. The balance moves, the position is real, and it settles on the
> same pricing kernel the contract runs."

Let a settlement land so the payout counts up on the chart.

## 2:25 – 2:50 · Recompute it as a stranger

**Go to `molfi.fun/m/47`.**

> "Eleven checks, each with what the chain says and what recomputing it gives. And this" —
> **the Check it yourself card** — "is one line of curl against a public node nobody here
> operates. Same settled price."

Paste it into a terminal on camera if there is time. It returns `0x2ffb34` → `0.031445`.

## 2:50 – 3:00 · Who runs it

**Click `Who runs it`** → `/keeper`.

> "Settlement is permissionless — anyone can poke an expired market. This is just the
> somebody. It relays mainnet Pragma's median to Sepolia, settles what is due, and opens the
> next round. When it cannot, it says so: the badge on every page goes amber and the health
> check returns 503."

---

## Do not claim these on camera

- **That the band is hidden on the deployed contract.** It is not, and the site says so. The
  honest framing is stronger: this is a project that found its own gap and printed it.
- **That anyone has traded it.** `staked` is zero across all 49 markets — no route to open a
  position exists on the deployed class.
- **Mainnet.** Nothing is deployed there.

## After recording

1. Upload, get a public URL.
2. Put it in `strk20.json` → `demo_video`.
3. `pnpm submission` once a mainnet deploy exists, which rewrites the file from
   `deployments/mainnet.json` and refuses to name an address it cannot verify on chain.
