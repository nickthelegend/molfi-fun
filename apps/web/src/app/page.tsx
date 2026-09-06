import Link from "next/link";
import { ConsoleStage } from "@/components/ConsoleStage";
import { LiveStrip } from "@/components/LiveStrip";
import { Wordmark } from "@/components/Wordmark";
import { CoinMark, StarknetSpark } from "@/components/CoinMark";
import { Reveal } from "@/components/Reveal";

/**
 * The front door.
 *
 * One argument, made in the order a sceptic actually asks it: what is this, does it run, what
 * does it hide, who keeps it going. The console is the subject of the page rather than an
 * illustration on it — a handheld with a price on the glass says "prediction market" faster
 * than any sentence, and the sentence underneath then only has to say the part a picture
 * cannot: that nobody can see your position.
 *
 * Motion here is doing a job rather than decorating. Sections arrive as they are scrolled to,
 * which paces the argument instead of dumping it; the coin marks drift on a long loop so the
 * markets read as live; the primary key breathes so the eye lands on it. Every one of them is
 * removed under `prefers-reduced-motion` by the global rule in `globals.css`, which shortens
 * rather than deletes so a state change is still legible.
 */

/** One of the doors under the fold. Small, and the sub-label does the work. */
function Door({ href, label, sub }: { href: string; label: string; sub: string }) {
  return (
    <Link
      href={href}
      className="group rounded-xl bg-[#181818] px-2 py-3 text-center transition-all duration-200 hover:-translate-y-0.5 hover:bg-[#212121]"
    >
      <span className="block text-[12px] font-semibold">{label}</span>
      <span className="mono mt-0.5 block text-[9px] leading-tight tracking-wide text-white/35 transition-colors group-hover:text-white/55">
        {sub}
      </span>
    </Link>
  );
}

/** A claim and the mechanism behind it, side by side, because the mechanism is the argument. */
function Claim({ n, head, body }: { n: string; head: string; body: string }) {
  return (
    <div className="flex gap-3.5">
      <span className="mono mt-[3px] shrink-0 text-[10px] tabular-nums tracking-[0.1em] text-amber">
        {n}
      </span>
      <div className="min-w-0">
        <div className="text-[13.5px] font-semibold leading-snug">{head}</div>
        <p className="mt-1 text-[12.5px] leading-relaxed text-white/45">{body}</p>
      </div>
    </div>
  );
}

