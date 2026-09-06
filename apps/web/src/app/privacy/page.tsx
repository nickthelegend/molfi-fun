import Link from "next/link";
import {
  MARKETS,
  MAX_MULTIPLIER_BPS,
  NETWORKS,
  POSITION_TAG,
  decodePrint,
  fmtStrk,
  maxStakeFor,
  pairId,
  secondsLabel,
} from "@molfi/sdk";
import { hash } from "starknet";
import { NETWORK, ORACLE_ADDRESS, bandIsOnChain, call } from "@/lib/rpc";
import { PrivateOrder } from "@/components/PrivateOrder";
import { marketAddress, readMarket, readMarketCount } from "@/lib/market-reads";

/**
 * What molfi hides, what it does not, and the chain data proving each.
 *
 * Every privacy project claims privacy. Almost none prints the leak surface, which is the
 * only part a reader cannot verify for themselves in an afternoon — and the part that
 * decides whether the claim is worth anything.
 *
 * So each row here is a specific thing an observer can or cannot learn, with the reason, and
 * where possible with the live value read from the chain. The uncomfortable ones are not at
 * the bottom.
 */
export const dynamic = "force-dynamic";
export const revalidate = 0;

export const metadata = {
  title: "molfi — what stays private",
  description:
    "Exactly what an observer can and cannot learn from a molfi position, with the chain data behind each claim.",
};


/**
 * The oracle's last median for a pair, as a plain integer.
 *
 * The privacy page needs a real price to draw a real band around; this is the same read the
 * health route makes. Returns null rather than throwing, because a page whose job is to
 * explain the design must still render when a node is having a bad minute.
 */
async function lastPrint(pair: string): Promise<bigint | null> {
  if (!ORACLE_ADDRESS) return null;
  try {
    const raw = await call(ORACLE_ADDRESS, hash.getSelectorFromName("get_data_median"), [
      "0x0",
      "0x" + pairId(pair).toString(16),
    ]);
    const price = decodePrint(raw).raw;
    return price > 0n ? price : null;
  } catch {
    return null;
  }
}

