import type { Metadata } from "next";
import { SiteHeader, SiteFooter } from "@/components/chrome";
import { CopyButton } from "@/components/bits";
import { contractStatuses, shortHex } from "@/lib/chain";
import { keeperStats, toStrk } from "@/lib/live";

export const metadata: Metadata = {
  title: "Press kit — molfi.fun",
  description:
    "Descriptions at three lengths, the facts that are checkable, and what we will not claim.",
};

export const dynamic = "force-dynamic";

/**
 * Everything somebody writing about this would otherwise have to ask for.
 *
 * Including the last section, which is the part press kits normally leave out: the claims
 * this project will not make. A privacy project that lists its own limits is easier to write
 * about accurately, and being written about accurately is the whole point of a press kit.
 */
export default async function Press() {
  const [stats, contracts] = await Promise.all([keeperStats(), contractStatuses()]);
  const ours = contracts.filter((c) => c.origin === "ours");
  const live = contracts.filter((c) => c.live === true).length;
  const pot = toStrk(stats.potTotal);

  return (
    <>
      <SiteHeader current="/press" />

      <main id="main" className="mx-auto max-w-5xl px-6 pt-16 pb-24">
        <p className="text-sm font-medium text-[var(--text-dim)]">Press kit</p>
        <h1 className="mt-3 text-4xl font-semibold tracking-tight sm:text-5xl">
          The facts, at three lengths
        </h1>

        <h2 className="mt-14 text-2xl font-semibold tracking-tight">Descriptions</h2>

        <Block
          label="One line"
          text="Staked games where privacy is the mechanic, settled on Starknet and checkable by anyone afterwards."
        />
        <Block
          label="One paragraph"
          text="molfi.fun runs two games that do not work without privacy. CrewKill is social deduction where a seat is a commitment rather than an address, so no one — including the people running it — can read a role off the chain. Poker is Texas Hold'em with no dealer: the players shuffle and deal between themselves and every step is proved rather than trusted. Both settle onchain, and once a match is over the secrets that make it checkable are published, so a stranger can replay the whole thing and confirm the contract paid what it should have."
        />
        <Block
          label="What is unusual about it"
          text="Most privacy projects ask you to take the privacy on faith. This one publishes the inputs once they stop mattering, which means the fairness claim is falsifiable: anyone can take a finished match, recompute every role from the published seed and role secrets, and compare their answer against what the contract actually paid. A verifier for exactly that ships with the product, and it will say a match does not check out if it does not."
        />

        {/* ── Checkable facts ────────────────────────────────────────────────────── */}
        <h2 className="mt-14 text-2xl font-semibold tracking-tight">Checkable facts</h2>
        <p className="mt-3 max-w-[620px] text-[var(--text-dim)]">
          Read when this page loaded, not written down in advance.
        </p>
        <dl className="mt-6 grid gap-px overflow-hidden rounded-xl border border-[var(--line)] bg-[var(--line)] sm:grid-cols-2">
          <Fact label="Contracts answering on Sepolia" value={`${live} of ${contracts.length}`} />
          <Fact
            label="Written and deployed by this project"
            value={`${ours.length} — the rest are integrated dependencies`}
          />
          <Fact
            label="Matches settled onchain"
            value={stats.reachable ? String(stats.settled ?? 0) : "keeper offline"}
          />
          <Fact
            label="Signed transactions"
            value={stats.reachable ? (stats.transactions?.toLocaleString("en-US") ?? "—") : "keeper offline"}
          />
          <Fact label="Staked across them" value={pot ? `${pot} STRK` : "keeper offline"} />
          <Fact label="Network" value={stats.network ?? "unknown"} />
        </dl>

        <h2 className="mt-14 text-2xl font-semibold tracking-tight">Our contracts</h2>
        <ul className="mt-6 space-y-3">
          {ours.map((c) => (
            <li
              key={c.address}
              className="flex flex-wrap items-center justify-between gap-4 rounded-xl border border-[var(--line)] bg-[var(--surface)] p-4"
            >
              <div>
                <p className="font-semibold">{c.name}</p>
                <p className="mt-1 text-sm text-[var(--text-dim)]">{c.role}</p>
              </div>
              <CopyButton
                value={c.address}
                label={`${c.name} address`}
                short={shortHex(c.address, 8, 4)}
              />
            </li>
          ))}
        </ul>

        {/* ── What we will not claim ─────────────────────────────────────────────── */}
        <h2 className="mt-14 text-2xl font-semibold tracking-tight">What we will not claim</h2>
        <p className="mt-3 max-w-[660px] text-[var(--text-dim)]">
          The section press kits normally leave out. A privacy project that names its own
          limits is easier to write about accurately, which is the point of this page.
        </p>
        <ul className="mt-6 space-y-3">
          {[
            "That deposits are anonymous. Shielding is a public ERC-20 transfer and it names you. What it buys is that the game records a commitment instead, so the link stops there.",
            "That timing cannot deanonymise you. A deposit and a stake seconds apart correlate even though neither reveals the other. The game scores your own sequence and tells you when you have made yourself easy to follow.",
            "That the poker contracts are ours. The table and its three verifiers were deployed by the mental-poker project and this one integrates with them. They are labelled as such everywhere they appear.",
            "That the house agents run on the real STRK20 pool. That needs a proving service, an indexer and a viewing key this server does not have, so the keeper disables them at boot and says so.",
            "That anything here has run on mainnet. It has not. Everything is Sepolia and devnet.",
          ].map((claim) => (
            <li
              key={claim.slice(0, 24)}
              className="rounded-xl border border-[var(--line)] bg-[var(--surface)] p-4 text-sm text-[var(--text-dim)]"
            >
              {claim}
            </li>
          ))}
        </ul>
      </main>

      <SiteFooter />
    </>
  );
}

function Block({ label, text }: { label: string; text: string }) {
  return (
    <div className="mt-6 rounded-xl border border-[var(--line)] bg-[var(--surface)] p-5">
      <div className="flex items-center justify-between gap-4">
        <p className="text-xs tracking-wide text-[var(--text-mute)] uppercase">{label}</p>
        <CopyButton value={text} label={`${label} description`} short="copy text" />
      </div>
      <p className="mt-3 text-[var(--text-dim)]">{text}</p>
    </div>
  );
}

function Fact({ label, value }: { label: string; value: string }) {
  return (
    <div className="bg-[var(--surface)] p-4">
      <dt className="text-xs tracking-wide text-[var(--text-mute)] uppercase">{label}</dt>
      <dd className="mt-1.5 font-mono text-sm text-[var(--text)]">{value}</dd>
    </div>
  );
}
