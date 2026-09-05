import Link from "next/link";
import { MARKETS, POSITION_TAG, fmtStrk, secondsLabel } from "@molfi/sdk";
import { NETWORK } from "@/lib/rpc";
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

export default async function PrivacyPage() {
  const address = marketAddress();
  let totals = { markets: 0, staked: 0n, positions: "unknowable" as const };

  if (address) {
    try {
      const count = await readMarketCount(address);
      let staked = 0n;
      for (let id = 1; id <= Math.min(count, 24); id += 1) {
        staked += (await readMarket(address, id)).staked;
      }
      totals = { markets: count, staked, positions: "unknowable" };
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
        </header>

        <Group title="Hidden" tone="green">
          <Row
            what="Which band you bought"
            how={`The contract stores poseidon(${POSITION_TAG}, secret, market, low, high) and nothing else about the position. The band is inside the hash.`}
            evidence="Nothing on chain reveals a band until its holder claims."
          />
          <Row
            what="How much you staked"
            how="A position's stake is stored under the commitment, not under an address. Reading it requires knowing the commitment, and deriving that requires the secret."
            evidence="get_position takes a commitment. There is no by-address call and there cannot be one."
          />
          <Row
            what="Whether a position is yours"
            how="The pool calls the contract; the caller is always the pool. The contract never learns who initiated the transaction."
            evidence="assert_pool is the only caller check the contract makes."
          />
          <Row
            what="Your position count"
            how="Positions are keyed by commitment. Two positions from one person and two from two people are indistinguishable."
            evidence="Even molfi cannot count them — this page cannot show you a number for it."
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

function Row({ what, how, evidence }: { what: string; how: string; evidence: string }) {
  return (
    <div className="rounded-xl bg-[#131313] p-4">
      <p className="text-[14px] font-semibold leading-snug">{what}</p>
      <p className="mt-1.5 text-[12px] leading-relaxed text-white/55">{how}</p>
      <p className="mono mt-2 text-[10px] leading-relaxed tracking-wide text-white/30">
        {evidence}
      </p>
    </div>
  );
}
