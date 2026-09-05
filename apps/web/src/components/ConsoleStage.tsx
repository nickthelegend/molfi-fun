"use client";

import dynamic from "next/dynamic";
import { usePrefs, usePrefersReducedMotion } from "@/lib/usePrefs";

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

export function ConsoleStage({ spin = true }: { spin?: boolean }) {
  const { prefs } = usePrefs();
  const osReduced = usePrefersReducedMotion();

  // Reduced motion means still, not slower. The console holds its pose.
  const animate = spin && !prefs.reducedMotion && !osReduced;
  return <Console3D spin={animate} />;
}
