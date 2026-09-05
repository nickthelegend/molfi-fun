import { ogImage, OG_SIZE, OG_TYPE } from "@/lib/og";

export const alt = "molfi.fun — prediction markets where your position is private";
export const size = OG_SIZE;
export const contentType = OG_TYPE;

export default function Image() {
  return ogImage({
    eyebrow: "Prediction markets, settled on Starknet",
    title: "Nobody sees your position",
    blurb: "Pick a range, stake on it, and stay sealed until the market settles.",
  });
}
