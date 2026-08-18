import { ogImage, OG_SIZE, OG_TYPE } from "@/lib/og";

export const alt = "molfi.fun — staked games settled on Starknet";
export const size = OG_SIZE;
export const contentType = OG_TYPE;

export default function Image() {
  return ogImage({
    eyebrow: "Staked games, settled on Starknet",
    title: "Privacy as the mechanic",
    blurb: "Buy in without putting your name on the table. Settle onchain, checkable afterwards.",
  });
}
