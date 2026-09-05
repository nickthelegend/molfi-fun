import { Reveal, WordReveal } from "@/components/reveal";
import { SiteHeader, SiteFooter } from "@/components/chrome";
import { blockNumber } from "@/lib/chain";

/**
 * molfi.fun
 *
 * The promise, the reason it needs privacy, and one obvious next step.
 *
 * The proof burden here is unusual. Every project claims privacy, so the page leads with the
 * thing most of them will not print: what stays public. A privacy claim that names its own
 * edges is the only kind worth reading.
 */

export const dynamic = "force-dynamic";

const EDGES: Array<{ hidden: string; public: string }> = [
  { hidden: "The band you picked", public: "That a position was opened" },
  { hidden: "How much you staked", public: "The total staked in a market" },
  { hidden: "Whether you are long or short the range", public: "The price the market settled at" },
  { hidden: "Which positions are yours", public: "Every payout the contract made" },
];

export default async function Home() {
  const head = await blockNumber();

  return (
    <>
      <SiteHeader />

      <main id="main">
        {/* ── Hero ───────────────────────────────────────────────────────────────── */}
        <section className="mx-auto max-w-5xl px-6 pt-20 pb-24">
          <p className="text-sm font-medium text-[var(--text-dim)]">
            Prediction markets, settled on Starknet
          </p>

          <h1 className="hero-heading mt-4 max-w-[720px] text-5xl font-semibold tracking-tight sm:text-6xl">
            Nobody can see
            <br />
            your position
          </h1>

          <p className="mt-6 max-w-[660px] text-lg text-[var(--text-dim)]">
            Pick a price range, pick how long it has to hold, and stake on it. Your range and
            your size stay sealed until the market settles, so nobody can front run you, copy
            you, or lean on your position because they saw it coming.
          </p>

          <div className="mt-8 flex flex-wrap items-center gap-3">
            <a
              href="/how-it-works"
              className="fluid rounded-lg bg-white px-4 py-2.5 text-base font-semibold text-black no-underline hover:bg-[var(--accent)]"
            >
              Open a position
            </a>
            <a
              href="/how-it-works"
              className="fluid rounded-lg border border-[var(--line-2)] px-4 py-2.5 text-base font-semibold text-white no-underline hover:bg-[var(--surface)]"
            >
              See how it settles
            </a>
          </div>

          <p className="mt-6 text-sm text-[var(--text-mute)]">
            Free to trade on Sepolia testnet. No real money until you choose mainnet.
          </p>

          <div className="mt-12 grid grid-cols-2 gap-px overflow-hidden rounded-2xl border border-[var(--line)] bg-[var(--line)] sm:grid-cols-3">
            <Cell label="settlement" value="onchain" ok />
            <Cell label="position visibility" value="sealed" ok />
            <Cell
              value={head === null ? "offline" : head.toLocaleString("en-US")}
              label={head === null ? "Sepolia node" : "Sepolia block"}
              ok={head !== null}
            />
          </div>
        </section>

        {/* ── Tagline ────────────────────────────────────────────────────────────── */}
        <section className="mx-auto max-w-5xl px-6 py-24">
          <WordReveal
            text="A market where everyone can read your hand is not a market. It is a queue, and you are at the back of it."
            className="max-w-[720px] text-4xl font-semibold tracking-tight sm:text-5xl"
          />
        </section>

        {/* ── Why privacy is the mechanic ────────────────────────────────────────── */}
        <section id="why" className="mx-auto max-w-5xl px-6 py-24">
          <Reveal>
            <h2 className="max-w-[680px] text-3xl font-semibold tracking-tight sm:text-4xl">
              Privacy here is not a setting
            </h2>
            <p className="mt-4 max-w-[680px] text-lg text-[var(--text-dim)]">
              On a public chain your order is a signal before it is a trade. Anyone watching
              can price against it, crowd it, or get there first. Take the privacy away and
              this stops being a market you would want to be on the other side of.
            </p>
          </Reveal>

          <Reveal delay={120}>
            <div className="mt-10 grid gap-4 sm:grid-cols-2">
              <Panel
                title="Sealed until settlement"
                items={EDGES.map((e) => e.hidden)}
                tone="var(--accent)"
              />
              <Panel title="Public, always" items={EDGES.map((e) => e.public)} />
            </div>
          </Reveal>

          <Reveal delay={200}>
            <p className="mt-5 max-w-[660px] text-sm text-[var(--text-mute)]">
              The right hand column is the part most projects leave out. Your deposit into the
              pool names you. What it buys is that the market records a commitment instead of
              your address, so the link between you and your position stops there.
            </p>
          </Reveal>
        </section>

        {/* ── Final CTA ──────────────────────────────────────────────────────────── */}
        <section className="mx-auto max-w-5xl px-6 py-24">
          <Reveal>
            <div className="rounded-2xl border border-[var(--line)] bg-[var(--surface)] p-10 text-center">
              <h2 className="mx-auto max-w-[680px] text-4xl font-semibold tracking-tight">
                Take a position nobody can read
              </h2>
              <p className="mx-auto mt-4 max-w-[640px] text-lg text-[var(--text-dim)]">
                Free on Sepolia testnet. Nothing costs you anything until you decide it should.
              </p>
              <a
                href="/how-it-works"
                className="fluid mt-8 inline-flex rounded-lg bg-white px-4 py-2.5 text-base font-semibold text-black no-underline hover:bg-[var(--accent)]"
              >
                Open a position
              </a>
            </div>
          </Reveal>
        </section>
      </main>

      <SiteFooter />
    </>
  );
}

function Cell({ label, value, ok }: { label: string; value: string; ok: boolean }) {
  return (
    <div className="bg-[var(--surface)] px-4 py-5">
      <div
        className="font-mono text-2xl font-semibold"
        style={{ color: ok ? "var(--text)" : "#e0b06c" }}
      >
        {value}
      </div>
      <div className="mt-1 text-sm text-[var(--text-dim)]">{label}</div>
    </div>
  );
}

function Panel({ title, items, tone }: { title: string; items: string[]; tone?: string }) {
  return (
    <div className="rounded-xl border border-[var(--line)] bg-[var(--surface)] p-5">
      <p className="text-sm font-semibold" style={tone ? { color: tone } : undefined}>
        {title}
      </p>
      <ul className="mt-3 space-y-2">
        {items.map((item) => (
          <li key={item} className="flex gap-2.5 text-sm text-[var(--text-dim)]">
            <span aria-hidden className="text-[var(--text-mute)]">
              —
            </span>
            {item}
          </li>
        ))}
      </ul>
    </div>
  );
}
