#!/usr/bin/env node
/**
 * Top up a Sepolia address from the Starknet Foundation faucet's public Agent API.
 *
 * No auth. The request is gated by a proof of work solved locally — a few hundred thousand
 * SHA-256 rounds, under a second — plus a quota, a global daily cap, and a 24 hour cooldown
 * per address. The public tier drips 5 STRK; the web form gives 100, and a GitHub sign-in
 * unlocks 3,000. Only the first of those is something a script can do on its own.
 *
 * `ADDRESS_COOLDOWN` is reported with the seconds remaining rather than retried. Farming
 * fresh addresses to get around it would work and would be abuse of a shared testnet
 * resource, so this asks once for the address it was given.
 *
 * Usage: node --experimental-strip-types scripts/faucet.mjs <address>
 */
import { createHash } from "node:crypto";

const BASE = "https://api.faucet.starknet.io";
const address = process.argv[2];
if (!address) {
  console.error("usage: faucet.mjs <address>");
  process.exit(1);
}

const post = async (path, body) => {
  const r = await fetch(`${BASE}${path}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) {
    if (j.code === "ADDRESS_COOLDOWN") {
      const hours = ((j.retryAfterSeconds ?? 0) / 3600).toFixed(1);
      console.error(`\n  on cooldown for another ${hours}h — the faucet allows one drip per address per 24h.`);
      console.error(`  For more now: https://faucet.starknet.io gives 100 STRK from the form, or 3,000 with a GitHub sign-in.\n`);
      process.exit(2);
    }
    throw new Error(`${path} → ${r.status} ${JSON.stringify(j).slice(0, 300)}`);
  }
  return j;
};

/** Leading zero *bits*, checked bit-wise: the difficulty need not be a whole hex digit. */
function hasLeadingZeroBits(buf, bits) {
  let full = bits >> 3;
  for (let i = 0; i < full; i += 1) if (buf[i] !== 0) return false;
  const rem = bits & 7;
  if (rem === 0) return true;
  return (buf[full] >> (8 - rem)) === 0;
}

console.log(`requesting a challenge for ${address}`);
const ch = await post("/api/public-agent/pow/challenge", { userAddress: address });
const { challengeId, powInputPrefix, difficulty } = ch.data ?? ch;
console.log(`  challenge ${challengeId}, difficulty ${difficulty} bits`);

const t0 = Date.now();
let nonce = 0;
for (;;) {
  const h = createHash("sha256").update(powInputPrefix + nonce).digest();
  if (hasLeadingZeroBits(h, difficulty)) break;
  nonce += 1;
  if (nonce % 5_000_000 === 0) console.log(`  ${(nonce / 1e6).toFixed(0)}M tried…`);
}
console.log(`  solved: nonce ${nonce} in ${((Date.now() - t0) / 1000).toFixed(1)}s`);

const req = await post("/api/public-agent/faucet/request", {
  userAddress: address,
  challengeId,
  nonce: String(nonce),
});
const { requestId, pollAfterSeconds } = req.data ?? req;
console.log(`  queued as ${requestId}`);

let wait = pollAfterSeconds ?? 3;
for (let i = 0; i < 60; i += 1) {
  await new Promise((r) => setTimeout(r, wait * 1000));
  const r = await fetch(`${BASE}/api/public-agent/faucet/status/${requestId}`);
  const j = await r.json();
  const d = j.data ?? j;
  console.log(`  ${d.jobStatus}${d.txHash ? ` ${d.txHash}` : ""}`);
  if (d.jobStatus === "confirmed") { console.log(`\nfunded: ${d.txHash}\n`); process.exit(0); }
  if (d.jobStatus === "failed") { console.error(`\nfailed: ${JSON.stringify(d)}\n`); process.exit(1); }
  wait = d.pollAfterSeconds ?? wait;
}
console.error("timed out waiting for the drip");
process.exit(1);
