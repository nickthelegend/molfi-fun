import { PokerTable } from '../components/PokerTable';
import { BettingPanel } from '../components/BettingPanel';
import { HandStrength } from '../components/HandStrength';
import { EventLog } from '../components/EventLog';
import { LoadingOverlay } from '../components/LoadingOverlay';
import type { CardSlot, LogEntry, PolledState } from '../types';
import { PHASE_NAMES } from '../types';
import type { PlayerAction } from '../game/phase-logic';
import { useState, useEffect, useRef, useLayoutEffect, useCallback } from 'react';

interface Props {
  myPlayerIndex: number;
  polledState: PolledState;
  myHoleCards: CardSlot[];
  otherPlayersHoleCards: Map<number, CardSlot[]>;
  communityCards: CardSlot[];
  currentAction: PlayerAction | null;
  logs: LogEntry[];
  loading: boolean;
  loadingMessage: string;
  error: string | null;
  bigBlind: bigint;
  onFold: () => void;
  onCheck: () => void;
  onCall: () => void;
  onRaise: (amount: bigint) => void;
}

export function GameScreen({
  myPlayerIndex,
  polledState,
  myHoleCards,
  otherPlayersHoleCards,
  communityCards,
  currentAction,
  logs,
  loading,
  loadingMessage,
  error,
  bigBlind,
  onFold,
  onCheck,
  onCall,
  onRaise,
}: Props) {
  const isBetting = currentAction?.type === 'BET';
  const isWaiting = currentAction?.type === 'WAIT';
  const [dismissedError, setDismissedError] = useState<string | null>(null);
  const [showLogs, setShowLogs] = useState(false);
  const [contentScale, setContentScale] = useState(1);
  const fitAreaRef = useRef<HTMLDivElement>(null);
  const fitContentRef = useRef<HTMLDivElement>(null);

  const recalculateScale = useCallback(() => {
    const area = fitAreaRef.current;
    const content = fitContentRef.current;
    if (!area || !content) return;

    const areaW = area.clientWidth;
    const areaH = area.clientHeight;
    const contentW = content.offsetWidth;
    const contentH = content.offsetHeight;

    if (areaW <= 0 || areaH <= 0 || contentW <= 0 || contentH <= 0) {
      setContentScale(1);
      return;
    }

    const nextScale = Math.min(areaW / contentW, areaH / contentH, 1);
    setContentScale(nextScale);
  }, []);

  useEffect(() => {
    if (error !== dismissedError) setDismissedError(null);
  }, [error]);

  const visibleError = error && error !== dismissedError ? error : null;

  useLayoutEffect(() => {
    recalculateScale();

    const area = fitAreaRef.current;
    const content = fitContentRef.current;
    if (!area || !content || typeof ResizeObserver === 'undefined') return;

    const observer = new ResizeObserver(() => recalculateScale());
    observer.observe(area);
    observer.observe(content);

    return () => observer.disconnect();
  }, [recalculateScale, showLogs, isBetting, currentAction?.type, visibleError]);

  return (
    <div className="h-screen flex overflow-hidden relative">
      {/* Video background — covers entire screen */}
      <video
        className="absolute inset-0 w-full h-full object-cover z-0"
        src="/assets/game-bg.mp4"
        autoPlay loop muted playsInline
      />
      <div className="absolute inset-0 bg-black/40 z-0" />

      {/* Main row: table area (with action bar overlaid at bottom) + log sidebar */}
      {/* Table column — takes remaining space */}
      <div className="relative z-10 flex-1 flex flex-col min-w-0">

        {/* Phase indicator — top left with neon style */}
        {polledState.gameState === 3 && PHASE_NAMES[polledState.pokerPhase] && (
          <div className="absolute top-16 left-16 z-20">
            <div className="flex items-center gap-3 px-5 py-2 rounded-full bg-black/70 border border-cyan-400/30"
              style={{ boxShadow: '0 0 8px rgba(34,211,238,0.25), 0 0 20px rgba(34,211,238,0.1), inset 0 0 8px rgba(34,211,238,0.05)' }}
            >
              <span className="text-sm font-bold uppercase tracking-[0.2em]"
                style={{ color: '#67e8f9', textShadow: '0 0 6px rgba(34,211,238,0.6), 0 0 14px rgba(34,211,238,0.3)' }}
              >
                {PHASE_NAMES[polledState.pokerPhase]}
              </span>
              {polledState.handNumber > 0 && (
                <>
                  <span className="w-px h-3.5 bg-cyan-400/20" />
                  <span className="text-[10px] font-mono tracking-wider"
                    style={{ color: '#67e8f9aa', textShadow: '0 0 4px rgba(34,211,238,0.3)' }}
                  >
                    Hand #{polledState.handNumber + 1}
                  </span>
                </>
              )}
            </div>
          </div>
        )}

        {/* Logo — bottom left */}
        <a href="https://play.jokersofneon.com/" target="_blank" rel="noopener noreferrer" className="absolute bottom-4 right-16 z-20">
          <img src="/logo.png" alt="Logo" className="w-72 h-72 object-contain" />
        </a>

        {/* Table area — fills space above the action bar */}
        <div className="flex-1 px-3 py-3 min-h-0 min-w-0">
          <div ref={fitAreaRef} className="w-full h-full overflow-hidden relative">
            <div className="absolute inset-0 flex items-center justify-center">
              <div
                className="origin-center"
                style={{ transform: `scale(${contentScale})` }}
              >
                <div ref={fitContentRef} className="px-28 py-16">
                  <PokerTable
                    polledState={polledState}
                    myPlayerIndex={myPlayerIndex}
                    myHoleCards={myHoleCards}
                    otherPlayersHoleCards={otherPlayersHoleCards}
                    communityCards={communityCards}
                  />
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* Error banner */}
        {visibleError && (
          <div className="flex-shrink-0 flex items-center justify-center gap-2 px-4 py-2 bg-red-950/40">
            <span className="text-[10px] text-red-400 line-clamp-1">{visibleError}</span>
            <button
              onClick={() => setDismissedError(visibleError)}
              className="shrink-0 text-red-600 hover:text-red-400 text-[11px] leading-none"
            >x</button>
          </div>
        )}

        {/* Action bar — fixed height, bottom of table column */}
        <div className="flex-shrink-0 h-[100px] flex items-center justify-center px-4">
          {isBetting && currentAction.type === 'BET' ? (
            <div className="flex w-full max-w-2xl flex-col gap-1.5">
              <div className="flex justify-center">
                <HandStrength holeCards={myHoleCards} communityCards={communityCards} />
              </div>
              <BettingPanel
                options={currentAction.options}
                currentBet={polledState.currentBet}
                myBet={polledState.bets[myPlayerIndex]}
                myStack={polledState.stacks[myPlayerIndex]}
                pot={polledState.pot}
                bigBlind={bigBlind}
                onFold={onFold}
                onCheck={onCheck}
                onCall={onCall}
                onRaise={onRaise}
                disabled={loading}
              />
            </div>
          ) : (
            <div className="flex flex-col items-center gap-2">
              {isWaiting && currentAction?.type === 'WAIT' ? (
                <div className="flex items-center gap-3">
                  <span className="w-4 h-4 rounded-full border-2 border-white/10 border-t-white/50 animate-spin inline-block" />
                  <span className="text-sm text-white/40 uppercase tracking-widest">
                    {currentAction.message}
                  </span>
                </div>
              ) : loading ? (
                <div className="flex items-center gap-3">
                  <span className="w-4 h-4 rounded-full border-2 border-white/10 border-t-white/50 animate-spin inline-block" />
                  <span className="text-sm text-white/40 uppercase tracking-widest">{loadingMessage}</span>
                </div>
              ) : polledState.gameState === 3 ? (
                <div className="flex items-center gap-3">
                  <span className="w-3 h-3 rounded-full bg-white/10 animate-pulse" />
                  <span className="text-sm text-white/30 uppercase tracking-widest">
                    Waiting for Player {polledState.actionPlayer + 1}
                  </span>
                </div>
              ) : polledState.gameState < 3 ? (
                <div className="flex items-center gap-3">
                  <span className="w-4 h-4 rounded-full border-2 border-white/10 border-t-white/50 animate-spin inline-block" />
                  <span className="text-sm text-white/30 uppercase tracking-widest">
                    {polledState.gameState === 1 ? 'Waiting for players...' : 'Shuffling deck...'}
                  </span>
                </div>
              ) : null}
            </div>
          )}
        </div>
      </div>

      {/* Right sidebar: event log — full height */}
      {showLogs && (
        <div className="relative z-10 flex-shrink-0">
          <EventLog logs={logs} onHide={() => setShowLogs(false)} />
        </div>
      )}

      {!showLogs && (
        <button
          onClick={() => setShowLogs(true)}
          className="absolute top-3 right-3 z-20 px-3 py-1.5 rounded-md bg-black/60 border border-white/15 text-white/70 hover:text-white text-[10px] uppercase tracking-widest"
        >
          Logs
        </button>
      )}

      <LoadingOverlay message={loadingMessage} visible={loading} />
    </div>
  );
}
