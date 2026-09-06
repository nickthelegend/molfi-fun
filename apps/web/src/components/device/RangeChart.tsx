"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { fmtMultiplier, fmtPrice, type MarketDef } from "@molfi/sdk";
import type { PricePoint } from "@/lib/usePaperDesk";

const C = {
  green: "#3ddc84",
  greenFill: "rgba(61,220,132,0.20)",
  amber: "#ff9f0a",
  dim: "#6a6a6a",
  grid: "#161616",
  white: "#ffffff",
  red: "#e8453c",
};

interface Props {
  market: MarketDef;
  history: PricePoint[];
  spot: bigint;
  low: bigint;
  high: bigint;
  multiplierBps: bigint;
  /** 0..1 — how far the live round has burned toward its cutoff. */
  progress: number;
  /**
   * The price a ticket just settled at, and whether it won. Drawn as a ring expanding
   * from that point on the price axis, then cleared by the parent.
   */
  settleFlash?: { price: bigint; won: boolean; at: number } | null;
  /** Bands of tickets already open, drawn behind the live one. */
  openBands?: { low: bigint; high: bigint; won?: boolean }[];
  onDragEdge?: (side: "low" | "high", half1e4: bigint) => void;
}

/**
 * The console screen. Price walks in from the left in green; the band you are about to
 * buy projects to the right in an amber dashed box that ends at the cutoff. Everything
 * to the right of the dot has not happened yet.
 */
