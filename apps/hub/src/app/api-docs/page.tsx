import type { Metadata } from "next";
import { SiteHeader, SiteFooter } from "@/components/chrome";

export const metadata: Metadata = {
  title: "API — molfi.fun",
  description:
    "The read API behind CrewKill. Every endpoint is public, unauthenticated, and returns the same data the site itself renders.",
};

/**
 * The read API, documented.
 *
 * Everything the site shows comes from these endpoints, and they take no key. That is worth
 * writing down: a claim that anybody can check the games is stronger when the reader can see
 * exactly which requests to make, and weaker if they have to reverse-engineer them from a
 * network tab.
 */
const ENDPOINTS: Array<{
  method: string;
  path: string;
  what: string;
  returns: string;
}> = [
  {
    method: "GET",
    path: "/health",
    what: "Liveness, plus which chain the keeper is talking to and the head it last saw.",
    returns: `{ "ok": true, "network": "devnet", "block": 109 }`,
  },
  {
    method: "GET",
    path: "/api/config",
    what: "The active deployment's contract addresses and the payout split, in basis points.",
    returns: `{ "network", "chainId", "contracts": { "game", "ballot", "pool", "stakeToken" }, "defaults": { … } }`,
  },
  {
    method: "GET",
    path: "/api/stats",
    what: "Totals across the whole active deployment. Aggregated, not a page.",
    returns: `{ "matches", "settled", "aborted", "seatsFilled", "potTotal", "transactions" }`,
  },
  {
    method: "GET",
    path: "/api/matches",
    what: "The latest 25 matches, newest first. A list, deliberately not a counter.",
    returns: `[ { "matchId", "phase", "seatsFilled", "seatCount", "potAmount", … } ]`,
  },
  {
    method: "GET",
    path: "/api/matches/:id",
    what: "One match in full: seats, tallies, events, and the published seed once it settles.",
    returns: `{ "matchId", "phase", "finalSeed", "seats": [ … ], "tallies": [ … ], "events": [ … ] }`,
  },
  {
    method: "GET",
    path: "/api/matches/:id/disclosure",
    what: "Ballots recovered by recomputing vote receipts against the contract. Real on-chain reads.",
    returns: `{ "applicable", "chainReads", "roundsPlayed", "seats": [ { "ballots": [ … ] } ] }`,
  },
  {
    method: "GET",
    path: "/api/lobby",
    what: "The open lobby, or an explicit null. No lobby is an ordinary state, not an error.",
    returns: `{ "lobby": { … } | null }`,
  },
  {
    method: "GET",
    path: "/api/activity",
    what: "The most recent events across the deployment, newest first.",
    returns: `[ { "matchId", "kind", "text", "at" } ]`,
  },
  {
    method: "GET",
    path: "/api/deployments",
    what: "Every set of contracts this keeper has run on, live and retired, with each one's totals.",
    returns: `[ { "id", "network", "gameAddress", "live", "matches", "settled", "transactions" } ]`,
  },
];

export default function ApiDocs() {
  return (
    <>
      <SiteHeader current="/api-docs" />

      <main id="main" className="mx-auto max-w-5xl px-6 pt-16 pb-24">
        <p className="text-sm font-medium text-[var(--text-dim)]">Read API</p>
        <h1 className="mt-3 max-w-[680px] text-4xl font-semibold tracking-tight sm:text-5xl">
          Everything this site shows,
          <br />
          you can request yourself
        </h1>

        <p className="mt-6 max-w-[660px] text-lg text-[var(--text-dim)]">
          No key, no account, no rate limit worth mentioning. These are the exact endpoints the
          pages here call, so anything you see rendered you can also fetch and check against
          the chain independently.
        </p>

        <p className="mt-4 max-w-[660px] text-[var(--text-dim)]">
          Read only. Nothing here can change a match — the endpoints that do are signed
          transactions to the contract, not HTTP.
        </p>

        <ul className="mt-10 space-y-3">
          {ENDPOINTS.map((row) => (
            <li
              key={row.path}
              className="rounded-xl border border-[var(--line)] bg-[var(--surface)] p-5"
            >
              <div className="flex flex-wrap items-center gap-3">
                <span className="rounded border border-[var(--line-2)] px-1.5 py-0.5 font-mono text-[10px] text-[var(--accent)]">
                  {row.method}
                </span>
                <code className="font-mono text-sm text-[var(--text)]">{row.path}</code>
              </div>
              <p className="mt-2 max-w-[620px] text-sm text-[var(--text-dim)]">{row.what}</p>
              <pre className="mt-3 overflow-x-auto rounded-lg border border-[var(--line)] bg-[var(--surface-2)] p-3 font-mono text-xs text-[var(--text-mute)]">
                {row.returns}
              </pre>
            </li>
          ))}
        </ul>

        <p className="mt-10 max-w-[660px] text-sm text-[var(--text-mute)]">
          The verifier at crewkill.molfi.fun/verify uses nothing beyond{" "}
          <code className="text-[var(--text-dim)]">/api/matches/:id</code>. Everything else it
          shows is recomputed in the browser from the values that endpoint returns.
        </p>
      </main>

      <SiteFooter />
    </>
  );
}
