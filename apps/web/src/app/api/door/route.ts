import { NextResponse } from "next/server";
import { readDoor } from "@/lib/door";

/**
 * One question, cheaply, and always 200: can a new visitor be given an account?
 *
 * The gate used to ask `/api/health` for this. That endpoint answers a different and much
 * larger question — the node, nine oracle pairs, the market contract, the pool and the keeper —
 * and it answers **503 when the deployment is degraded**, which is right for an operator and
 * wrong for a front door. Two consequences, both real and both seen on production: `/play`
 * logged a red 503 in the console on a page a judge opens, and the door check waited on nine
 * chain reads before it could decide whether to show the button.
 *
 * This is one balance read. It reports `down` and `degraded` in the body with 200, because a
 * shut door is an answer, not a failure to answer.
 */
export const dynamic = "force-dynamic";
export const revalidate = 0;

export async function GET() {
  return NextResponse.json(await readDoor(), { headers: { "cache-control": "no-store" } });
}
