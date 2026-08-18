import { Reveal, WordReveal } from "@/components/reveal";
import { SiteHeader, SiteFooter } from "@/components/chrome";
import { StatusDot } from "@/components/bits";
import { contractStatuses, blockNumber } from "@/lib/chain";
import { gameStatuses, keeperStats } from "@/lib/live";

/**
 * Rendered per request.
 *
 * The stat strip below used to be four hand-written numbers. On a page whose entire argument
 * is that you should not have to take its word for anything, hand-written numbers were the
 * weakest thing on it, so they are now read from the chain and from the keeper at load time.
 * That only works if the page is not cached.
 */
export const dynamic = "force-dynamic";

/**
 * molfi.fun
 *
 * A classic hero plus sections page. The products are understandable from a short
 * description, so the job is to state the promise, prove it is not marketing, and get out of
 * the way with one obvious next step.
 *
 * The proof burden here is unusual. Every project claims privacy, so the page leads with the
 * thing most of them will not print: what stays public. A privacy claim that names its own
 * edges is the only kind worth reading.
 */

interface Game {
  slug: string;
  name: string;
  kind: string;
  promise: string;
  why: string;
  seats: string;
  status: "open" | "soon";
}

const GAMES: Game[] = [
  {
    slug: "crewkill",
    name: "CrewKill",
    kind: "Social deduction",
    promise:
      "Six seats, four rounds, one pot. Some of the crew are impostors and nobody knows who, including the people running it.",
    why: "A seat is a commitment, never an address. If seats were addresses you could follow the money and read every role straight off the settlement.",
    seats: "6 seats",
    status: "open",
  },
  {
    slug: "poker",
    name: "Poker",
    kind: "Texas Hold'em",
    promise:
      "No dealer and no server. The players shuffle and deal between themselves, and the deal is proved correct rather than trusted.",
    why: "No single player can read a card. A hand opens only when enough players agree to open it.",
    seats: "2 to 9 seats",
    status: "open",
  },
];

const FAQ: Array<{ q: string; a: string }> = [
  {
    q: "Is this actually private, or is that just marketing?",
    a: "Partly private, and the parts that are not are printed on every game page. Your buy in is a public deposit that names your address. What it buys is that the game contract records a commitment instead, so the link between you and your seat is broken from that point on.",
  },
  {
    q: "If it is private, how do I know the result was fair?",
    a: "Because the secrets that make a game checkable are published once they stop mattering. During play nothing on chain says who did what. After it ends, anyone can recompute the outcome from published data and compare it against what the contract paid.",
  },
  {
    q: "Do I need to trust whoever runs the games?",
    a: "Not for anything that decides money. Roles, votes and payouts are settled by contract. The server runs the parts that are not money, such as where people are standing, and it cannot change an outcome.",
  },
  {
    q: "What do I need to play?",
    a: "A Starknet wallet and some STRK. Games run on Sepolia testnet today, so you can play with test funds before anything costs you.",
  },
  {
    q: "What happens if I lose my seat secret?",
    a: "You lose the payout, and nobody can recover it. That secret lives in your browser and is the only thing that can claim your winnings, so each game offers a copy and a download at the moment it is created.",
  },
  {
    q: "Why build games this way at all?",
    a: "Because these specific games do not work without it. Take the privacy away and the deduction game is solvable by reading the chain, and the card game needs a dealer somebody has to trust.",
  },
];

