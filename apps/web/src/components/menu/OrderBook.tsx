"use client";

import { useEffect, useRef, useState } from "react";

interface Level {
  price: number;
  size: number;
}

interface Book {
  configured: boolean;
  /** Which path produced these numbers: XORR's oracle, or Kuru's book read directly. */
  via?: "oracle" | "book";
  market?: string;
  oracle?: string;
  onchain?: {
    block: string;
    bid: number;
    ask: number;
    mid: number;
    spreadBps: number;
    bids: Level[];
    asks: Level[];
    marks?: {
      mid: number;
      micro: number;
      topBidSize: number;
      topAskSize: number;
      mark: "MID" | "MICRO";
      microGuarded: boolean;
      dustFloor: number;
      twapWindow: number;
    };
  };
  params?: { tickSize: number; minSize: number; maxSize: number; takerFeeBps: number };
  /** Which oracle OracleRouter sends MON to, read from the chain at this block. */
  routed?: { source: string; label: string } | null;
  /** What it would cost to push the mark 1% either way, from this ladder. */
  manipulation?: {
    up: { reachable: boolean; size: number; notional: number; levels: number };
    down: { reachable: boolean; size: number; notional: number; levels: number };
    targetBps: number;
  } | null;
  /** Whether the touch actually moved across the settlement window. */
  windowMove?: { fromBid: number; fromAsk: number; movedBps: number; blocks: number } | null;
  /** Set when that comparison could not be read at all. */
  windowMoveUnavailable?: string | null;
  /** Set when this response is a past block rather than the head. */
  replayOf?: string | null;
  /** Set when a past block was asked for and the node could not answer for it. */
  replayUnavailable?: string | null;
  /** The same asset on a centralised book, for scale. */
  basis?: {
    venue: string;
    bid: number;
    ask: number;
    mid: number;
    spreadBps: number;
    basisBps: number;
    onchainSpreadBps: number;
  } | null;
  health?: string;
  tradeable?: boolean;
  reason?: string;
  venue?: {
    lastPrice: number | null;
    lastTradeTime: string | null;
    volume24h: number | null;
    trades24h: number | null;
    traders24h: number | null;
    volume1h: number | null;
    tickSize: number | null;
    base: string | null;
    quote: string | null;
  } | null;
  error?: string;
}

const HEALTH: Record<string, { tone: string; label: string }> = {
  tight: { tone: "text-green", label: "TIGHT" },
  wide: { tone: "text-amber", label: "WIDE" },
  thin: { tone: "text-amber", label: "THIN" },
  resting: { tone: "text-amber", label: "RESTING" },
  quiet: { tone: "text-amber", label: "QUIET" },
  "one-sided": { tone: "text-red", label: "ONE-SIDED" },
  crossed: { tone: "text-red", label: "CROSSED" },
  unmeasured: { tone: "text-dim", label: "DEPTH UNKNOWN" },
};

const px = (v: number) => v.toFixed(6);
/**
 * Sizes, at the precision the number is actually about.
 *
 * One decimal is right for a ladder of three-hundred-MON rests and wrong for the dust
 * order the guard exists to reject: 0.000138 MON printed as "0.0" reads as an empty
 * side, which is a different claim entirely.
 */
const sz = (v: number) => {
  if (v >= 1000) return `${(v / 1000).toFixed(1)}k`;
  if (v === 0) return "0";
  if (v < 0.1) return v.toPrecision(2);
  return v.toFixed(1);
};

/**
 * Kuru's order book, as the contract sees it.
 *
 * Every number under the ladder came from a contract call at the block shown — the
 * same call XORR's oracle makes to price the market. It is deliberately not a REST
 * snapshot dressed up as one.
 */
