import { createHash } from "node:crypto";

/**
 * Top the keeper up from the Starknet Foundation's public agent faucet.
 *
 * The faucet draws the distinction itself: its page says "Funding a script or AI agent?
 * API →" and puts the browser tiers behind a Turnstile and a GitHub sign-in. This is the
 * sanctioned path for an unattended process, gated by a proof of work solved locally and a
 * hard one-drip-per-address-per-24h cooldown.
 *
 * It exists because the desk stopping is the failure this project can least afford, and the
 * only reason it stopped was that nobody was there to run a script. A keeper that settles
 * markets unattended and then needs a human to keep its own lights on is not unattended.
 *
 * What it will not do: ask for a second address. The cooldown is per address and farming
 * fresh ones to get around it is abuse of a shared resource that other people are trying to
 * build against. On `ADDRESS_COOLDOWN` this waits exactly as long as it is told to.
 */
const BASE = "https://api.faucet.starknet.io";

export interface Drip {
  ok: boolean;
  detail: string;
  txHash?: string;
  /** Unix seconds before which there is no point asking again. */
  retryAfter?: number;
}

/** Leading zero *bits*, checked bit-wise: the difficulty need not be a whole hex digit. */
function hasLeadingZeroBits(buf: Buffer, bits: number): boolean {
  const full = bits >> 3;
  for (let i = 0; i < full; i += 1) if (buf[i] !== 0) return false;
  const rem = bits & 7;
  if (rem === 0) return true;
  return buf[full] >> (8 - rem) === 0;
}

async function post(path: string, body: unknown) {
  const res = await fetch(`${BASE}${path}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  const json = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  return { ok: res.ok, status: res.status, json };
}

export async function requestDrip(address: string): Promise<Drip> {
  const challenge = await post("/api/public-agent/pow/challenge", { userAddress: address });
  if (!challenge.ok) {
    const code = challenge.json.code;
    if (code === "ADDRESS_COOLDOWN") {
      const seconds = Number(challenge.json.retryAfterSeconds ?? 24 * 3600);
      return {
        ok: false,
        detail: `on cooldown for another ${(seconds / 3600).toFixed(1)}h`,
        retryAfter: Math.floor(Date.now() / 1000) + seconds,
      };
    }
    return { ok: false, detail: `challenge refused: ${JSON.stringify(challenge.json).slice(0, 120)}` };
  }

  const c = (challenge.json.data ?? challenge.json) as {
    challengeId: string;
    powInputPrefix: string;
    difficulty: number;
  };

  /**
   * Solved inline, and that is deliberate.
   *
   * A few hundred thousand SHA-256 rounds is well under a second, and the keeper's cycle is
   * two minutes — but the difficulty is the faucet's to choose, so this refuses to spin
   * forever if it is ever raised. Missing a drip is recoverable; a keeper stuck in a hash
   * loop while markets go unsettled is not.
   */
  const deadline = Date.now() + 20_000;
  let nonce = 0;
  for (;;) {
    if (hasLeadingZeroBits(createHash("sha256").update(c.powInputPrefix + nonce).digest(), c.difficulty)) break;
    nonce += 1;
    if ((nonce & 0xfffff) === 0 && Date.now() > deadline) {
      return { ok: false, detail: `proof of work exceeded 20s at difficulty ${c.difficulty}` };
    }
  }

  const req = await post("/api/public-agent/faucet/request", {
    userAddress: address,
    challengeId: c.challengeId,
    nonce: String(nonce),
  });
  if (!req.ok) {
    return { ok: false, detail: `request refused: ${JSON.stringify(req.json).slice(0, 120)}` };
  }

  const r = (req.json.data ?? req.json) as { requestId: string; pollAfterSeconds?: number };
  let wait = r.pollAfterSeconds ?? 3;
  for (let i = 0; i < 20; i += 1) {
    await new Promise((res) => setTimeout(res, wait * 1000));
    const status = await fetch(`${BASE}/api/public-agent/faucet/status/${r.requestId}`);
    const body = (await status.json().catch(() => ({}))) as Record<string, unknown>;
    const d = (body.data ?? body) as { jobStatus?: string; txHash?: string; pollAfterSeconds?: number };
    if (d.jobStatus === "confirmed") {
      return { ok: true, detail: "funded by the public agent faucet", txHash: d.txHash };
    }
    if (d.jobStatus === "failed") {
      return { ok: false, detail: `faucet job failed: ${JSON.stringify(d).slice(0, 120)}` };
    }
    wait = d.pollAfterSeconds ?? wait;
  }
  return { ok: false, detail: "the faucet did not confirm within the polling window" };
}