export default async function Hub() {
  const [stats, services, contracts, head] = await Promise.all([
    keeperStats(),
    gameStatuses(),
    contractStatuses(),
    blockNumber(),
  ]);

  const contractsLive = contracts.filter((c) => c.live === true).length;
  const gamesUp = services.filter((s) => s.health === "up").length;

  return (
    <>
      <SiteHeader />

      <main id="main">
        {/* ── Hero ───────────────────────────────────────────────────────────────── */}
        <section className="mx-auto max-w-5xl px-6 pt-20 pb-24">
          <p className="text-sm font-medium text-[var(--text-dim)]">
            Staked games, settled on Starknet
          </p>

          <h1 className="hero-heading mt-4 max-w-[680px] text-5xl font-semibold tracking-tight sm:text-6xl">
            Games where the privacy
            <br />
            is the mechanic
          </h1>

          <p className="mt-6 max-w-[680px] text-lg text-[var(--text-dim)]">
            Buy in without putting your name on the table. Play. Settle onchain, where anyone
            can check the result once it no longer matters who did what.
          </p>

          <div className="mt-8 flex flex-wrap items-center gap-3">
            <a
              href="#games"
              className="fluid rounded-lg bg-white px-3 py-2 text-base font-semibold text-black hover:bg-[var(--accent)]"
            >
              Play a game
            </a>
            <a
              href="#how"
              className="fluid rounded-lg border border-[var(--line-2)] px-3 py-2 text-base font-semibold text-white hover:bg-[var(--surface)]"
            >
              See how it works
            </a>
          </div>

          <p className="mt-6 text-sm text-[var(--text-mute)]">
            Free to play on Sepolia testnet. No real money until you choose mainnet.
          </p>

          {/* Proof signal, read live rather than asserted.

              Every cell here came from a request made while this page was rendering. A cell
              whose source did not answer says so instead of showing a zero, because zero and
              unreachable look identical in a stat block and mean opposite things. */}
          <div className="mt-12 grid grid-cols-2 gap-px overflow-hidden rounded-2xl border border-[var(--line)] bg-[var(--line)] sm:grid-cols-4">
            <LiveStat
              value={`${gamesUp} of ${services.length}`}
              label="games responding"
              ok={gamesUp === services.length}
            />
            <LiveStat
              value={`${contractsLive} of ${contracts.length}`}
              label="contracts live on Sepolia"
              ok={contractsLive === contracts.length}
            />
            <LiveStat
              value={stats.reachable ? (stats.settled?.toLocaleString("en-US") ?? "—") : "offline"}
              label={stats.reachable ? "matches settled onchain" : "match counter"}
              ok={stats.reachable}
            />
            <LiveStat
              value={head === null ? "offline" : head.toLocaleString("en-US")}
              label={head === null ? "Sepolia node" : "Sepolia block"}
              ok={head !== null}
            />
          </div>
        </section>

        {/* ── Tagline reveal ─────────────────────────────────────────────────────── */}
        <section className="mx-auto max-w-5xl px-6 py-24">
          <WordReveal
            text="Most games ask you to trust the house. These ones let you check it afterwards, line by line, against the chain."
            className="max-w-[680px] text-4xl font-semibold tracking-tight sm:text-5xl"
          />
        </section>

        {/* ── Games ──────────────────────────────────────────────────────────────── */}
        <section id="games" className="mx-auto max-w-5xl px-6 py-24">
          <Reveal>
            <h2 className="max-w-[680px] text-3xl font-semibold tracking-tight sm:text-4xl">
              Two games, both unplayable without it
            </h2>
            <p className="mt-4 max-w-[680px] text-lg text-[var(--text-dim)]">
              Privacy here is not a setting you switch on. Remove it and each of these stops
              being a game at all.
            </p>
          </Reveal>

          <div className="mt-10 grid gap-4 sm:grid-cols-2">
            {GAMES.map((game, i) => (
              <Reveal key={game.slug} delay={i * 120}>
                <article className="flex h-full flex-col rounded-2xl border border-[var(--line)] bg-[var(--surface)] p-6">
                  <div className="flex items-baseline justify-between gap-3">
                    <h3 className="text-xl font-semibold">{game.name}</h3>
                    <StatusDot
                      state={
                        services.find((s) => s.slug === game.slug)?.health ?? "unknown"
                      }
                      label={
                        services.find((s) => s.slug === game.slug)?.health === "up"
                          ? "responding"
                          : "not responding"
                      }
                    />
                  </div>

                  <p className="mt-1 text-sm text-[var(--text-mute)]">
                    {game.kind} · {game.seats}
                  </p>

                  <p className="mt-4 text-base text-[var(--text-dim)]">{game.promise}</p>

                  <p className="mt-4 rounded-xl bg-[var(--surface-2)] p-4 text-sm text-[var(--text-dim)]">
                    <span className="font-semibold text-white">Why it needs privacy.</span>{" "}
                    {game.why}
                  </p>

                  <div className="mt-6 flex flex-wrap items-center gap-3">
                    <a
                      href={`https://${game.slug}.molfi.fun`}
                      className="fluid inline-flex w-max rounded-lg bg-white px-3 py-2 text-base font-semibold text-black hover:bg-[var(--accent)]"
                    >
                      Play {game.name}
                    </a>
                    <a
                      href={`/${game.slug}`}
                      className="fluid inline-flex w-max rounded-lg border border-[var(--line-2)] px-3 py-2 text-base font-semibold no-underline hover:bg-[var(--surface-2)]"
                    >
                      How it works
                    </a>
                  </div>
                </article>
              </Reveal>
            ))}
          </div>
        </section>

        {/* ── How it works ───────────────────────────────────────────────────────── */}
        <section id="how" className="mx-auto max-w-5xl px-6 py-24">
          <Reveal>
            <h2 className="max-w-[680px] text-3xl font-semibold tracking-tight sm:text-4xl">
              Three steps, and one of them is public
            </h2>
          </Reveal>

          <ol className="mt-10 grid gap-4 sm:grid-cols-3">
            {[
              {
                n: "01",
                t: "Shield your stake",
                d: "You deposit into the STRK20 privacy pool. This step is public and names your address, which is why it is worth doing early and separately.",
              },
              {
                n: "02",
                t: "Take a seat",
                d: "The game contract records a commitment rather than an address. From here nothing onchain ties the seat back to you.",
              },
              {
                n: "03",
                t: "Settle and check",
                d: "When the game ends the secrets are published. Anyone can recompute the result and compare it to what the contract paid out.",
              },
            ].map((step, i) => (
              <Reveal key={step.n} delay={i * 120}>
                <li className="h-full rounded-2xl border border-[var(--line)] bg-[var(--surface)] p-6">
                  <div className="font-mono text-sm text-[var(--accent)]">{step.n}</div>
                  <h3 className="mt-3 text-lg font-semibold">{step.t}</h3>
                  <p className="mt-2 text-base text-[var(--text-dim)]">{step.d}</p>
                </li>
              </Reveal>
            ))}
          </ol>
        </section>

        {/* ── The honest part ────────────────────────────────────────────────────── */}
        <section className="mx-auto max-w-5xl px-6 py-24">
          <Reveal>
            <div className="rounded-2xl border border-[var(--line)] bg-[var(--surface)] p-6 sm:p-10">
              <h2 className="max-w-[680px] text-3xl font-semibold tracking-tight">
                What stays public
              </h2>
              <p className="mt-4 max-w-[680px] text-lg text-[var(--text-dim)]">
                Every privacy product should print this list and most do not.
              </p>
              <ul className="mt-6 grid gap-3 sm:grid-cols-2">
                {[
                  "Your deposit into the pool, including your address and the amount",
                  "Your withdrawal, the same way",
                  "The size of every pot and the stake per seat",
                  "Per round vote counts, though never who cast them",
                  "Every role and every ballot, once the game has finished",
                ].map((item) => (
                  <li
                    key={item}
                    className="rounded-xl bg-[var(--surface-2)] p-4 text-base text-[var(--text-dim)]"
                  >
                    {item}
                  </li>
                ))}
              </ul>
              <p className="mt-6 max-w-[680px] text-base text-[var(--text-mute)]">
                Deposits and withdrawals are public in every privacy pool. What these games buy
                you is that the middle is not.
              </p>
            </div>
          </Reveal>
        </section>

        {/* ── FAQ ────────────────────────────────────────────────────────────────── */}
        <section className="mx-auto max-w-5xl px-6 py-24">
          <Reveal>
            <h2 className="max-w-[680px] text-3xl font-semibold tracking-tight sm:text-4xl">
              Questions worth asking
            </h2>
          </Reveal>

          <div className="mt-10 divide-y divide-[var(--line)] overflow-hidden rounded-2xl border border-[var(--line)] bg-[var(--surface)]">
            {FAQ.map((item, i) => (
              <Reveal key={item.q} delay={i * 60}>
                <details className="group p-6">
                  <summary className="fluid cursor-pointer list-none text-lg font-semibold marker:content-none hover:text-[var(--accent)]">
                    {item.q}
                  </summary>
                  <p className="mt-3 max-w-[680px] text-base text-[var(--text-dim)]">
                    {item.a}
                  </p>
                </details>
              </Reveal>
            ))}
          </div>
        </section>

        {/* ── Final CTA ──────────────────────────────────────────────────────────── */}
        <section className="mx-auto max-w-5xl px-6 py-24">
          <Reveal>
            <div className="rounded-2xl border border-[var(--line)] bg-[var(--surface)] p-10 text-center">
              <h2 className="mx-auto max-w-[680px] text-4xl font-semibold tracking-tight">
                Play a hand nobody can read
              </h2>
              <p className="mx-auto mt-4 max-w-[680px] text-lg text-[var(--text-dim)]">
                Free on Sepolia testnet. Nothing costs you anything until you decide it should.
              </p>
              <a
                href="https://crewkill.molfi.fun"
                className="fluid mt-8 inline-flex rounded-lg bg-white px-3 py-2 text-base font-semibold text-black hover:bg-[var(--accent)]"
              >
                Play a game
              </a>
            </div>
          </Reveal>
        </section>
      </main>

      <SiteFooter />
    </>
  );
}

/**
 * One cell of the proof strip.
 *
 * The label changes with the state rather than the value alone: a failed read prints
 * "Sepolia node / offline" instead of "Sepolia block / offline", because the second reads
 * like a block number that happens to be missing and the first reads like what it is.
 */
function LiveStat({ value, label, ok }: { value: string; label: string; ok: boolean }) {
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
