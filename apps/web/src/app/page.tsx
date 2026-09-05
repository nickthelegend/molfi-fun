import Link from "next/link";
import { ConsoleStage } from "@/components/ConsoleStage";
import { Wordmark } from "@/components/Wordmark";

export default function Home() {
  return (
    <div className="relative min-h-dvh overflow-hidden">
      {/* Soft, out-of-focus ground so the card floats — the console is the subject. */}
      <div
        aria-hidden
        className="tiled absolute inset-0 scale-110 opacity-70 blur-[6px]"
      />
      <div
        aria-hidden
        className="absolute inset-0"
        style={{
          background:
            "radial-gradient(120% 80% at 50% 0%, rgba(0,0,0,0.25), rgba(0,0,0,0.9) 70%)",
        }}
      />

      <main className="relative grid min-h-dvh place-items-center px-4 py-8">
        <div className="w-full max-w-[420px] rounded-[26px] bg-card px-6 pb-7 pt-6 shadow-[0_40px_120px_rgba(0,0,0,0.7)]">
          <div className="flex justify-center text-amber">
            <Wordmark height={30} />
          </div>

          <div className="mt-4 h-[330px]">
            <ConsoleStage />
          </div>

          <h1 className="mt-2 text-center text-[27px] font-extrabold leading-tight tracking-tight">
            Built for fun and money.
          </h1>
          <p className="mt-2 text-center text-[14px] leading-relaxed text-white/50">
            Fun enough you forget it&apos;s trading.
            <br />
            Real enough to matter.
          </p>

          <Link
            href="/play"
            className="mt-6 block w-full rounded-full bg-amber-2 py-4 text-center text-[15px] font-extrabold tracking-[0.06em] text-black transition-[filter] hover:brightness-105 active:translate-y-px"
          >
            START
          </Link>

          <Link
            href="/play?demo=1"
            className="mx-auto mt-4 block w-fit text-[13px] text-white/45 underline underline-offset-4 hover:text-white/70"
          >
            Just exploring? Try demo mode
          </Link>

          <div className="mt-7 text-center">
            <div className="label">Powered by</div>
            <div className="mt-1.5 flex items-center justify-center gap-2">
              <span className="h-3.5 w-6 rounded-sm bg-purple" />
              <span className="text-[16px] font-bold tracking-tight">Monad</span>
            </div>
          </div>
        </div>
      </main>
    </div>
  );
}