export function OrderBook() {
  const [book, setBook] = useState<Book | null>(null);
  const [err, setErr] = useState<string | null>(null);
  /**
   * How far back to read the book, in blocks. Zero is the head.
   *
   * The ladder is a contract call, so this is the same call with a block tag — there is
   * no snapshot stored anywhere and nothing of ours to trust. Anyone can re-derive what
   * is on screen from the chain, which is worth more than a copy we saved would be.
   */
  const [back, setBack] = useState(0);

  const headRef = useRef(0n);
  const backRef = useRef(0);
  useEffect(() => {
    backRef.current = back;
  }, [back]);

  useEffect(() => {
    let stop = false;
    const load = async () => {
      try {
        const r = await fetch(
          backRef.current > 0 && headRef.current > 0n
            ? `/api/kuru?block=${headRef.current - BigInt(backRef.current)}`
            : "/api/kuru",
          { cache: "no-store" },
        );
        const j = (await r.json()) as Book;
        if (stop) return;
        if (!r.ok) setErr(j.error ?? `book unavailable (${r.status})`);
        else setErr(null);
        // Remember the head so stepping back is relative to now, not to a stale anchor.
        if (!j.replayOf && j.onchain) headRef.current = BigInt(j.onchain.block);
        setBook(j);
      } catch (e) {
        if (!stop) setErr((e as Error).message);
      }
    };
    void load();
    const id = setInterval(load, 4000);
    return () => {
      stop = true;
      clearInterval(id);
    };
  }, []);

  if (err && !book?.onchain) {
    return <p className="mt-8 text-center text-[13px] text-red">{err}</p>;
  }
  if (!book) {
    return <p className="label mt-8 text-center">reading the book</p>;
  }
  if (!book.configured) {
    return (
      <p className="mt-8 text-center text-[13px] leading-relaxed text-white/45">
        No Kuru oracle is deployed for this environment.
        <br />
        Deploy with KURU_MON_AUSD set to read the book.
      </p>
    );
  }

  const b = book.onchain;
  if (!b) return <p className="label mt-8 text-center">no book</p>;

  const asks = [...b.asks].slice(0, 7).reverse();
  const bids = b.bids.slice(0, 7);
  const maxSize = Math.max(1, ...b.asks.map((l) => l.size), ...b.bids.map((l) => l.size));
  const sizes = [...b.bids, ...b.asks].map((l) => l.size).sort((x, y) => x - y);
  const medianSize = sizes.length ? sizes[Math.floor(sizes.length / 2)] : 0;
  const health = HEALTH[book.health ?? ""] ?? { tone: "text-dim", label: "—" };

  return (
    <div className="pb-6">
      {/* ---- top of book */}
      <div className="rounded-2xl bg-[#141414] p-4">
        <div className="flex items-start justify-between">
          <div>
            <div className="label">
              {book.venue?.base ?? "MON"} / {book.venue?.quote ?? "AUSD"} · Kuru
            </div>
            <div className="tnum mt-1 text-[26px] font-bold leading-none text-white">
              {px(b.mid)}
            </div>
          </div>
          <div className="text-right">
            <div className="label">Spread</div>
            <div className="tnum mt-1 text-[15px] font-semibold text-amber">
              {b.spreadBps} bps
            </div>
          </div>
        </div>

        <div className="mono mt-3 flex flex-wrap items-center gap-2 text-[10px] tracking-[0.08em]">
          <span className={`rounded px-1.5 py-0.5 ${health.tone} bg-white/5`}>
            {health.label}
          </span>
          <span className="tnum text-dim">block {b.block}</span>
          {book.replayOf ? (
            <span className="rounded bg-amber/15 px-1.5 py-0.5 text-amber">REPLAY</span>
          ) : null}
        </div>

        {/* Step back through the chain and watch the same call answer differently. */}
        <div className="mono mt-2 flex items-center gap-1 text-[9px] tracking-[0.08em]">
          <span className="text-dim">BOOK AT</span>
          {[0, 1000, 3000, 10000].map((n) => (
            <button
              key={n}
              onClick={() => setBack(n)}
              className={`rounded px-1.5 py-0.5 ${
                back === n ? "bg-amber text-black" : "bg-white/8 text-dim"
              }`}
            >
              {n === 0 ? "NOW" : `−${n / 1000}k`}
            </button>
          ))}
          {back > 0 ? (
            book.replayUnavailable ? (
              /*
               * Say the replay could not be served, and keep showing the present.
               * A node that cannot reach back is not a book that is broken.
               */
              <span className="ml-1 text-amber">
                showing now — {book.replayUnavailable}
              </span>
            ) : (
              <span className="ml-1 text-white/35">
                ≈{Math.round((back * 0.3) / 60)} min ago, read at that block
              </span>
            )
          ) : null}
        </div>

        {book.reason ? (
          <p className="mt-2 text-[11px] leading-relaxed text-white/45">{book.reason}</p>
        ) : null}

        {/* How this book becomes one number, and which rule is in force right now. */}
        {b.marks ? <MarkExplainer marks={b.marks} /> : null}
      </div>

      {/* ---- the ladder, where there is a decoder to produce it */}
      {book.via === "book" ? (
        <div className="mt-3 rounded-2xl bg-[#141414] p-4">
          <div className="label">Ladder unavailable here</div>
          <p className="mt-2 text-[11px] leading-relaxed text-white/45">
            Kuru returns L2 depth as packed bytes, so the ladder comes from{" "}
            <span className="text-white">KuruOracle</span>&apos;s on-chain decoder — and
            this build has no chain to deploy it to. Decoding the same bytes a second
            time in the browser would be exactly the duplicated implementation this
            project diffs 1,728 quotes to avoid. Run <span className="text-white">pnpm
            demo</span> to see the ladder, the depth guards and the mark.
          </p>
        </div>
      ) : (
      <div className="mono mt-3 overflow-hidden rounded-2xl bg-[#0d0d0d]">
        <div className="flex items-center justify-between px-3 py-2 text-[9px] tracking-[0.12em] text-dim">
          <span>PRICE</span>
          <span>SIZE ({book.venue?.base ?? "MON"})</span>
        </div>

        {asks.map((l, i) => (
          <Row key={`a${i}`} level={l} max={maxSize} median={medianSize} side="ask" />
        ))}

        <div className="flex items-center justify-between border-y border-white/10 bg-[#161616] px-3 py-2">
          <span className="tnum text-[12px] font-bold text-white">{px(b.mid)}</span>
          <span className="label">mid</span>
        </div>

        {bids.map((l, i) => (
          <Row key={`b${i}`} level={l} max={maxSize} median={medianSize} side="bid" />
        ))}
      </div>
      )}

      {b.bids.length > 0 && b.asks.length > 0 ? (
        <BookPressure bids={b.bids} asks={b.asks} />
      ) : null}

      {b.marks ? <WhyThisPrice book={book} /> : null}

      {b.marks ? (
        <SettlementWindow
          marks={b.marks}
          move={book.windowMove ?? null}
          moveUnavailable={book.windowMoveUnavailable ?? null}
        />
      ) : null}

      {book.manipulation ? (
        <MoveCost m={book.manipulation} window={b.marks?.twapWindow ?? 0} />
      ) : null}

      {book.basis ? <Basis basis={book.basis} /> : null}

      {/* ---- venue activity, clearly separated from anything used for pricing */}
      {book.venue ? (
        <div className="mt-3 rounded-2xl bg-[#141414] p-4">
          <div className="label">Venue activity · Kuru API</div>
          <div className="mt-2 grid grid-cols-2 gap-x-4 gap-y-2">
            <Stat label="24h volume" value={fmtNum(book.venue.volume24h)} />
            <Stat label="24h trades" value={fmtNum(book.venue.trades24h)} />
            <Stat label="1h volume" value={fmtNum(book.venue.volume1h)} />
            <Stat label="24h traders" value={fmtNum(book.venue.traders24h)} />
          </div>
          <p className="mt-3 text-[11px] leading-relaxed text-white/40">
            These aggregates come from Kuru&apos;s API and are never used to price
            anything.{" "}
            {book.via === "book"
              ? "The prices above are read from the chain."
              : "The ladder above is read from the chain."}
          </p>
        </div>
      ) : null}

      {/* ---- the venue's own rules */}
      {book.params ? (
        <div className="mt-3 rounded-2xl bg-[#141414] p-4">
          <div className="label">Market rules · read from the book</div>
          <div className="mt-2 grid grid-cols-2 gap-x-4 gap-y-2">
            <Stat label="Tick size" value={book.params.tickSize.toFixed(6)} />
            <Stat label="Taker fee" value={`${book.params.takerFeeBps} bps`} />
            <Stat label="Min order" value={`${fmtNum(book.params.minSize)} MON`} />
            <Stat label="Max order" value={`${fmtNum(book.params.maxSize)} MON`} />
          </div>
          <p className="mt-3 text-[11px] leading-relaxed text-white/40">
            A band narrower than one tick cannot be traded against, so nothing here is
            hard-coded — the venue is free to change these and the market follows.
          </p>
        </div>
      ) : null}

      {/* ---- provenance */}
      <div className="mt-3 rounded-2xl bg-[#141414] p-4">
        <div className="label">Provenance</div>
        <Addr label="Kuru market" value={book.market} />
        {book.via === "book" ? (
          <div className="mt-2 flex items-baseline justify-between gap-3">
            <span className="label shrink-0">XORR oracle</span>
            <span className="text-[11px] text-amber">not deployed here</span>
          </div>
        ) : (
          <>
            <Addr label="XORR oracle" value={book.oracle} />
            {book.routed ? <Routed routed={book.routed} oracle={book.oracle} /> : null}
          </>
        )}
        <MarkProvenance book={book} />
      </div>
    </div>
  );
}

