import { openActions, type Strk20Action } from "@molfi/sdk";

/**
 * The actual action list molfi hands a privacy wallet, rendered from the real thing.
 *
 * Every privacy project describes its integration. This shows it: the exact `STRK20_ACTION[]`
 * that `openActions` produces for a live market at the current price, built by the same
 * function the console calls. Not an illustration, not a snippet from the docs — if this
 * array is wrong, molfi is broken, and a reader can check it against the pool's ABI.
 *
 * It also makes the two least obvious parts of the integration visible, which is the point:
 * the withdraw leg exists because the pool's `InvokeExternalInput` carries no token and no
 * amount, and the invoke's calldata *is* the contract's `privacy_invoke` signature in order.
 * Both were bugs before they were features.
 *
 * The secret shown is a placeholder, and says so. Everything else — pool, token, market,
 * market id, band, stake — is real.
 */
export function PrivateOrder({
  addresses,
  marketId,
  bandLow,
  bandHigh,
  stake,
  pair,
  open,
}: {
  addresses: { pool: string; token: string; market: string };
  marketId: number;
  bandLow: bigint;
  bandHigh: bigint;
  stake: bigint;
  pair: string;
  /** Whether this round is still accepting orders. A closed one says so rather than pretending. */
  open: boolean;
}) {
  const actions = openActions(
    addresses,
    { secret: "0x<your secret, generated in your browser and never sent>", marketId, bandLow, bandHigh },
    stake,
  );

  return (
    <section className="mt-3 rounded-[22px] bg-card p-6">
      <div className="label">what molfi hands your wallet</div>
      <h2 className="mt-2 text-[18px] font-extrabold leading-snug">
        The private order, as it is actually built
      </h2>
      <p className="mt-2 text-[13px] leading-relaxed text-white/55">
        This is not an example. It is the real array{" "}
        <code className="text-white/70">openActions</code> returns for {pair} market #{marketId}{" "}
        at the current price — the same function the console calls before handing the list to
        your wallet. molfi never sees a viewing key and never builds a proof; the wallet does
        both, and this is everything it is given.
      </p>

      {open ? null : (
        <p className="mt-2 text-[13px] leading-relaxed text-amber-300/70">
          That round has closed — rounds run fifteen minutes and the next opens once this one
          settles. The array is still exactly what the builder produces for it; submitted now
          it would revert on the cutoff, which is the contract doing its job.
        </p>
      )}

      <pre className="mono mt-4 overflow-x-auto rounded-xl bg-[#0d0d0d] p-4 text-[10px] leading-relaxed text-white/70">
        {JSON.stringify(actions, null, 2)}
      </pre>

      <dl className="mt-4 space-y-3">
        {[
          [
            "Two actions, one transaction",
            "The pool applies them in phase order — withdraw is phase 6, the external invoke is phase 7 — so the stake reaches the market contract before it is called.",
          ],
          [
            "The withdraw leg is not optional",
            "The pool's InvokeExternalInput is a contract address and calldata, and nothing else: no token, no amount. An invoke on its own moves no money. This was a real bug before it was a line of documentation.",
          ],
          [
            "The calldata is the contract's signature, in order",
            "The pool deserialises straight into privacy_invoke's parameters, so this array is the interface. A field out of order fails as a deserialisation error with nothing readable in it.",
          ],
          [
            "No note is created on the way in",
            "The helper returns an empty span, because the stake parks in the contract until settlement. Asking the pool to credit a note that never arrives would leave its balance invariant unsatisfiable.",
          ],
        ].map(([what, why]) => (
          <div key={what} className="rounded-xl bg-[#131313] p-4">
            <dt className="text-[13px] font-semibold">{what}</dt>
            <dd className="mt-1.5 text-[12px] leading-relaxed text-white/55">{why}</dd>
          </div>
        ))}
      </dl>

      <p className="mono mt-4 text-[10px] leading-relaxed tracking-wide text-white/30">
        POOL {addresses.pool}
        <br />
        MARKET {addresses.market}
      </p>
    </section>
  );
}

export type { Strk20Action };