export default async function PrivacyPage() {
  const address = marketAddress();

  /**
   * Addresses read from the SDK, not from the browser's chain module.
   *
   * `lib/chain` is a client module. Imported into a server component its exports arrive as
   * client references, so `ADDRESSES` was plain `undefined` here and the guard below could
   * never pass — the section did not render and nothing said why. The network table is the
   * same source that module reads anyway.
   */
  const chain = NETWORKS[NETWORK];

  /**
   * Asked of the chain, not of this repository.
   *
   * The source stores a pair of reach ratios and never the band. The class deployed to
   * Sepolia predates that change and stores `band_low` and `band_high` outright — so on the
   * contract this page links to, the headline claim is currently false. A page about what
   * leaks cannot take its own word for it, and hardcoding either answer would make it wrong
   * on one side of the redeploy.
   */
  const bandLeaks = address ? await bandIsOnChain(address) : null;
  let totals = { markets: 0, staked: 0n, positions: "unknowable" as const };

  /**
   * A real market and a real band, so the action list below is the genuine article.
   *
   * The newest open market, priced around the midpoint of its own band — the same shape the
   * console paints by default. If nothing is open the section is simply not rendered, rather
   * than shown against a market that does not exist.
   */
  let order: {
    marketId: number;
    pair: string;
    bandLow: bigint;
    bandHigh: bigint;
    stake: bigint;
    open: boolean;
  } | null = null;

  if (address) {
    try {
      const count = await readMarketCount(address);

      /**
       * One bounded read, used for both numbers on this page.
       *
       * It used to read twenty-four markets for the staked total and then up to twelve more
       * looking for an open one. Against a slow node the whole block timed out and the page
       * silently lost its live figures — the section explaining the integration simply did
       * not render, with nothing to say why.
       */
      const recent = await Promise.all(
        Array.from({ length: Math.min(count, 12) }, (_, i) => count - i)
          .filter((id) => id >= 1)
          .map((id) => readMarket(address, id)),
      );

      totals = {
        markets: count,
        staked: recent.reduce((t, m) => t + m.staked, 0n),
        positions: "unknowable",
      };

      /**
       * The market the action list is built against: the newest open one, or failing that
       * simply the newest.
       *
       * Rounds are fifteen minutes and the keeper relists once the previous one settles, so
       * there are stretches with nothing open. Requiring an open market meant this section
       * vanished during them — a reader who happened to arrive in a gap saw no integration
       * at all, which is a worse lie than showing a closed round and saying it is closed.
       * Every field below is read from the chain either way; only whether the wallet would
       * be able to submit it right now changes, and the section says which.
       */
      const now = Math.floor(Date.now() / 1000);
      const live = recent.filter((m) => !m.isSettled && m.cutoffAt > now);
      const subject = live[0] ?? recent[0];
      if (subject) {
        // An open market carries no settled price, so the band is drawn around the oracle's
        // own last print for the pair — the same number the market will settle against.
        const spot = await lastPrint(subject.pair);
        if (spot) {
          const half = (spot * subject.sigma1e4) / 100_000_000n;
          order = {
            marketId: subject.id,
            pair: subject.pair,
            bandLow: spot - half,
            bandHigh: spot + half,
            /**
             * A size this market could actually sell.
             *
             * Priced at the widest multiplier the contract will ever quote, so the number is
             * acceptable whatever band the reader would have picked. Showing a round 5 STRK
             * against a desk carrying a 0.05 STRK bankroll would be an action list the chain
             * rejects — the one thing this section must not be.
             */
            stake:
              maxStakeFor(subject, MAX_MULTIPLIER_BPS) < 5n * 10n ** 18n
                ? maxStakeFor(subject, MAX_MULTIPLIER_BPS)
                : 5n * 10n ** 18n,
            open: live.length > 0,
          };
        }
      }
    } catch {
      // A dead node must not turn this page into an error. The claims below are properties
      // of the contract, not of whether we could read it just now.
    }
  }

  return (
    <main className="tiled min-h-dvh px-5 py-10">
      <div className="mx-auto w-full max-w-[620px]">
        <header className="rounded-[22px] bg-card p-6">
          <div className="label">molfi · what stays private · Starknet {NETWORK}</div>
          <h1 className="mt-2 text-[26px] font-extrabold leading-tight tracking-tight">
            On a public chain your order is a signal before it is a trade.
          </h1>
          <p className="mt-3 text-[13px] leading-relaxed text-white/55">
            That is the whole reason molfi exists, and it is also a claim you should not take
            on trust. Below is every specific thing an observer can and cannot learn, with
            the mechanism, and the live numbers where there are any.
          </p>
          <p className="mt-2 text-[13px] leading-relaxed text-white/55">
            Take the privacy away and molfi is a worse version of every public prediction
            market. That is the test the pitch has to pass.
          </p>

          {/* The two routes, stated before any claim is made about them. A page that lists
              what is hidden without saying which route it is describing is not an honesty
              page, it is a brochure. */}
          <div className="mt-4 grid gap-2 sm:grid-cols-2">
            <div className="rounded-xl bg-[#131313] p-4">
              <p className="text-[13px] font-semibold">Via the STRK20 pool</p>
              <p className="mt-1.5 text-[12px] leading-relaxed text-white/55">
                Hides the band, the size, and you. The pool is the caller, so the contract
                never learns who initiated anything. Needs a wallet that speaks STRK20.
              </p>
            </div>
            <div className="rounded-xl bg-[#131313] p-4">
              <p className="text-[13px] font-semibold">Direct from your address</p>
              <p className="mt-1.5 text-[12px] leading-relaxed text-white/55">
                Hides the band, and only the band. The chain sees that you staked and how
                much, never what on. Works from any Starknet account — which is why it
                exists: a market only one kind of wallet can reach is one nobody trades.
              </p>
            </div>
          </div>
        </header>

        {bandLeaks ? (
          <section className="mt-3 rounded-[22px] border border-red/40 bg-card p-6">
            <div className="mono flex items-center gap-2 text-[9.5px] tracking-[0.15em] text-red">
              <span
                aria-hidden
                className="h-1.5 w-1.5 rounded-[1px] bg-red"
                style={{ boxShadow: "0 0 6px rgba(232,69,60,.8)" }}
              />
              THE CLASS DEPLOYED HERE DOES NOT KEEP THIS PROMISE
            </div>
            <h2 className="mt-2 text-[18px] font-extrabold leading-snug">
              Right now, on this contract, the band is public.
            </h2>
            <p className="mt-2 text-[13px] leading-relaxed text-white/55">
              The class live at the address below stores <code className="text-white/70">band_low</code>{" "}
              and <code className="text-white/70">band_high</code> in each position, and every
              commitment is an indexed event key — so anyone can list this market&rsquo;s positions
              and read what each one bought. The contract in the repository replaced both fields
              with reach ratios and never stores the band, and it has not been deployed: the
              declare costs about 60 STRK and has not been paid.
            </p>
            <p className="mt-2 text-[13px] leading-relaxed text-white/55">
              This box is drawn from the deployed class&rsquo;s own ABI, read when you loaded the
              page. It disappears on its own when a class without the band is live — the page is
              not asserting this from a config file, and neither should you take it from one.{" "}
              <Link href="/verify" className="text-amber underline">
                Check any position yourself
              </Link>
              .
            </p>
          </section>
        ) : null}

        {order && order.stake > 0n && chain.privacyPool && chain.stakeToken && address ? (
          <PrivateOrder
            addresses={{ pool: chain.privacyPool, token: chain.stakeToken, market: address }}
            marketId={order.marketId}
            pair={order.pair}
            bandLow={order.bandLow}
            bandHigh={order.bandHigh}
            stake={order.stake}
            open={order.open}
          />
        ) : null}

        <Group title="Hidden" tone="green">
          <Row
            what="Which band you bought"
            how={
              bandLeaks
                ? `NOT ON THE CLASS CURRENTLY DEPLOYED. Its Position struct stores band_low and band_high outright, and commitments are indexed event keys — so anyone can enumerate this market's positions and read the band each one bought. The contract in this repository stores poseidon(${POSITION_TAG}, secret, market, low, high) and a pair of reach ratios instead, and never the band; it is not the class live at the address above.`
                : `The contract stores poseidon(${POSITION_TAG}, secret, market, low, high) and, to price it, how far the band reaches from its own midpoint — a pair of ratios with the price divided out. Never the band.`
            }
            evidence={
              bandLeaks
                ? "Read from the deployed class's own ABI just now, not from this repository. This row corrects itself the moment a class without the band is deployed."
                : bandLeaks === null
                  ? "The deployed class could not be read just now, so this claim is unverified rather than confirmed."
                  : "Nothing on chain reveals a band until its holder claims. True on both routes; it is the one claim molfi will not trade away for reach."
            }
          />
          <Row
            what="How much you staked"
            how="A position's stake is stored under the commitment, not under an address. Reading it requires knowing the commitment, and deriving that requires the secret."
            evidence="get_position takes a commitment. There is no by-address call and there cannot be one."
            only="pool"
          />
          <Row
            what="Whether a position is yours"
            how="The pool calls the contract; the caller is always the pool, and the position is stored with no owner at all. The contract never learns who initiated the transaction."
            evidence="A pool position's owner field is zero, and the secret is the only credential that claims it."
            only="pool"
          />
          <Row
            what="Your position count"
            how="Positions are keyed by commitment. Two positions from one person and two from two people are indistinguishable."
            evidence="Even molfi cannot count them — this page cannot show you a number for it."
            only="pool"
          />
        </Group>

        <Group title="Public, and it has to be" tone="amber">
          <Row
            what="That a position was opened, and in which market"
            how="Opening emits PositionOpened with the market id and the commitment. Without an event there is no way to know a market has activity at all."
            evidence="The commitment is in the event. The preimage is not."
          />
          <Row
            what="Each market's total staked and total paid"
            how="Conservation — that a market never pays more than the stakes and bankroll behind it — is only a promise if somebody can check it. Checking needs two numbers."
            evidence={
              address
                ? `${totals.markets} markets, ${fmtStrk(totals.staked, 4)} STRK staked across the recent ones.`
                : "No deployment on this network yet."
            }
          />
          <Row
            what="The amount credited when you claim"
            how="An open note's amount is plaintext by design — it is measured on chain at execution, so it could not have been fixed at proof time. Its owner is not."
            evidence="This is the pool's design, not molfi's choice."
          />
          <Row
            what="Shielding and withdrawing"
            how="Both are public ERC-20 legs. An address funding the pool is visible, and so is one withdrawing from it."
            evidence="The privacy is in what happens between them, not at the edges."
            only="pool"
          />
          <Row
            what="That your address staked, and for how much"
            how="A direct open is an ordinary transfer_from followed by open_position, both signed by you. Your address, the stake and the market are all in the block."
            evidence="Everything except the band. If that is too much, the pool route is the one to use."
            only="direct"
          />
          <Row
            what="How wide your band is"
            how="The two reach ratios are the price, and the price has to be checkable, so they are stored in the clear. They say a band is 0.4% wide; they say nothing about which 0.4%."
            evidence="A wide band and a narrow one are distinguishable. Where either sits is not."
          />
        </Group>

        <Group title="What an observer could still infer" tone="red">
          <Row
            what="Timing correlation"
            how="Shield 100 STRK and open a position a minute later, and an observer with both timestamps has a strong guess. The pool's anonymity set is only as large as its recent activity."
            evidence="Mitigation is behavioural, not cryptographic: shield ahead of time, in amounts that do not match what you then stake."
          />
          <Row
            what="Amount correlation"
            how="A shield of exactly 12.34 STRK followed by a claim of exactly 12.34 STRK links the two ends regardless of what happened in between."
            evidence="Round numbers and exact round-trips are the leak."
          />
          <Row
            what="Being the only participant"
            how="If one market has one position, the anonymity set for that position is one. Privacy is a property of the crowd, not of the cryptography."
            evidence="A quiet market is a transparent one, and molfi cannot fix that for you."
          />
          <Row
            what="Withdrawing to the address you shielded from"
            how="It joins both public legs into one identity, undoing everything the pool did in the middle."
            evidence="Use a fresh address. The console says so at the point of withdrawal."
          />
        </Group>

        <section className="mt-4 rounded-[22px] bg-card p-6">
          <div className="label">Why this page exists</div>
          <p className="mt-2 text-[13px] leading-relaxed text-white/55">
            The last group is the one most projects leave out. It is also the only one a user
            can act on — the cryptography is already doing its job, and the remaining leaks
            are behavioural. Naming them is worth more than another paragraph about
            zero-knowledge.
          </p>
          <div className="mt-5 flex gap-3">
            <Link
              href="/live"
              className="flex-1 rounded-full bg-amber-2 py-3 text-center text-[13px] font-extrabold text-black"
            >
              WATCH A MARKET SETTLE
            </Link>
            <Link
              href="/play"
              className="flex-1 rounded-full bg-[#242424] py-3 text-center text-[13px] font-semibold"
            >
              OPEN THE CONSOLE
            </Link>
          </div>
        </section>

        <p className="mt-4 text-center text-[11px] text-white/25">
          Rounds are {MARKETS[0].rounds.map((r) => secondsLabel(r.seconds)).join(" · ")} — long
          enough that the oracle can settle them honestly.
        </p>
      </div>
    </main>
  );
}

