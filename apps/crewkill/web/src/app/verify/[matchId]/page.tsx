import type { Metadata } from "next";
import Link from "next/link";
import { Verifier } from "@/components/verifier";

/**
 * A verification permalink.
 *
 * The point of a check anyone can run is that they can also send it to somebody else. A URL
 * that carries the match number means the result is quotable: paste it into a dispute and
 * whoever opens it runs the same recomputation for themselves rather than reading your
 * screenshot of it.
 */
export async function generateMetadata({
  params,
}: {
  params: Promise<{ matchId: string }>;
}): Promise<Metadata> {
  const { matchId } = await params;
  return {
    title: `Verify match ${matchId} — CrewKill`,
    description: `Replay CrewKill match ${matchId} from its published data and check the contract's payouts against an independent recomputation.`,
  };
}

export default async function VerifyMatch({
  params,
}: {
  params: Promise<{ matchId: string }>;
}) {
  const { matchId } = await params;

  return (
    <main className="mx-auto max-w-3xl px-4 py-10">
      <p className="tele">Permissionless audit</p>
      <h1 className="macro macro-lg mt-2 text-[var(--color-ink)]">Match {matchId}</h1>

      <p className="mt-4 text-[14px] leading-relaxed text-[var(--color-dim)]">
        Replayed below from the data this match published, recomputed in your browser, and
        compared line by line against what the contract recorded.
      </p>

      <div className="mt-8">
        <Verifier initialMatchId={matchId} />
      </div>

      <p className="mt-10 text-[12px] text-[var(--color-dim)]">
        <Link href="/verify" className="text-[var(--color-cyan)] underline">
          Check a different match
        </Link>
        {" · "}
        <Link href="/history" className="text-[var(--color-cyan)] underline">
          The archive
        </Link>
      </p>
    </main>
  );
}
