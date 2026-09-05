"use client";

/**
 * How full the house is.
 *
 * Every open ticket reserves its FULL payout against the bankroll, so utilisation is
 * not a vague health metric — it is the fraction of the vault that is already spoken
 * for. At the 80% cap the market stops accepting new exposure, which a player deserves
 * to see coming rather than discover when a fire is refused.
 *
 * Drawn as cells rather than a bar: a bar invites reading a precise value off a few
 * pixels, and cells say plainly how many segments are left before the market is full.
 */
const CELLS = 10;
const CAP_BPS = 8_000;

export function HouseBattery({ utilisationBps }: { utilisationBps: bigint }) {
  const util = Number(utilisationBps);
  const pctOfCap = Math.max(0, Math.min(1, util / CAP_BPS));
  const lit = Math.min(CELLS, Math.ceil(pctOfCap * CELLS));
  const full = util >= CAP_BPS;
  const tight = pctOfCap >= 0.75;

  return (
    <div
      className="flex items-center gap-1.5"
      title={`House utilisation ${(util / 100).toFixed(2)}% of the 80% cap`}
    >
      <span className="label">House</span>
      <span className="flex items-center gap-[2px]" aria-hidden>
        {Array.from({ length: CELLS }, (_, i) => (
          <span
            key={i}
            className={`h-[9px] w-[3px] rounded-[1px] transition-colors duration-300 ${
              i < lit ? (full ? "bg-red" : tight ? "bg-amber" : "bg-green") : "bg-[#242424]"
            }`}
          />
        ))}
      </span>
      <span
        className={`tnum text-[9px] ${full ? "text-red" : tight ? "text-amber" : "text-dim"}`}
        role="status"
        aria-label={`House utilisation ${(util / 100).toFixed(2)} percent`}
      >
        {full ? "FULL" : `${(util / 100).toFixed(1)}%`}
      </span>
    </div>
  );
}
