import { useMemo } from 'react';
import { evaluateBestHand } from '../game/hand-evaluator';
import type { CardSlot } from '../types';

/**
 * What you are currently holding, named.
 *
 * The showdown overlay already ran this evaluator to decide who won. Running it on your own
 * two cards plus whatever is on the board tells you the same thing while it can still change
 * your decision, which is the moment it is worth knowing.
 *
 * This reads nothing that is not already on this player's screen. The hole cards used here
 * are the ones already decrypted locally for display, and the board is public, so showing it
 * gives away nothing that the client did not already have.
 */
export function HandStrength({
  holeCards,
  communityCards,
}: {
  holeCards: CardSlot[];
  communityCards: CardSlot[];
}) {
  const hand = useMemo(() => {
    const hole = holeCards.map((c) => c.value);
    const board = communityCards.map((c) => c.value);
    return evaluateBestHand(hole, board);
  }, [holeCards, communityCards]);

  const known = [...holeCards, ...communityCards].filter((c) => c.value !== null).length;

  // Before the flop there are only two known cards, which is not five, so the evaluator
  // correctly declines to name a hand. Saying how many cards are still needed is more use
  // than an empty space or a fabricated "high card".
  if (!hand) {
    return (
      <div className="flex items-center gap-2 text-[10px] uppercase tracking-widest text-white/25">
        <span>Your hand</span>
        <span className="text-white/40">
          {known < 2 ? 'not dealt' : `${5 - known} more card${5 - known === 1 ? '' : 's'}`}
        </span>
      </div>
    );
  }

  return (
    <div className="flex items-center gap-2 text-[10px] uppercase tracking-widest">
      <span className="text-white/25">Your hand</span>
      <span className="font-semibold text-emerald-400">{hand.desc}</span>
    </div>
  );
}