const TONES = {
  green: "text-green",
  amber: "text-amber",
  red: "text-red",
} as const;

function Group({
  title,
  tone,
  children,
}: {
  title: string;
  tone: keyof typeof TONES;
  children: React.ReactNode;
}) {
  return (
    <section className="mt-4 rounded-[22px] bg-card p-5">
      <div className={`label ${TONES[tone]}`}>{title}</div>
      <div className="mt-3 space-y-3">{children}</div>
    </section>
  );
}

/**
 * Which route a claim holds for.
 *
 * Omitted means both. molfi has two ways into a market and they hide different amounts, so a
 * page whose whole job is to be believed cannot state a claim without saying which one it is
 * about. "Pool only" is the honest label for everything the direct route gives up.
 */
type RouteScope = "pool" | "direct";

function Row({
  what,
  how,
  evidence,
  only,
}: {
  what: string;
  how: string;
  evidence: string;
  only?: RouteScope;
}) {
  return (
    <div className="rounded-xl bg-[#131313] p-4">
      <p className="text-[14px] font-semibold leading-snug">
        {what}
        {only ? (
          <span className="mono ml-2 rounded bg-white/8 px-1.5 py-0.5 align-middle text-[9px] tracking-[0.08em] text-white/45">
            {only === "pool" ? "VIA POOL ONLY" : "DIRECT ONLY"}
          </span>
        ) : null}
      </p>
      <p className="mt-1.5 text-[12px] leading-relaxed text-white/55">{how}</p>
      <p className="mono mt-2 text-[10px] leading-relaxed tracking-wide text-white/30">
        {evidence}
      </p>
    </div>
  );
}