/**
 * Depth bars shaded against this book's OWN median rest, not against its largest.
 *
 * Scaling to the maximum makes every ordinary level look small next to one whale, which
 * is the opposite of what the reader needs — the question is "is this level normal for
 * this book", and only the median answers it. It is also what makes a dust order
 * visible as dust rather than as a very short bar.
 */
function Row({
  level,
  max,
  median,
  side,
}: {
  level: Level;
  max: number;
  median: number;
  side: "bid" | "ask";
}) {
  const pct = Math.max(2, (level.size / max) * 100);
  const heat = median > 0 ? level.size / median : 1;
  const tone = side === "bid" ? "text-green" : "text-red";
  const bar =
    heat >= 1.5
      ? side === "bid"
        ? "bg-green/35"
        : "bg-red/35"
      : heat >= 0.5
        ? side === "bid"
          ? "bg-green/18"
          : "bg-red/18"
        : side === "bid"
          ? "bg-green/8"
          : "bg-red/8";
  return (
    <div className="relative flex items-center justify-between px-3 py-[7px]">
      {/* Depth as width, so relative size is readable without reading a number. */}
      <span
        className={`absolute inset-y-0 right-0 ${bar}`}
        style={{ width: `${pct}%` }}
        aria-hidden
      />
      <span className={`tnum relative text-[11px] ${tone}`}>{px(level.price)}</span>
      <span className="tnum relative text-[11px] text-white/70">{sz(level.size)}</span>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div className="label">{label}</div>
      <div className="tnum mt-0.5 text-[14px] font-semibold text-white">{value}</div>
    </div>
  );
}

