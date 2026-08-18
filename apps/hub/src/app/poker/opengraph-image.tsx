import { ogImage, OG_SIZE, OG_TYPE } from "@/lib/og";

export const alt = "Poker — no dealer, no server, proved deals";
export const size = OG_SIZE;
export const contentType = OG_TYPE;

export default function Image() {
  return ogImage({
    eyebrow: "Texas Hold'em",
    title: "No dealer",
    blurb: "The players shuffle and deal between themselves, and the deal is proved correct.",
  });
}
