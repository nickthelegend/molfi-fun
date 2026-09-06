"use client";

import dynamic from "next/dynamic";
import { useEffect, useState } from "react";
import { usePrefs, usePrefersReducedMotion } from "@/lib/usePrefs";
import { ConsoleStill } from "@/components/landing/ConsoleStill";

/**
 * Client boundary for the WebGL hero. Next will not let a Server Component opt out of
 * SSR, and a canvas cannot be server-rendered. The page reads fine before it loads.
 */
const Console3D = dynamic(() => import("./device/Console3D").then((m) => m.Console3D), {
  ssr: false,
  loading: () => (
    <div className="grid h-full w-full place-items-center">
      <span className="label">loading</span>
    </div>
  ),
});

export function ConsoleStage({ spin = true, spot = null }: { spin?: boolean; spot?: string | null }) {
  const { prefs } = usePrefs();
  const osReduced = usePrefersReducedMotion();
  const [webgl, setWebgl] = useState<boolean | null>(null);

  /**
   * Ask for a context before mounting the canvas, not after it fails.
   *
   * The 3D component has an error boundary, but by the time it catches, the page has already
   * committed to a hero it cannot draw and the reader sees a sentence where the product should
   * be. Browsers run out of WebGL contexts on long-lived tabs, disable it under low power, and
   * block it behind some privacy settings — all of which are ordinary, none of which should
   * cost a visitor the one thing this page is about. Probing first means the still is chosen
   * deliberately rather than arrived at by failure.
   */
  useEffect(() => {
    try {
      const c = document.createElement("canvas");
      const gl = c.getContext("webgl2") ?? c.getContext("webgl");
      (gl?.getExtension("WEBGL_lose_context") as { loseContext?: () => void } | null)
        ?.loseContext?.();
      setWebgl(Boolean(gl));
    } catch {
      setWebgl(false);
    }
  }, []);

  // Null is "not asked yet" — the still renders, so there is never an empty frame.
  if (webgl === false || webgl === null) return <ConsoleStill spot={spot} />;

  // Reduced motion means still, not slower. The console holds its pose.
  const animate = spin && !prefs.reducedMotion && !osReduced;
  return <Console3D spin={animate} />;
}