export function RangeChart({
  market,
  history,
  spot,
  low,
  high,
  multiplierBps,
  progress,
  settleFlash = null,
  openBands = [],
  onDragEdge,
}: Props) {
  const ref = useRef<HTMLCanvasElement>(null);
  const wrap = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState({ w: 330, h: 250 });
  const drag = useRef<"low" | "high" | null>(null);

  /**
   * Frames, but only while a settlement ring is expanding.
   *
   * The canvas otherwise redraws when its data changes, which on a 300ms chain is about
   * three times inside the ring's 620ms — enough to see it step outward and not enough
   * to see it move. This drives frames for exactly as long as the ring is alive and then
   * stops, rather than running a render loop for a chart that is static most of the time.
   */
  const [, setFrame] = useState(0);
  useEffect(() => {
    if (!settleFlash) return;
    let raf = 0;
    let live = true;
    const tick = () => {
      if (!live) return;
      setFrame((n) => n + 1);
      if (Date.now() - settleFlash.at < 700) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => {
      live = false;
      cancelAnimationFrame(raf);
    };
  }, [settleFlash]);

  useEffect(() => {
    const el = wrap.current;
    if (!el) return;

    const measure = (w: number, h: number) =>
      setSize({ w: Math.max(240, w), h: Math.max(160, h) });

    // Measure once directly. A ResizeObserver reports the first size too, but only once it
    // has been delivered, and the canvas should never render from a size that predates the
    // element it lives in.
    measure(el.clientWidth, el.clientHeight);

    const ro = new ResizeObserver(([e]) => measure(e.contentRect.width, e.contentRect.height));
    ro.observe(el);

    // A resize the observer misses is not hypothetical: the browser stops delivering
    // notifications when it detects a resize loop, and this canvas used to be able to grow
    // wider than its own container and hold that width, which is what put a horizontal
    // scrollbar on a 320px screen. The window listener is the cheap backstop.
    const onWindowResize = () => measure(el.clientWidth, el.clientHeight);
    window.addEventListener("resize", onWindowResize);

    return () => {
      ro.disconnect();
      window.removeEventListener("resize", onWindowResize);
    };
  }, []);

  const scale = useCallback(() => {
    const ps = history.map((p) => Number(p.price));
    const lo = Math.min(...ps, Number(low));
    const hi = Math.max(...ps, Number(high));
    const pad = (hi - lo) * 0.22 + 1;
    return { min: lo - pad, max: hi + pad };
  }, [history, low, high]);

  useEffect(() => {
    const canvas = ref.current;
    if (!canvas || history.length < 2) return;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    canvas.width = size.w * dpr;
    canvas.height = size.h * dpr;
    const g = canvas.getContext("2d")!;
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    g.clearRect(0, 0, size.w, size.h);

    const W = size.w;
    const H = size.h;
    const { min, max } = scale();
    const y = (p: number) => H - ((p - min) / (max - min)) * H;

    // Past occupies the left ~62%; the round being bought fills the rest.
    const nowX = W * 0.62;
    const x = (i: number) => (i / Math.max(1, history.length - 1)) * nowX;

    const spotY = y(Number(spot));
    const yLow = y(Number(low));
    const yHigh = y(Number(high));

    // ---- price trace with a gradient skirt
    g.beginPath();
    history.forEach((p, i) => {
      const px = x(i);
      const py = y(Number(p.price));
      if (i === 0) g.moveTo(px, py);
      else g.lineTo(px, py);
    });
    const stroke = new Path2D();
    history.forEach((p, i) => {
      const px = x(i);
      const py = y(Number(p.price));
      if (i === 0) stroke.moveTo(px, py);
      else stroke.lineTo(px, py);
    });
    g.lineTo(nowX, H);
    g.lineTo(0, H);
    g.closePath();
    const grad = g.createLinearGradient(0, 0, 0, H);
    grad.addColorStop(0, C.greenFill);
    grad.addColorStop(1, "rgba(61,220,132,0)");
    g.fillStyle = grad;
    g.fill();

    g.strokeStyle = C.green;
    g.lineWidth = 1.6;
    g.lineJoin = "round";
    g.stroke(stroke);

    // ---- dashed rule at the live price, with its own label
    g.strokeStyle = C.dim;
    g.setLineDash([3, 3]);
    g.lineWidth = 1;
    g.beginPath();
    g.moveTo(0, spotY);
    g.lineTo(nowX, spotY);
    g.stroke();
    g.setLineDash([]);

    // ---- the band being bought: amber dashed box out to the cutoff
    g.fillStyle = "rgba(255,159,10,0.07)";
    g.fillRect(nowX, yHigh, W - nowX, yLow - yHigh);

    g.strokeStyle = C.amber;
    g.lineWidth = 1.2;
    g.setLineDash([4, 3]);
    g.beginPath();
    g.moveTo(nowX, yHigh);
    g.lineTo(W, yHigh);
    g.moveTo(nowX, yLow);
    g.lineTo(W, yLow);
    g.moveTo(W - 1, yHigh);
    g.lineTo(W - 1, yLow);
    g.stroke();
    g.setLineDash([]);

    // Solid amber rule at "now" closing the left edge of the box.
    g.beginPath();
    g.moveTo(nowX, yHigh);
    g.lineTo(nowX, yLow);
    g.stroke();

    // ---- the round burning down toward the cutoff
    if (progress > 0) {
      g.fillStyle = "rgba(255,159,10,0.16)";
      g.fillRect(nowX, yHigh, (W - nowX) * Math.min(1, progress), yLow - yHigh);
    }

    /**
     * The bands actually riding, drawn last so nothing can bury them.
     *
     * This used to run *before* the amber box and paint a winning band in `C.dim` at half
     * alpha. Two consequences, both bad: a position on the band currently displayed vanished
     * completely under the amber fill drawn over it — which is the common case, because most
     * people fire the band that is on screen — and the one time a band did show, being in the
     * money looked like being switched off.
     *
     * Now they sit on top and they are live: **green while the price is inside, red while it
     * is outside**, updated on every frame. That turns the chart from a picture of a band you
     * might buy into a readout of the ones you own, which is the only version worth having on
     * screen while a round is running.
     */
    openBands.forEach((b) => {
      const inMoney = b.won !== false;
      const top = y(Number(b.high));
      const height = y(Number(b.low)) - top;

      g.fillStyle = inMoney ? "rgba(61,220,132,0.09)" : "rgba(232,69,60,0.09)";
      g.fillRect(nowX, top, W - nowX, height);

      g.strokeStyle = inMoney ? C.green : C.red;
      g.lineWidth = 1;
      g.setLineDash([3, 2]);
      g.strokeRect(nowX + 0.5, top + 0.5, W - nowX - 1, height - 1);
      g.setLineDash([]);

      // A solid cap at "now", so overlapping positions on the same band still read as more
      // than one edge rather than as a single rectangle.
      g.beginPath();
      g.moveTo(nowX, top);
      g.lineTo(nowX, top + height);
      g.lineWidth = 2;
      g.stroke();
    });

    /**
     * The settlement, expanding from the point it printed at.
     *
     * A settled round currently announces itself with a word in the corner, which is
     * the one place the eye is not — it is on the band, watching whether the price is
     * inside it. The ring starts at the print and grows outward, so the answer arrives
     * where the question was being asked.
     */
    if (settleFlash) {
      const age = (Date.now() - settleFlash.at) / 620;
      if (age >= 0 && age <= 1) {
        const cy = y(Number(settleFlash.price));
        const r = 6 + age * 46;
        g.beginPath();
        g.arc(nowX, cy, r, 0, Math.PI * 2);
        g.strokeStyle = settleFlash.won
          ? `rgba(61,220,132,${(1 - age) * 0.85})`
          : `rgba(232,69,60,${(1 - age) * 0.85})`;
        g.lineWidth = 2;
        g.stroke();
      }
    }

    // ---- the live dot
    g.fillStyle = C.amber;
    g.beginPath();
    g.arc(nowX, spotY, 4.5, 0, Math.PI * 2);
    g.fill();

    // ---- labels
    g.font = "500 10px ui-monospace, monospace";
    g.textBaseline = "middle";
    g.fillStyle = C.dim;
    g.textAlign = "right";
    g.fillText(`— ${fmtPrice(spot, market.dp)}`, nowX - 8, spotY);

    // The band's actual prices. A player putting money on a range has to be able to
    // read the range, not just see it.
    g.fillStyle = C.amber;
    g.font = "600 10px ui-monospace, monospace";
    g.textAlign = "left";
    /**
     * One label when the two edges are the same number.
     *
     * The direction game collapses the band to a single reference line, and labelling both
     * ends of it printed the same price twice, eight pixels apart. Two identical numbers
     * stacked on a chart look like a rendering fault whether or not the reader knows why.
     */
    if (low === high) {
      g.fillText(fmtPrice(low, market.dp), nowX + 6, Math.min(H - 8, yLow + 8));
    } else {
      g.fillText(fmtPrice(high, market.dp), nowX + 6, Math.max(8, yHigh - 8));
      g.fillText(fmtPrice(low, market.dp), nowX + 6, Math.min(H - 8, yLow + 8));
    }

    g.textAlign = "right";
    g.fillText(`NEXT ${fmtMultiplier(multiplierBps)}`, W - 4, 12);
    g.textAlign = "left";
  }, [history, size, spot, low, high, market, multiplierBps, progress, settleFlash, openBands, scale]);

  // Dragging either amber rule repaints the band.
  const half1e4From = (clientY: number, side: "low" | "high") => {
    const rect = ref.current!.getBoundingClientRect();
    const { min, max } = scale();
    const price = min + (1 - (clientY - rect.top) / rect.height) * (max - min);
    const diff = side === "low" ? Number(spot) - price : price - Number(spot);
    return BigInt(Math.max(1, Math.round((diff / Number(spot)) * 1e8)));
  };

  const onDown = (e: React.PointerEvent) => {
    if (!onDragEdge) return;
    const rect = ref.current!.getBoundingClientRect();
    const { min, max } = scale();
    const yOf = (p: bigint) => (1 - (Number(p) - min) / (max - min)) * rect.height;
    const py = e.clientY - rect.top;
    drag.current = Math.abs(py - yOf(low)) < Math.abs(py - yOf(high)) ? "low" : "high";
    (e.target as Element).setPointerCapture(e.pointerId);
  };

  const onMove = (e: React.PointerEvent) => {
    if (!drag.current || !onDragEdge) return;
    onDragEdge(drag.current, half1e4From(e.clientY, drag.current));
  };

  return (
    <div ref={wrap} className="relative h-full w-full">
      <canvas
        ref={ref}
        /**
         * Sized by CSS to its container, not by state.
         *
         * The backing store is still `size` — that is what the drawing maths is in — but the
         * element's own width is the wrapper's, so it cannot overflow no matter what the
         * state says. Driving the CSS width from state meant one missed resize notification
         * left a 330px canvas inside a 240px frame, and a horizontal scrollbar on every
         * phone narrower than 370px. A stale size now costs a blurred frame instead.
         */
        style={{ width: "100%", height: "100%", display: "block", touchAction: "none" }}
        className={onDragEdge ? "cursor-ns-resize" : undefined}
        onPointerDown={onDown}
        onPointerMove={onMove}
        onPointerUp={(e) => {
          drag.current = null;
          (e.target as Element).releasePointerCapture?.(e.pointerId);
        }}
      />
    </div>
  );
}
