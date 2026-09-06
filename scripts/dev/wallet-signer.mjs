#!/usr/bin/env node
/**
 * A real Starknet wallet, for driving the console's wallet flows in a browser.
 *
 * Not a mock. It holds a real private key, signs with starknet.js, and submits to a real
 * chain; the transactions it sends land in blocks and the positions they open are readable
 * by anyone. What it is not is a browser *extension* — the key lives here and the page talks
 * to it over HTTP, which is the same shape as a hardware wallet or a WalletConnect session.
 *
 * It exists because the wallet-signed flows (K1–K6 in docs/TESTPLAN.md) cannot otherwise be
 * executed at all: no Starknet extension is installed in any browser available to the test
 * run, and installing one plus creating a wallet is not something to do on someone's behalf.
 * The alternative was to leave the entire connect → open → claim path in the UI untested,
 * which is the part of molfi a user actually touches.
 *
 * Devnet only, and it refuses anything else. The key below is a published starknet-devnet
 * seed account — worthless, and public on purpose. Pointing this at a network where a key
 * has value would be handing it to every page in the browser.
 *
 * Usage: node --experimental-strip-types scripts/dev/wallet-signer.mjs
 */

import { createServer } from "node:http";
import { Account, RpcProvider } from "starknet";

const RPC = process.env.DEV_WALLET_RPC ?? "http://127.0.0.1:5050";
const PORT = Number(process.env.DEV_WALLET_PORT ?? 5099);

/** starknet-devnet --seed 42, account #0. Published, worthless, and not a secret. */
const ADDRESS = process.env.DEV_WALLET_ADDRESS
  ?? "0x034ba56f92265f0868c57d3fe72ecab144fc96f97954bbbc4252cef8e8a979ba";
const KEY = process.env.DEV_WALLET_KEY ?? "0xb137668388dbe9acdfa3bc734cc2c469";

const provider = new RpcProvider({ nodeUrl: RPC });
const chainId = await provider.getChainId();

// A key with value must never be reachable from a web page. Devnet's chain id happens to
// equal Sepolia's, so the guard is the endpoint being local rather than the chain saying so.
if (!/127\.0\.0\.1|localhost/.test(RPC)) {
  console.error(`\nRefusing to run against ${RPC}.\n\nThis exposes a signing key to any page in the browser. It is for a local devnet only.\n`);
  process.exit(1);
}

const account = new Account({ provider, address: ADDRESS, signer: KEY, cairoVersion: "1" });

const json = (res, code, body) => {
  res.writeHead(code, {
    "content-type": "application/json",
    "access-control-allow-origin": "*",
    "access-control-allow-headers": "content-type",
    "access-control-allow-methods": "POST, GET, OPTIONS",
  });
  res.end(JSON.stringify(body));
};

const read = (req) =>
  new Promise((resolve) => {
    let b = "";
    req.on("data", (c) => (b += c));
    req.on("end", () => resolve(b ? JSON.parse(b) : {}));
  });

createServer(async (req, res) => {
  if (req.method === "OPTIONS") return json(res, 204, {});
  try {
    if (req.url === "/who") return json(res, 200, { address: ADDRESS, chainId, rpc: RPC });

    if (req.url === "/execute" && req.method === "POST") {
      const { calls } = await read(req);
      if (!Array.isArray(calls) || calls.length === 0) return json(res, 400, { error: "no calls" });
      // Real signing, real submission, real inclusion. Nothing here fabricates a hash.
      const { transaction_hash } = await account.execute(calls);
      const receipt = await provider.waitForTransaction(transaction_hash);
      const ok = receipt.isSuccess?.() ?? true;
      console.log(`  ${ok ? "landed" : "REVERTED"} ${transaction_hash}  (${calls.map((c) => c.entrypoint).join(" + ")})`);
      if (!ok) return json(res, 500, { error: "reverted", transaction_hash });
      return json(res, 200, { transaction_hash });
    }

    json(res, 404, { error: "no such route" });
  } catch (e) {
    // Same extraction the console and the keeper use: the first line of a starknet.js RPC
    // error is the request echo, and reporting it hides every actual reason behind one
    // meaningless string.
    const text = String(e?.message ?? e);
    const named = text.match(/\('([A-Z0-9_]+)'\)/);
    const rpc = text.match(/"message"\s*:\s*"([^"]+)"/);
    const why = named?.[1] ?? rpc?.[1] ?? text.split("\n").find((l) => !/^RPC:/.test(l.trim()) && l.trim().length > 12) ?? text;
    console.log(`  refused: ${why.slice(0, 200)}`);
    json(res, 500, { error: why.slice(0, 400) });
  }
}).listen(PORT, "127.0.0.1", () => {
  console.log(`\ndev wallet signing for ${ADDRESS}`);
  console.log(`  chain ${chainId} via ${RPC}`);
  console.log(`  listening on http://127.0.0.1:${PORT}\n`);
});
