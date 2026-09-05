"use client";

import { Component, type ReactNode } from "react";

/**
 * One sheet failing must not take the console with it.
 *
 * Every screen behind the menu talks to something that can be absent or malformed — a
 * deployment with no room market, a book with an empty ladder, a leaderboard scanning
 * events from a chain that just restarted. A throw in any of them unmounts the whole
 * tree, and the player loses the desk they were mid-round on because they tapped
 * Achievements.
 *
 * The message says which screen and what the error was, because "something went wrong"
 * is the one sentence that helps nobody. Going back is always available — the sheet is
 * remounted on the next open, so a transient failure clears itself.
 */
export class SheetBoundary extends Component<
  { title: string; children: ReactNode },
  { error: Error | null }
> {
  state: { error: Error | null } = { error: null };

  static getDerivedStateFromError(error: Error) {
    return { error };
  }

  render() {
    if (!this.state.error) return this.props.children;
    return (
      <div className="mt-8 px-2 text-center">
        <p className="text-[13px] font-semibold text-red">
          {this.props.title} could not be shown
        </p>
        <p className="mono mt-3 break-words text-[11px] leading-relaxed text-white/45">
          {this.state.error.message.slice(0, 220)}
        </p>
        <p className="mt-4 text-[11px] leading-relaxed text-white/35">
          The desk behind this sheet is unaffected. Close and reopen to try again.
        </p>
      </div>
    );
  }
}
