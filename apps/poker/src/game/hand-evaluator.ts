// Card encoding: value 0-51
// rank = value % 13  → 0=2, 1=3, 2=4, 3=5, 4=6, 5=7, 6=8, 7=9, 8=Ten, 9=J, 10=Q, 11=K, 12=A
// suit = Math.floor(value / 13) → 0=spades, 1=hearts, 2=diamonds, 3=clubs
// (Ranking only ever asks whether five suits are equal, so this ordering does not affect a
//  result - but it named the wrong suits, and a wrong comment is worse than none.)

const RANK_LABELS = ['2','3','4','5','6','7','8','9','T','J','Q','K','A'] as const;

function getRank(card: number): number { return card % 13; }
function getSuit(card: number): number { return Math.floor(card / 13); }

interface FiveCardResult {
  rank: number;       // 0-9
  desc: string;       // e.g. "Straight (7-high)", "Pair of Kings"
}

function evaluateFiveCards(cards: number[]): FiveCardResult {
  const ranks = cards.map(getRank).sort((a, b) => a - b);
  const suits = cards.map(getSuit);

  const rankCounts = new Map<number, number>();
  for (const r of ranks) rankCounts.set(r, (rankCounts.get(r) ?? 0) + 1);
  const countEntries = [...rankCounts.entries()].sort((a, b) => b[1] - a[1] || b[0] - a[0]);
  const counts = countEntries.map(e => e[1]);
  const byCount = countEntries.map(e => e[0]); // rank sorted by frequency desc, then rank desc

  const isFlush = suits.every(s => s === suits[0]);

  let isStraight = false;
  let straightHighCard = -1;
  if (new Set(ranks).size === 5) {
    if (ranks[4] - ranks[0] === 4) {
      isStraight = true;
      straightHighCard = ranks[4];
    }
    // Ace-low straight: A-2-3-4-5
    if (ranks[4] === 12 && ranks[0] === 0 && ranks[1] === 1 && ranks[2] === 2 && ranks[3] === 3) {
      isStraight = true;
      straightHighCard = 3; // 5-high (wheel)
    }
  }

  const hi = (r: number) => RANK_LABELS[r] ?? '?';

  if (isFlush && isStraight) {
    if (straightHighCard === 12) return { rank: 9, desc: 'Royal Flush' };
    return { rank: 8, desc: `Straight Flush (${hi(straightHighCard)}-high)` };
  }
  if (counts[0] === 4) return { rank: 7, desc: `Four ${hi(byCount[0])}s` };
  if (counts[0] === 3 && counts[1] === 2) return { rank: 6, desc: `Full House (${hi(byCount[0])}s full of ${hi(byCount[1])}s)` };
  if (isFlush) return { rank: 5, desc: `Flush (${hi(ranks[4])}-high)` };
  if (isStraight) {
    const label = straightHighCard === 3 ? 'Wheel (A-5)' : `${hi(straightHighCard)}-high`;
    return { rank: 4, desc: `Straight (${label})` };
  }
  if (counts[0] === 3) return { rank: 3, desc: `Three ${hi(byCount[0])}s` };
  if (counts[0] === 2 && counts[1] === 2) return { rank: 2, desc: `Two Pair (${hi(byCount[0])}s & ${hi(byCount[1])}s)` };
  if (counts[0] === 2) return { rank: 1, desc: `Pair of ${hi(byCount[0])}s` };
  return { rank: 0, desc: `${hi(ranks[4])}-high` };
}

function combinations(arr: number[], k: number): number[][] {
  if (k === 0) return [[]];
  if (arr.length < k) return [];
  const [first, ...rest] = arr;
  return [
    ...combinations(rest, k - 1).map(c => [first, ...c]),
    ...combinations(rest, k),
  ];
}

export interface HandDetails {
  rank: number;
  desc: string;
}

/** Evaluate best 5-card hand from hole + community cards. Returns null if not enough visible cards. */
export function evaluateBestHand(
  holeValues: (number | null)[],
  communityValues: (number | null)[],
): HandDetails | null {
  const all = [...holeValues, ...communityValues].filter((c): c is number => c !== null && c >= 0 && c < 52);
  if (all.length < 5) return null;

  let best: FiveCardResult | null = null;
  for (const combo of combinations(all, 5)) {
    const result = evaluateFiveCards(combo);
    if (!best || result.rank > best.rank) {
      best = result;
    }
  }
  return best;
}
