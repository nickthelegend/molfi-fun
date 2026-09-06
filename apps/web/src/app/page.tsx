import type { Metadata } from "next";
import { Hero } from "@/components/landing/Hero";
import { ChainSees } from "@/components/landing/ChainSees";
import { Games } from "@/components/landing/Games";
import { Markets } from "@/components/landing/Markets";
import { Proof } from "@/components/landing/Proof";
import { CTA } from "@/components/landing/CTA";

/**
 * The front door, laid out as a hardware page rather than a software one.
 *
 * molfi is a handheld. Not metaphorically — the entire product is a chassis with a bezel, a
 * glass, a knob and keys, and it is the same component whether you are looking at the landing
 * page or trading on it. So this page is built the way a page for a physical object is built:
 * the thing first and large, then the one claim that is hard to believe, then what it does,
 * then evidence, then the key you press. Not a hero over a mesh gradient with three equal
 * feature cards.
 *
 * The order is an argument, in the sequence a sceptic actually asks it:
 *
 *   Hero       — what is it (the real console, showing the real BTC price)
 *   ChainSees  — the claim I would not believe (the real calldata of a real trade)
 *   Games      — what can I actually do (the deck's own switch, the real mechanics)
 *   Markets    — on what (nine markets at their live prices, oracle named per market)
 *   Proof      — has anyone run it (counts read from the chain and the keeper)
 *   CTA        — one key
 *
 * Every number on the page is fetched. There is no placeholder copy and no illustrated UI:
 * the console is the real WebGL component, the calldata is a transaction anybody can open on
 * the explorer, and each price is the one the desk is quoting at that moment. For a product
 * whose whole pitch is that its numbers are real, an invented figure on the page making that
 * pitch would be the one unforgivable detail.
 */

export const metadata: Metadata = {
  title: "molfi — a handheld for bets nobody can see",
  description:
    "Pick where the price lands, or which way it goes. Your position is a hash until the round settles. Nine markets on Starknet, settled by a keeper anyone can check.",
};

export default function Home() {
  return (
    <main className="relative bg-ground">
      <Hero />
      <ChainSees />
      <Games />
      <Markets />
      <Proof />
      <CTA />
    </main>
  );
}