function Addr({ label, value }: { label: string; value?: string }) {
  if (!value) return null;
  return (
    <div className="mt-2 flex items-baseline justify-between gap-3">
      <span className="label shrink-0">{label}</span>
      <span className="tnum truncate text-[11px] text-white/70">{value}</span>
    </div>
  );
}

function fmtNum(v: number | null | undefined): string {
  if (v === null || v === undefined || !Number.isFinite(v)) return "—";
  if (v === 0) return "0";
  if (v >= 1000) return v.toLocaleString("en-US", { maximumFractionDigits: 0 });
  return v.toLocaleString("en-US", { maximumFractionDigits: 2 });
}

/**
 * Which rule turns the book into a price, stated rather than implied.
 *
 * Showing this only when the microprice happens to differ from the midpoint reads as
 * "the mark is the midpoint" on every book where the two agree — which is exactly the
 * case when the dust guard has just overridden the weighting. The interesting state is
 * the guard firing, so name the configured rule in every state and say when it was
 * overridden and why.
 */
function MarkExplainer({
  marks,
}: {
  marks: NonNullable<NonNullable<Book["onchain"]>["marks"]>;
}) {
  const differs = Math.abs(marks.micro - marks.mid) > 1e-9;
  const gapBps = marks.mid > 0 ? (Math.abs(marks.micro - marks.mid) / marks.mid) * 10_000 : 0;

  if (marks.mark === "MID") {
    return (
      <div className="mt-3 rounded-xl bg-[#0d0d0d] p-3">
        <div className="flex items-baseline justify-between">
          <span className="label">Midpoint · used</span>
          <span className="tnum text-[13px] font-semibold text-amber">{px(marks.mid)}</span>
        </div>
        <p className="mt-2 text-[11px] leading-relaxed text-white/40">
          This book is marked on the plain midpoint of best bid and best ask —{" "}
          {sz(marks.topBidSize)} against {sz(marks.topAskSize)}. Resting size is not
          weighted in.
        </p>
      </div>
    );
  }

  return (
    <div className="mt-3 rounded-xl bg-[#0d0d0d] p-3">
      <div className="flex items-baseline justify-between">
        <span className="label">Midpoint</span>
        <span className="tnum text-[12px] text-white/50">{px(marks.mid)}</span>
      </div>
      <div className="mt-1 flex items-baseline justify-between">
        <span className="label">
          Microprice{marks.microGuarded ? " · guarded" : " · used"}
        </span>
        <span
          className={`tnum text-[13px] font-semibold ${
            marks.microGuarded ? "text-white/50" : "text-amber"
          }`}
        >
          {px(marks.micro)}
        </span>
      </div>

      {marks.microGuarded ? (
        <p className="mt-2 text-[11px] leading-relaxed text-white/40">
          This book is marked on the size-weighted midpoint, but one side is dust —{" "}
          {sz(marks.topBidSize)} on the bid against {sz(marks.topAskSize)} on the ask,
          under the {sz(marks.dustFloor)} floor. Weighting against that would let a
          fraction of a MON move the mark, so the oracle falls back to the plain
          midpoint until the side is real again.
        </p>
      ) : differs ? (
        <p className="mt-2 text-[11px] leading-relaxed text-white/40">
          {sz(marks.topBidSize)} rests on the bid against {sz(marks.topAskSize)} on the
          ask, so a midpoint between them is a price neither side would trade at. The
          mark is weighted toward the thinner side — {gapBps.toFixed(0)} bps from the
          midpoint.
        </p>
      ) : (
        <p className="mt-2 text-[11px] leading-relaxed text-white/40">
          {sz(marks.topBidSize)} rests on the bid against {sz(marks.topAskSize)} on the
          ask. The sides are balanced enough that weighting by size lands on the
          midpoint anyway.
        </p>
      )}
    </div>
  );
}

