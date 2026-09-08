"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Wordmark } from "@/components/Wordmark";

/**
 * The bar that says whose site this is.
 *
 * molfi shipped its landing page with no name on it. The `Wordmark` component existed, the
 * logo existed, and neither was imported anywhere — so the first thing a visitor saw was an
 * unattributed console floating on a dark page. A product whose whole pitch is "you can check
 * every claim here yourself" should at minimum say what it is called.
 *
 * The mark is the bitmap `Wordmark` rather than the display font: it is the same grid the
 * device's own screen is drawn on, so the header reads as part of the hardware instead of a
 * label stuck on top of it.
 *
 * Transparent over the hero and solid once the page moves, because the hero is a lit object on
 * a dark ground and a bar with its own background sitting across it flattens the one image the
 * page is built around.
 */
export function SiteHeader() {
  const [stuck, setStuck] = useState(false);

  useEffect(() => {
    const onScroll = () => setStuck(window.scrollY > 24);
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  return (
    <header
      className={`fixed inset-x-0 top-0 z-50 transition-colors duration-300 ${
        stuck ? "border-b border-white/8 bg-[#0a0a0b]/85 backdrop-blur-md" : "border-b border-transparent"
      }`}
    >
      <div className="mx-auto flex h-14 w-full max-w-[1180px] items-center justify-between px-5">
        <Link
          href="/"
          aria-label="molfi — home"
          className="flex items-center gap-2.5 text-white transition-opacity hover:opacity-80"
        >
          <Wordmark height={15} className="text-amber" />
          <span className="mono hidden text-[9px] tracking-[0.2em] text-white/35 sm:block">
            STARKNET
          </span>
        </Link>

        <nav className="flex items-center gap-1.5">
          {[
            { href: "/privacy", label: "PRIVACY" },
            { href: "/verify", label: "VERIFY" },
            { href: "/keeper", label: "KEEPER" },
          ].map((l) => (
            <Link
              key={l.href}
              href={l.href}
              className="mono hidden rounded-full px-3 py-1.5 text-[9px] tracking-[0.14em] text-white/45 transition-colors hover:text-white/80 sm:block"
            >
              {l.label}
            </Link>
          ))}
          <Link
            href="/play"
            className="mono ml-1 rounded-full bg-amber-2 px-4 py-1.5 text-[9.5px] font-bold tracking-[0.14em] text-black transition-transform hover:scale-[1.03]"
          >
            PLAY
          </Link>
        </nav>
      </div>
    </header>
  );
}
