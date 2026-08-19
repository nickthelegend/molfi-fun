"use client";

import { useEffect, useRef, useState } from "react";

/**
 * The card that turns over when your role resolves.
 *
 * Everything else in CrewKill is a number changing in a panel. This is the one moment that
 * happens to you exactly once and decides how you play the entire match, and until now it
 * appeared the same way a seat count does.
 *
 * The flip is deliberately the only real animation on the page. Motion spent everywhere is
 * motion that means nothing anywhere, and the point here is that the reader should feel the
 * difference between "sealed" and knowing.
 *
 * It fires once per role, tracked by ref rather than state, so a re-render for any other
 * reason does not replay it.
 */
export function RoleFlip({ role }: { role: "crew" | "impostor" | null }) {
  const [flipped, setFlipped] = useState(false);
  const played = useRef<string | null>(null);

  useEffect(() => {
    if (!role) {
      // Back to sealed, which happens on a new match. Reset so the next reveal plays.
      played.current = null;
      setFlipped(false);
      return;
    }
    if (played.current === role) return;

    // A frame of "sealed" before turning, so the change is something the eye catches rather
    // than a value that was simply always there.
    //
    // The ref is claimed inside the callback, not before it. React invokes effects twice in
    // development: claiming it up front meant the first run scheduled the flip, the cleanup
    // cancelled it, and the second run saw the role already claimed and did nothing - so the
    // card silently never turned. Claiming on commit makes the second run schedule again,
    // and a duplicate setFlipped(true) is harmless.
    const id = window.setTimeout(() => {
      played.current = role;
      setFlipped(true);
    }, 80);
    return () => window.clearTimeout(id);
  }, [role]);

  const tone =
    role === "impostor" ? "var(--color-alarm)" : role === "crew" ? "var(--color-cyan)" : "var(--color-dim)";

  return (
    <div className="role-flip" data-flipped={flipped}>
      <div className="role-flip-inner">
        <div className="role-face role-face-front">
          <span className="tele">Role</span>
          <span className="macro" style={{ color: "var(--color-dim)" }}>
            sealed
          </span>
        </div>
        <div className="role-face role-face-back">
          <span className="tele">Role</span>
          <span className="macro" style={{ color: tone }}>
            {role ?? "sealed"}
          </span>
        </div>
      </div>
    </div>
  );
}
