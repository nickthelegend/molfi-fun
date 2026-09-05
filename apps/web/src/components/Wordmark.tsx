/**
 * XORR as a block wordmark — drawn from a 5x5 bitmap grid rather than hand-placed
 * rectangles, so the glyphs are guaranteed symmetric and an R can never come out
 * mirrored. Reads as hardware rather than a font choice, and holds up at any size.
 */
const GLYPHS: Record<string, string[]> = {
  X: ["10001", "01010", "00100", "01010", "10001"],
  O: ["01110", "10001", "10001", "10001", "01110"],
  R: ["11110", "10001", "11110", "10010", "10001"],
};

const UNIT = 6;
const GAP = 1; // blank columns between letters, in units

export function Wordmark({
  className = "",
  height = 34,
  word = "XORR",
}: {
  className?: string;
  height?: number;
  word?: string;
}) {
  const rects: { x: number; y: number }[] = [];
  let cursor = 0;

  for (const ch of word) {
    const g = GLYPHS[ch];
    if (!g) {
      cursor += 5 + GAP;
      continue;
    }
    g.forEach((row, ry) => {
      [...row].forEach((cell, rx) => {
        if (cell === "1") rects.push({ x: (cursor + rx) * UNIT, y: ry * UNIT });
      });
    });
    cursor += 5 + GAP;
  }

  const w = (cursor - GAP) * UNIT;
  const h = 5 * UNIT;

  return (
    <svg
      viewBox={`0 0 ${w} ${h}`}
      height={height}
      className={className}
      role="img"
      aria-label={word}
      fill="currentColor"
    >
      {rects.map((r, i) => (
        <rect key={i} x={r.x} y={r.y} width={UNIT} height={UNIT} />
      ))}
    </svg>
  );
}
