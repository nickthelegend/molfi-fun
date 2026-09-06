"use client";

/** A lit indicator square. Green when the thing it names is true, dark when it is not. */
function Led({ on, tone = "#3ddc84" }: { on: boolean; tone?: string }) {
  return (
    <span
      aria-hidden
      className="h-1.5 w-1.5 rounded-[1px]"
      style={{
        background: on ? tone : "#242424",
        boxShadow: on ? `0 0 6px ${tone}cc` : "none",
      }}
    />
  );
}

/**
 * The one row of chrome allowed above the content: what this console is talking to, and
 * what it is carrying.
 *
 * Both halves are facts about this session rather than dressing. The right-hand LED is lit
 * only when something is actually riding, so a dark one is information too.
 */
export function StatusBar({
  network,
  connected,
  riding,
  attract,
}: {
  network: string;
  connected: boolean;
  riding: number;
  attract?: boolean;
}) {
  return (
    <div className="mono flex items-center justify-between border-b border-[#191919] bg-screen-2 px-[11px] py-2 text-[9.5px] tracking-[0.15em] text-dim">
      <span className="flex items-center gap-1.5">
        <Led on={connected} />
        {network}
      </span>
      <span className="flex items-center gap-1.5">
        {attract ? <span className="blink text-amber">ATTRACT</span> : null}
        <span className="tnum text-white">{riding}</span> RIDING
        <Led on={riding > 0} tone="#ff9f0a" />
      </span>
    </div>
  );
}