/** True when the chain says MON is settling on something other than this book. */
function routedAway(book: Book): boolean {
  const r = book.routed;
  if (!r || !book.oracle) return false;
  return !(r.label === "kuru" && r.source.toLowerCase() === book.oracle.toLowerCase());
}

/**
 * Where the router actually sends MON, said out loud.
 *
 * `OracleRouter` can fall back from the book to the push feed. If it ever does, every
 * other word on this screen — the ladder, the mark, the guards — is describing a source
 * the market is no longer settling on. A fallback nobody can see is the one failure
 * this panel exists to make impossible, so the disagreement is stated in red rather
 * than left to be inferred from two addresses that happen to differ.
 */
function Routed({
  routed,
  oracle,
}: {
  routed: NonNullable<Book["routed"]>;
  oracle?: string;
}) {
  const onKuru =
    routed.label === "kuru" &&
    !!oracle &&
    routed.source.toLowerCase() === oracle.toLowerCase();

  return (
    <div className="mt-2">
      <div className="flex items-baseline justify-between gap-3">
        <span className="label shrink-0">Router sends MON to</span>
        <span className={`tnum text-[11px] ${onKuru ? "text-green" : "text-red"}`}>
          {routed.label || "unlabelled"}
        </span>
      </div>
      {!onKuru ? (
        <p className="mt-2 rounded-xl bg-[#2a1616] p-3 text-[11px] leading-relaxed text-red">
          The market is not settling on this book. `OracleRouter.sourceOf` returns{" "}
          <span className="tnum">{routed.source}</span>, labelled{" "}
          <span className="text-white">{routed.label || "unlabelled"}</span> — so the
          ladder and the mark above describe a venue the market has been routed away
          from. Everything on this screen is still real; it is just no longer what MON
          settles against.
        </p>
      ) : null}
    </div>
  );
}

/**
 * What produced the mark, in the tense that is actually true right now.
 *
 * Three different sentences, because three different things can be the case: the oracle
 * is not deployed at all, it is deployed but the router has sent MON elsewhere, or it
 * is deployed and in the path. Collapsing them into the confident version is how a
 * panel ends up describing a settlement path the market has been routed away from.
 */
