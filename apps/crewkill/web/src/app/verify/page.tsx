import type { Metadata } from "next";
import Link from "next/link";
import { Verifier } from "@/components/verifier";

export const metadata: Metadata = {
  title: "Verify a match — CrewKill",
  description:
    "Replay any settled CrewKill match from its published data and check the contract's payouts against an independent recomputation, in your own browser.",
};

export default function VerifyPage() {
  return (
    <main className="mx-auto max-w-3xl px-4 py-10">
      <p className="tele">Permissionless audit</p>
      <h1 className="macro macro-lg mt-2 text-[var(--color-ink)]">Check a finished match</h1>

      <p className="mt-4 text-[14px] leading-relaxed text-[var(--color-dim)]">
        You do not have to take anyone&apos;s word for how a match ended, including ours.
        Type a match number and this page will replay it from the data the contract
        published, then put its own answer next to the contract&apos;s.
      </p>
      <p className="mt-3 text-[14px] leading-relaxed text-[var(--color-dim)]">
        Nothing here is privileged. The roles come out of{" "}
        <code className="text-[var(--color-cyan)]">poseidon(seed, role_secret)</code>, and both
        of those were committed before anyone could know them, so anybody with the published
        values gets the same answer. You do not need an account, a wallet, or to have played.
      </p>

      <div className="mt-8">
        <Verifier />
      </div>

      <p className="mt-10 text-[12px] text-[var(--color-dim)]">
        Looking for something to check?{" "}
        <Link href="/history" className="text-[var(--color-cyan)] underline">
          The archive
        </Link>{" "}
        lists every settled match, and each one links straight back here.
      </p>
    </main>
  );
}