export default function Home() {
  return (
    <div className="relative min-h-dvh overflow-hidden">
      {/* Soft, out-of-focus ground so the card floats — the console is the subject. */}
      <div aria-hidden className="tiled absolute inset-0 scale-110 opacity-70 blur-[6px]" />
      <div
        aria-hidden
        className="absolute inset-0"
        style={{
          background:
            "radial-gradient(120% 80% at 50% 0%, rgba(0,0,0,0.25), rgba(0,0,0,0.9) 70%)",
        }}
      />

      <main className="relative mx-auto grid w-full max-w-[460px] gap-4 px-4 py-8">
        {/* ─────────────────────────────────────────────────────────── the device */}
        <section className="rounded-[26px] bg-card px-6 pb-7 pt-6 shadow-[0_40px_120px_rgba(0,0,0,0.7)]">
          <div className="flex justify-center text-amber">
            <Wordmark height={30} />
          </div>

          {/* The console, tilting on its own. The stage owns that; nothing here drives it. */}
          <div className="mt-4 h-[330px]">
            <ConsoleStage />
          </div>

          <LiveStrip />

          <h1 className="mt-3 text-center text-[27px] font-extrabold leading-tight tracking-tight">
            A handheld for bets
            <br />
            nobody can see.
          </h1>
          <p className="mt-2.5 text-center text-[14px] leading-relaxed text-white/50">
            Pick where the price lands, or just which way it goes. Your position stays sealed
            until the round settles itself on Starknet.
          </p>

          {/*
            The three markets, drifting.

            A staggered float rather than a synchronised one: three discs moving in lockstep
            read as a single object, three moving independently read as three.
          */}
          <div className="mt-5 flex items-center justify-center gap-3">
            {["BTC", "ETH", "STRK"].map((c, i) => (
              <span
                key={c}
                className="motion-safe:animate-[drift_5s_ease-in-out_infinite]"
                style={{ animationDelay: `${i * 0.55}s` }}
              >
                <CoinMark coin={c} size={30} />
              </span>
            ))}
          </div>

          <Link
            href="/play"
            className="key mt-6 block w-full rounded-full bg-amber-2 py-4 text-center text-[15px] font-extrabold tracking-[0.06em] text-black transition-[filter,transform] duration-150 hover:brightness-110 motion-safe:animate-[breathe_3.2s_ease-in-out_infinite]"
          >
            PLAY THE GAME
          </Link>

          <p className="mt-3 text-center text-[11.5px] leading-relaxed text-white/30">
            An email address is enough. No extension, no seed phrase.
          </p>
        </section>

        {/* ───────────────────────────────────────────────────── the two games */}
        <Reveal>
          <section className="rounded-[22px] bg-card p-6">
            <div className="label">Two games, one console</div>
            <div className="mt-4 grid gap-3">
              <div className="rounded-xl bg-[#131313] p-4">
                <div className="mono text-[9.5px] tracking-[0.14em] text-amber">RANGE</div>
                <div className="mt-1.5 text-[13.5px] font-semibold">
                  Paint a band around the price.
                </div>
                <p className="mt-1 text-[12.5px] leading-relaxed text-white/45">
                  Tighter pays more, because it is less likely. The odds come from a
                  distribution measured on real tape for each round length — not a curve
                  anyone assumed.
                </p>
              </div>
              <div className="rounded-xl bg-[#131313] p-4">
                <div className="mono text-[9.5px] tracking-[0.14em] text-green">UP / DOWN</div>
                <div className="mt-1.5 text-[13.5px] font-semibold">
                  Just say which way it goes.
                </div>
                <p className="mt-1 text-[12.5px] leading-relaxed text-white/45">
                  Both sides pay exactly the same, which is what lets the contract keep your
                  answer secret: if one side were priced higher, the money set aside would say
                  which one you picked.
                </p>
              </div>
            </div>
          </section>
        </Reveal>

        {/* ─────────────────────────────────────────────── why it is worth hiding */}
        <Reveal delay={80}>
          <section className="rounded-[22px] bg-card p-6">
            <div className="label">Why the privacy is the mechanic</div>
            <p className="mt-2.5 text-[13px] leading-relaxed text-white/55">
              On a public chain your order is a signal before it is a trade. Anyone watching can
              price against it, crowd into it, or simply get there first — which is why informed
              flow stays off chain. Take the privacy away and this is a worse version of every
              public prediction market.
            </p>

            <div className="mt-5 grid gap-4">
              <Claim
                n="01"
                head="The contract is never told your band."
                body="It is told how far the band reaches from its own midpoint — a pair of ratios with the price divided out. Exactly enough to charge you correctly, and nothing about what you think will happen."
              />
              <Claim
                n="02"
                head="Your position is a commitment, not an address."
                body="Through the STRK20 pool the pool is the caller, so the market never learns who opened anything. The secret in your browser is the only credential, and molfi never sees it."
              />
              <Claim
                n="03"
                head="Every settlement can be recomputed by a stranger."
                body="Once a round resolves, the inputs are published and anyone can redo the arithmetic and compare it to what the contract actually paid. No wallet, no account, no permission."
              />
            </div>
          </section>
        </Reveal>

        {/* ──────────────────────────────────────────────────────────── the doors */}
        <Reveal delay={140}>
          <section className="rounded-[22px] bg-card p-6">
            {/*
              The questions a sceptic asks, in the order they ask them. Every one is a page
              that answers with chain data rather than a paragraph, and none needs a wallet.
            */}
            <nav className="grid grid-cols-3 gap-2">
              <Door href="/privacy" label="Private" sub="what leaks" />
              <Door href="/verify" label="Check one" sub="from outside" />
              <Door href="/keeper" label="Who runs it" sub="nobody has to" />
            </nav>

            <div className="mt-7 text-center">
              <div className="label">Powered by</div>
              <div className="mt-2 flex items-center justify-center gap-2 text-purple">
                <StarknetSpark size={18} />
                <span className="text-[16px] font-bold tracking-tight text-white">
                  Starknet privacy pool
                </span>
              </div>
            </div>
          </section>
        </Reveal>
      </main>
    </div>
  );
}