function MarkProvenance({ book }: { book: Book }) {
  const mark =
    book.onchain?.marks?.mark === "MICRO"
      ? "the size-weighted midpoint of these resting orders"
      : "the midpoint of these resting orders";

  if (book.via === "book") {
    return (
      <p className="mt-3 text-[11px] leading-relaxed text-white/45">
        These numbers came from a call to Kuru&apos;s own contract at the block above —
        the market is real and so is the read. What is not in the path here is{" "}
        <span className="text-white">KuruOracle</span>, which is where the mark and the
        thin-book guards live. This build has no chain of its own to deploy it to, so it
        is described rather than demonstrated: <span className="text-white">pnpm demo</span>{" "}
        brings it up against real Monad state, and{" "}
        <span className="text-white">pnpm check:kuru</span> proves it against this same
        market.
      </p>
    );
  }

  if (routedAway(book)) {
    return (
      <p className="mt-3 text-[11px] leading-relaxed text-white/45">
        When MON is routed here, its mark is {mark}, read on-chain by{" "}
        <span className="text-white">KuruOracle</span> with no relayer and nothing
        off-chain in between. It is not routed here at the moment, so that is a
        description of the path rather than of what MON is currently settling on.
      </p>
    );
  }

  return (
    <p className="mt-3 text-[11px] leading-relaxed text-white/45">
      XORR&apos;s MON mark is {mark}, read on-chain by{" "}
      <span className="text-white">KuruOracle</span>. No relayer, no API, nothing
      off-chain between the venue and the price.
    </p>
  );
}

/**
 * The on-chain book next to a centralised one.
 *
 * "198 bps" means nothing without something to measure it against. Coinbase quotes the
 * same asset a few basis points wide, so putting the two side by side says what a
 * reader would otherwise have to know already: this book is far wider and slightly
 * offset, and XORR settles on it anyway.
 *
 * Reported, never corrected for. A market that settles on the book has to settle on the
 * book when a centralised venue disagrees, or it is not settling on the book at all.
 */
function Basis({ basis }: { basis: NonNullable<Book["basis"]> }) {
  const wider = basis.spreadBps > 0 ? basis.onchainSpreadBps / basis.spreadBps : 0;
  const richer = basis.basisBps >= 0;
  return (
    <div className="mt-3 rounded-2xl bg-[#141414] p-4">
      <div className="label">Against a centralised book · {basis.venue}</div>
      <div className="mt-2 grid grid-cols-2 gap-x-4 gap-y-2">
        <Stat label="Their mid" value={px(basis.mid)} />
        <Stat
          label="Their spread"
          value={`${basis.spreadBps < 10 ? basis.spreadBps.toFixed(1) : basis.spreadBps.toFixed(0)} bps`}
        />
        <Stat
          label="Basis"
          value={`${richer ? "+" : ""}${basis.basisBps.toFixed(0)} bps`}
        />
        <Stat
          label="Spread ratio"
          value={wider >= 1 ? `${wider.toFixed(0)}x wider` : `${(1 / wider).toFixed(1)}x tighter`}
        />
      </div>
      <p className="mt-3 text-[11px] leading-relaxed text-white/40">
        This is reported, not corrected for. XORR settles MON on the book above even
        when a centralised venue disagrees — a market that quietly leans on the
        centralised price when the two diverge is not settling on an order book, it is
        settling on a feed with extra steps.
      </p>
    </div>
  );
}

/**
 * What the market actually settles on, and why it is an average.
 *
 * This is the answer to the only hard question about settling a derivative on an order
 * book — what stops someone moving the book at the cutoff block — so it is stated on
 * the screen rather than left in a README. It is also stated as a price rather than as
 * a defence: the attack is not blocked, it is made to cost the whole window.
 */
