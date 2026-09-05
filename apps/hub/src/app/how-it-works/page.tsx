import type { Metadata } from "next";
import { SiteHeader, SiteFooter } from "@/components/chrome";

export const metadata: Metadata = {
  title: "How it works — molfi",
  description:
    "How a molfi position stays sealed until settlement: the STRK20 pool sandwich, the commitment, and what stays public.",
};

/**
 * The mechanism, stated once, honestly.
 *
 * A privacy claim that will not describe its own edges is marketing. This page names the
 * public legs before it names the private ones, because the deposit is the part a reader can
 * check against the chain themselves and disbelieving it costs them nothing.
 */

const STEPS: Array<{ n: string; title: string; body: string; public: string; hidden: string }> = [
  {
    n: "01",
    title: "Shield",
    body: "You deposit STRK into the STRK20 pool. This is an ordinary ERC-20 transfer and it names you.",
    public: "Your address, the amount, the time",
    hidden: "Nothing yet — this is the public leg",
  },
  {
    n: "02",
    title: "Open a position",
    body: "You pick a range and a horizon. The pool withdraws your stake to molfi's anonymizer contract and calls its privacy_invoke. The contract parks the stake against poseidon(tag, secret, market, band) and returns an empty span, so nothing is credited back yet.",
    public: "That the pool paid the contract",
    hidden: "Your range, your size, that it was you",
  },
  {
    n: "03",
    title: "The market runs",
    body: "The range either holds or it does not. Nobody can price against your position, crowd it, or copy it, because there is nothing on chain that says what it is.",
    public: "The total staked in the market",
    hidden: "Every individual position in it",
  },
  {
    n: "04",
    title: "Settle",
    body: "At the cutoff, anyone can settle the market. The contract reads a Pragma median and refuses a print that is stale or backed by too few publishers, then records the price, its timestamp and its source count.",
    public: "The settled price and when it was taken",
    hidden: "Who wins and who loses",
  },
  {
    n: "05",
    title: "Claim",
    body: "You prove you know the secret behind your commitment. The contract checks the band contains the settled price, marks it claimed once, approves the pool, and returns an OpenNoteDeposit crediting your open note.",
    public: "That the contract paid out, and how much",
    hidden: "Which position was paid, and whose",
  },
];

export default function HowItWorks() {
  return (
    <>
      <SiteHeader current="/how-it-works" />

      <main id="main" className="mx-auto max-w-3xl px-6 pt-16 pb-24">
        <p className="text-sm font-medium text-[var(--text-dim)]">The mechanism</p>
        <h1 className="mt-3 text-4xl font-semibold tracking-tight sm:text-5xl">
          Five steps, and
          <br />
          what each one leaks
        </h1>

        <p className="mt-6 text-lg text-[var(--text-dim)]">
          A privacy claim that will not describe its own edges is marketing. So each step below
          says what an observer can see as well as what they cannot.
        </p>

        <ol className="mt-12 space-y-px overflow-hidden rounded-xl border border-[var(--line)] bg-[var(--line)]">
          {STEPS.map((step) => (
            <li key={step.n} className="bg-[var(--surface)] p-6">
              <div className="flex flex-wrap items-baseline gap-3">
                <span className="font-mono text-sm text-[var(--text-mute)]">{step.n}</span>
                <h2 className="text-lg font-semibold tracking-tight">{step.title}</h2>
              </div>
              <p className="mt-3 text-[var(--text-dim)]">{step.body}</p>

              <dl className="mt-5 grid gap-3 sm:grid-cols-2">
                <div className="rounded-lg border border-[var(--line-2)] p-3">
                  <dt className="text-xs tracking-wide text-[var(--text-mute)] uppercase">
                    Anyone can see
                  </dt>
                  <dd className="mt-1.5 text-sm text-[var(--text-dim)]">{step.public}</dd>
                </div>
                <div className="rounded-lg border p-3" style={{ borderColor: "#1e4b52" }}>
                  <dt className="text-xs tracking-wide uppercase" style={{ color: "var(--accent)" }}>
                    Nobody can see
                  </dt>
                  <dd className="mt-1.5 text-sm text-[var(--text-dim)]">{step.hidden}</dd>
                </div>
              </dl>
            </li>
          ))}
        </ol>

        <h2 className="mt-16 text-2xl font-semibold tracking-tight">What this does not hide</h2>
        <ul className="mt-4 space-y-2 text-[var(--text-dim)]">
          <li className="flex gap-2.5">
            <span aria-hidden className="text-[var(--text-mute)]">—</span>
            Your deposit into the pool. It is a public ERC-20 transfer with your address on it.
          </li>
          <li className="flex gap-2.5">
            <span aria-hidden className="text-[var(--text-mute)]">—</span>
            Timing. Shielding and immediately opening a position narrows the set of people it
            could have been. Leave a gap.
          </li>
          <li className="flex gap-2.5">
            <span aria-hidden className="text-[var(--text-mute)]">—</span>
            The size of the pool you are hiding in. In a thin market, fewer positions means
            less cover, and no cryptography fixes that.
          </li>
        </ul>

        <h2 className="mt-16 text-2xl font-semibold tracking-tight">Why the price is checked</h2>
        <p className="mt-4 text-[var(--text-dim)]">
          Settlement reads a Pragma median on Starknet mainnet. Two things can go wrong with an
          oracle and they need different answers: a print can be old, meaning publishers
          stopped, or it can be backed by one publisher, meaning the median is a single opinion
          wearing a median&apos;s clothes. Either alone is disqualifying, so the contract
          refuses rather than settling every position in the market against a bad number.
        </p>
        <p className="mt-4 text-sm text-[var(--text-mute)]">
          This is not hypothetical. Pyth was the first choice and it no longer serves Starknet —
          its contracts are still deployed and every feed returns nothing, which is exactly the
          failure a freshness check is for.
        </p>
      </main>

      <SiteFooter />
    </>
  );
}
