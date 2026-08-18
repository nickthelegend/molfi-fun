import type { Metadata } from "next";
import { SiteHeader, SiteFooter } from "@/components/chrome";
import { CopyButton } from "@/components/bits";
import { shortHex } from "@/lib/chain";

export const metadata: Metadata = {
  title: "How the privacy works — molfi.fun",
  description:
    "Notes, nullifiers, viewing keys and the shield-to-withdraw lifecycle, explained against the STRK20 pool these games actually use.",
};

const SEPOLIA_POOL = "0x0254a6b2997ef52e9f830ce1f543f6b29768295e8d17e2267d672c552cfe0d91";
const MAINNET_POOL = "0x040337b1af3c663e86e333bab5a4b28da8d4652a15a69beee2b677776ffe812a";

/**
 * The mechanism, not the marketing.
 *
 * Every project on this track says "privacy pool". The interesting question is what the pool
 * actually stores and what it does not, and a page that answers it honestly - including the
 * parts that stay public - is worth more than any number of assurances.
 *
 * Ordered as the value moves, because that is how somebody reasons about whether they are
 * exposed: what is visible when I deposit, what changes, what is visible when I leave.
 */
const LIFECYCLE: Array<{
  step: string;
  title: string;
  visible: string;
  hidden: string;
}> = [
  {
    step: "01",
    title: "Shield",
    visible:
      "That your address deposited a specific amount of a specific token into the pool, and when.",
    hidden:
      "Nothing yet. This leg is a public ERC-20 transfer and it names you. Anyone claiming otherwise is describing a different system.",
  },
  {
    step: "02",
    title: "The note",
    visible: "That a commitment was added to the pool's tree. Not whose, not for how much.",
    hidden:
      "The owner, the amount, and which deposit it came from. The note is an encrypted UTXO; the chain holds its commitment, not its contents.",
  },
  {
    step: "03",
    title: "Spend",
    visible:
      "A nullifier, and a proof that some unspent note in the tree authorised this. The set it could have come from is every note ever added.",
    hidden:
      "Which note was spent. A nullifier is derived from the note's secret, so it can be checked against a spent-list without revealing which entry it corresponds to.",
  },
  {
    step: "04",
    title: "The game action",
    visible:
      "That the game contract received a seat purchase, a ballot, or a claim, and the commitment attached to it.",
    hidden:
      "Which address is behind it. The call arrives from inside the pool transaction, so the game never sees a sender to record.",
  },
  {
    step: "05",
    title: "Withdraw",
    visible:
      "That a recipient address received a specific amount, and when. This leg names somebody again.",
    hidden:
      "Which of the pool's notes funded it, and therefore which deposit it traces back to — unless the amounts and timing make it obvious, which is why stakes are uniform and timing is yours to control.",
  },
];