function SettlementWindow({
  marks,
  move,
  moveUnavailable,
}: {
  marks: NonNullable<NonNullable<Book["onchain"]>["marks"]>;
  move: Book["windowMove"];
  moveUnavailable: string | null;
}) {
  const blocks = Math.round((marks.twapWindow * 1000) / 300);
  return (
    <div className="mt-3 rounded-2xl bg-[#141414] p-4">
      <div className="label">Settles on</div>
      <div className="mt-1 text-[15px] font-semibold text-white">
        {marks.twapWindow > 0
          ? `a ${marks.twapWindow}-second average of the mark`
          : "the mark at the cutoff block"}
      </div>
      {marks.twapWindow > 0 ? (
        <p className="mt-2 text-[11px] leading-relaxed text-white/45">
          {blocks} blocks, recorded on-chain by anyone who calls{" "}
          <span className="text-white">poke</span> — the value written is read from the
          book by the contract, not supplied by the caller, so a poke can only make the
          average more accurate.
          <br />
          <br />
          A mark read at one block is worth attacking for one block: push the book,
          settle, unwind. An average over {blocks} means holding the book away from its
          price for the whole window, against every resting order on it, paying the
          spread both ways. The attack is not blocked — it is priced.
        </p>
      ) : (
        <p className="mt-2 text-[11px] leading-relaxed text-white/45">
          This market settles on the book as it stands at the cutoff block.
        </p>
      )}

      {/*
        * The honest companion to the claim above.
        *
        * "One block cannot move the average" is worth saying, and worth saying next to
        * whether the book moved at all over the window. A settlement taken across a
        * still book and one taken across a genuine move are different situations, and
        * only showing the first would be choosing the flattering half.
        */}
      {move ? (
        <div className="mono mt-3 flex items-baseline justify-between gap-3 rounded-xl bg-[#0d0d0d] p-3 text-[10px] tracking-[0.08em]">
          <span className="text-dim">
            TOUCH {move.blocks} BLOCKS AGO
          </span>
          <span className="tnum text-white/70">
            {px(move.fromBid)} / {px(move.fromAsk)}
            <span
              className={
                Math.abs(move.movedBps) < 1
                  ? " text-dim"
                  : move.movedBps > 0
                    ? " text-green"
                    : " text-red"
              }
            >
              {" · "}
              {Math.abs(move.movedBps) < 1
                ? "unchanged"
                : `${move.movedBps > 0 ? "+" : ""}${move.movedBps.toFixed(1)} bps`}
            </span>
          </span>
        </div>
      ) : null}
    </div>
  );
}

/**
 * What moving this mark would actually cost.
 *
 * "There are guards" is a claim. This is a number, walked from the ladder shown three
 * inches above it, and it is the number that makes the settlement window mean
 * something: the window multiplies it by however many times the attacker has to do it
 * again as other people's orders refill the levels they cleared.
 *
 * Reported as a floor, never as a price, because a snapshot cannot know what refills.
 */
function MoveCost({
  m,
  window,
}: {
  m: NonNullable<Book["manipulation"]>;
  window: number;
}) {
  const money = (v: number) =>
    v >= 1000 ? `$${(v / 1000).toFixed(1)}k` : `$${v.toFixed(2)}`;
  const blocks = Math.round((window * 1000) / 300);

  return (
    <div className="mt-3 rounded-2xl bg-[#141414] p-4">
      <div className="label">Cost to move this mark {m.targetBps / 100}%</div>
      <div className="mt-2 grid grid-cols-2 gap-x-4 gap-y-2">
        <Stat
          label="Push it up"
          value={m.up.reachable ? money(m.up.notional) : "beyond the book"}
        />
        <Stat
          label="Push it down"
          value={m.down.reachable ? money(m.down.notional) : "beyond the book"}
        />
        <Stat
          label="Levels eaten"
          value={`${m.up.reachable ? m.up.levels : "—"} up / ${m.down.reachable ? m.down.levels : "—"} down`}
        />
        <Stat
          label="Then held for"
          value={window > 0 ? `${blocks} blocks` : "one block"}
        />
      </div>
      <p className="mt-3 text-[11px] leading-relaxed text-white/40">
        Walked from the ladder above, so it is measured rather than assumed. It is a
        floor and not a price: it buys the move once, and{" "}
        {window > 0
          ? `holding it for ${blocks} blocks means paying again every time someone else's resting order refills a level, then paying the spread to unwind.`
          : "this market settles on one block, so buying it once is all it takes — which is why the others do not."}
        {m.up.reachable || m.down.reachable ? "" : " This book is too thin in the levels read to reach that target at all."}
      </p>
    </div>
  );
}

/**
 * The oracle's reasoning, in the order it actually runs.
 *
 * Every guard in KuruOracle is documented in the contract and invisible in the
 * product: a reader sees a price and has to take on faith that anything stood between
 * the book and it. This walks the same sequence with this block's numbers, so the
 * refusals are legible when they fire and the passes are legible when they do not.
 *
 * Derived from what the API already reports rather than re-implemented — the point is
 * to show the contract's reasoning, and a second implementation of it here would
 * eventually disagree with the first.
 */
