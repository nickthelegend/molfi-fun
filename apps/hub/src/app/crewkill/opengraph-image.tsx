import { ogImage, OG_SIZE, OG_TYPE } from "@/lib/og";

export const alt = "CrewKill — social deduction, settled on Starknet";
export const size = OG_SIZE;
export const contentType = OG_TYPE;

export default function Image() {
  return ogImage({
    eyebrow: "Social deduction",
    title: "CrewKill",
    blurb: "Six seats, four rounds, one pot. A seat is a commitment, never an address.",
  });
}