export default function HowPrivacyWorks() {
  return (
    <>
      <SiteHeader current="/how-privacy-works" />

      <main id="main" className="mx-auto max-w-5xl px-6 pt-16 pb-24">
        <p className="text-sm font-medium text-[var(--text-dim)]">The mechanism</p>
        <h1 className="mt-3 max-w-[720px] text-4xl font-semibold tracking-tight sm:text-5xl">
          What the pool hides,
          <br />
          and what it cannot
        </h1>

        <p className="mt-6 max-w-[680px] text-lg text-[var(--text-dim)]">
          Every project on this track says &ldquo;privacy pool&rdquo;. The question worth
          answering is what the pool actually stores, and the honest answer includes the parts
          that stay public. Both legs into and out of a pool are visible transfers that name an
          address. What changes is everything in between.
        </p>

        {/* ── Lifecycle ──────────────────────────────────────────────────────────── */}
        <ol className="mt-12 space-y-px overflow-hidden rounded-2xl border border-[var(--line)] bg-[var(--line)]">
          {LIFECYCLE.map((row) => (
            <li key={row.step} className="bg-[var(--surface)] p-6">
              <div className="flex flex-wrap items-baseline gap-3">
                <span className="font-mono text-sm text-[var(--text-mute)]">{row.step}</span>
                <h2 className="text-lg font-semibold tracking-tight">{row.title}</h2>
              </div>

              <div className="mt-4 grid gap-4 sm:grid-cols-2">
                <div className="rounded-xl border border-[var(--line)] p-4">
                  <p className="text-xs tracking-wide uppercase" style={{ color: "#e0b06c" }}>
                    Public
                  </p>
                  <p className="mt-2 text-sm text-[var(--text-dim)]">{row.visible}</p>
                </div>
                <div className="rounded-xl border border-[var(--line)] p-4">
                  <p
                    className="text-xs tracking-wide uppercase"
                    style={{ color: "var(--accent)" }}
                  >
                    Hidden
                  </p>
                  <p className="mt-2 text-sm text-[var(--text-dim)]">{row.hidden}</p>
                </div>
              </div>
            </li>
          ))}
        </ol>

        {/* ── Nullifiers ─────────────────────────────────────────────────────────── */}
        <h2 className="mt-16 text-2xl font-semibold tracking-tight">Why a nullifier is not an id</h2>
        <p className="mt-4 max-w-[680px] text-[var(--text-dim)]">
          A pool has to stop a note being spent twice without knowing which note was spent.
          The nullifier is how: it is derived from the note&apos;s own secret, so the same note
          always produces the same nullifier and no two notes produce the same one. The
          contract keeps a set of them and rejects a repeat.
        </p>
        <p className="mt-4 max-w-[680px] text-[var(--text-dim)]">
          What it cannot do is point back. Going from a nullifier to the note that made it
          means inverting a hash, so the spent-list is a list of things that happened attached
          to nothing that identifies who.
        </p>

        {/* ── Viewing keys ───────────────────────────────────────────────────────── */}
        <h2 className="mt-16 text-2xl font-semibold tracking-tight">Viewing keys, and who holds them</h2>
        <p className="mt-4 max-w-[680px] text-[var(--text-dim)]">
          Notes are encrypted, so you need a key to find your own. That key is a viewing key,
          it registers with the pool once, and it stays in your wallet. Nothing here ever
          receives it — on a real pool the browser drives{" "}
          <code className="font-mono text-sm text-[var(--accent)]">strk20InvokeTransaction</code>{" "}
          through the wallet rather than signing on its behalf.
        </p>
        <p className="mt-4 max-w-[680px] text-[var(--text-dim)]">
          That is also the honest limit on the house agents. Running them against a real pool
          would mean this server holding a viewing key, and it does not have one, so the
          keeper refuses to start them and says so rather than pretending.
        </p>

        {/* ── The pools ──────────────────────────────────────────────────────────── */}
        <h2 className="mt-16 text-2xl font-semibold tracking-tight">The pools these games use</h2>
        <p className="mt-4 max-w-[680px] text-[var(--text-dim)]">
          Not written by this project. These are the deployed STRK20 pools, and the keeper
          re-checks the address against the chain at boot rather than trusting its own config.
        </p>
        <ul className="mt-6 space-y-3">
          {[
            { network: "Sepolia", address: SEPOLIA_POOL },
            { network: "Mainnet", address: MAINNET_POOL },
          ].map((pool) => (
            <li
              key={pool.network}
              className="flex flex-wrap items-center justify-between gap-4 rounded-xl border border-[var(--line)] bg-[var(--surface)] p-4"
            >
              <span className="font-semibold">{pool.network}</span>
              <CopyButton
                value={pool.address}
                label={`${pool.network} privacy pool address`}
                short={shortHex(pool.address, 10, 6)}
              />
            </li>
          ))}
        </ul>

        <p className="mt-10 max-w-[680px] text-sm text-[var(--text-mute)]">
          The residual risk worth naming: a deposit and a stake in quick succession correlate
          by timing even though neither reveals the other directly. That is why CrewKill
          offers shielding as a separate step, scores how exposed your own sequence was, and
          tells you when you have made yourself easy to follow.
        </p>
      </main>

      <SiteFooter />
    </>
  );
}