function WhyThisPrice({ book }: { book: Book }) {
  const b = book.onchain;
  if (!b) return null;
  const m = b.marks;

  const steps: { label: string; detail: string; ok: boolean }[] = [
    {
      label: "bestBidAsk()",
      detail: `${px(b.bid)} / ${px(b.ask)}`,
      ok: b.bid > 0 && b.ask > b.bid,
    },
    {
      label: "both sides present, not crossed",
      detail: b.bid > 0 && b.ask > b.bid ? "yes" : "no — the oracle reports nothing",
      ok: b.bid > 0 && b.ask > b.bid,
    },
    {
      label: "spread within the guard",
      detail: `${b.spreadBps} bps`,
      ok: b.spreadBps <= 500,
    },
  ];

  if (m) {
    steps.push({
      label: m.mark === "MICRO" ? "mark: size-weighted" : "mark: midpoint",
      /**
       * Name the side that is actually dust.
       *
       * This said "on the ask" whatever the book was doing, and the book had flipped —
       * so it read "370 on the ask is under the 5.0 floor", which is false about a
       * number printed two lines above it. Either side can be the thin one; ask which.
       */
      detail: m.microGuarded
        ? `guarded to the midpoint — ${
            m.topBidSize < m.dustFloor
              ? `${sz(m.topBidSize)} on the bid`
              : `${sz(m.topAskSize)} on the ask`
          } is under the ${sz(m.dustFloor)} floor`
        : px(m.micro),
      ok: true,
    });
    steps.push({
      label: m.twapWindow > 0 ? `averaged over ${m.twapWindow}s` : "read at this block",
      detail: m.twapWindow > 0 ? `${Math.round((m.twapWindow * 1000) / 300)} blocks of history` : "no window",
      ok: true,
    });
  }

  steps.push({
    label: "the price the market settles on",
    detail: px(b.mid),
    ok: b.mid > 0,
  });

  return (
    <div className="mt-3 rounded-2xl bg-[#141414] p-4">
      <div className="label">Why this price</div>
      <div className="mt-2 space-y-1.5">
        {steps.map((st, i) => (
          <div key={i} className="flex items-baseline justify-between gap-3 text-[11px]">
            <span className="flex min-w-0 items-baseline gap-2">
              <span className={st.ok ? "text-green" : "text-red"}>{st.ok ? "✓" : "✗"}</span>
              <span className="truncate text-white/55">{st.label}</span>
            </span>
            <span className="tnum shrink-0 text-white/75">{st.detail}</span>
          </div>
        ))}
      </div>
      <p className="mt-3 text-[11px] leading-relaxed text-white/40">
        Every line is a guard in <span className="text-white">KuruOracle</span>, in the
        order the contract runs them. Any one of them failing means the oracle reports
        no price at all and the market refuses to settle — which is the behaviour worth
        having, and is invisible until something makes it visible.
      </p>
    </div>
  );
}

/**
 * Which way the book leans, as one bar.
 *
 * Resting size is not symmetric and the asymmetry is the thing the microprice exists
 * to price. Two numbers in a table make a reader do the division; a bar does not.
 */
function BookPressure({ bids, asks }: { bids: Level[]; asks: Level[] }) {
  const bidDepth = bids.reduce((a, l) => a + l.size, 0);
  const askDepth = asks.reduce((a, l) => a + l.size, 0);
  const total = bidDepth + askDepth;
  if (total <= 0) return null;
  const bidPct = (bidDepth / total) * 100;

  return (
    <div className="mt-3 rounded-2xl bg-[#141414] p-4">
      <div className="flex items-baseline justify-between">
        <div className="label">Book pressure</div>
        <div className="mono text-[10px] tracking-[0.08em] text-dim">
          {bidPct >= 50 ? `${bidPct.toFixed(0)}% BID` : `${(100 - bidPct).toFixed(0)}% ASK`}
        </div>
      </div>
      <div className="mt-2 flex h-2 overflow-hidden rounded-full bg-[#0d0d0d]">
        <div className="bg-green" style={{ width: `${bidPct}%` }} />
        <div className="bg-red" style={{ width: `${100 - bidPct}%` }} />
      </div>
      <div className="mono mt-1.5 flex justify-between text-[9px] tracking-[0.08em]">
        <span className="text-green">{sz(bidDepth)} bid</span>
        <span className="text-red">{sz(askDepth)} ask</span>
      </div>
      <p className="mt-3 text-[11px] leading-relaxed text-white/40">
        Read from the ladder above. This asymmetry is what the size-weighted mark exists
        to price — a midpoint between two sides carrying very different size is a number
        neither side would trade at.
      </p>
    </div>
  );
}
