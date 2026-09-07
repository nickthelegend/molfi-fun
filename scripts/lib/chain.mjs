/**
 * Talking to a Starknet node, and to `sncast`, without getting it wrong twice.
 *
 * This was inside `deploy.mjs`. It moved out when a second script needed to declare a class
 * and deploy it, because every paragraph below is a mistake that was made once and cost a
 * failed deploy to find — reading only stdout, treating a returned class hash as a finished
 * transaction, retrying a revert as though it were a dropped connection. Two copies of that
 * knowledge is one copy that will be wrong.
 *
 * Nothing here is molfi-specific. It is `sncast` invocation, transaction waiting, and the
 * felt encodings Cairo's calldata expects.
 */

import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";

export const say = (s) => process.stderr.write(`${s}\n`);

/**
 * Transient, or the chain's answer?
 *
 * A dropped connection is not an answer and retrying it costs a few seconds. A revert is an
 * answer, and retrying it burns a fee to be told the same thing. The difference matters most
 * in a deploy, which is a long sequence of writes where losing one halfway leaves markets
 * listed and unfunded.
 */
export function transient(text) {
  return /error sending request|Failed to fetch|timed out|connection|502|503|504|reset by peer|decoding response|Unknown RPC error|EOF|Gateway|rate.?limit|too many requests/i.test(
    text,
  );
}

/**
 * The one line worth reading out of a Starknet revert.
 *
 * A failed invoke comes back as several hundred characters of nested contract addresses and
 * class hashes wrapped around a single quoted felt — the actual reason. Printing the whole
 * envelope buries it; printing just the felt loses nothing anyone needs.
 */
export function reason(error) {
  const text = String(error);
  const named = text.match(/\('([A-Z0-9_]+)'\)/);
  if (named) return `${named[1]} (contract refused)`;
  return text.length > 300 ? `${text.slice(0, 300)}…` : text;
}

export function jsonLines(text) {
  const out = [];
  for (const line of text.trim().split("\n")) {
    if (!line) continue;
    try {
      out.push(JSON.parse(line));
    } catch {
      /* not every line is JSON; skip it */
    }
  }
  return out;
}

export const hex = (v) => "0x" + BigInt(v).toString(16);
/** A u256 as the two felts Cairo's calldata expects, low limb first. */
export const u256 = (v) => [hex(BigInt(v) & ((1n << 128n) - 1n)), hex(BigInt(v) >> 128n)];
/** A Cairo short string as the felt it encodes. */
export const short = (t) => {
  let o = 0n;
  for (const c of t) o = (o << 8n) | BigInt(c.charCodeAt(0));
  return "0x" + o.toString(16);
};

/**
 * A chain session: one account, one endpoint, and a record of everything it sent.
 *
 * `transactions` is the record, and it is the reason this is a factory rather than a bag of
 * free functions. A submission filled from hashes copied out of a terminal by hand is how one
 * ends up submitting a hash from the wrong network, or from a run that was later redeployed
 * over. Every write goes through `invoke` or `deploy`, so the list is complete by construction.
 */
export function chain({ account, rpc, cwd = "cairo", wait = true }) {
  const transactions = [];

  /**
   * Run sncast and return its result object.
   *
   * `--json` emits one object per line: build progress on stdout, and the result — or an
   * error — on **stderr**. It also exits 0 on some failures, so neither the exit code nor
   * stdout alone is enough to tell success from failure. Both streams are read, and an
   * `error` field anywhere in them is treated as the failure it is.
   *
   * This is worth the paragraph: reading only stdout made an "already declared" look like a
   * successful declare with an undefined class hash, and the deploy that followed failed
   * three steps later with a message about a malformed felt.
   */
  function sncast(...a) {
    return sncastOnce(a, 0);
  }

  function sncastOnce(a, attempt) {
    const argv = ["--json", "--account", account, ...a, "--url", rpc];
    const r = spawnSync("sncast", argv, { cwd, encoding: "utf8" });
    const objects = [
      ...jsonLines(String(r.stdout ?? "")),
      ...jsonLines(String(r.stderr ?? "")),
    ];

    const failed = objects.find((o) => o.error);
    if (failed) {
      if (transient(String(failed.error)) && attempt < 4) {
        say(`    transient (${reason(failed.error).slice(0, 60)}), retrying…`);
        spawnSync("sleep", [String(2 + attempt * 3)]);
        return sncastOnce(a, attempt + 1);
      }
      const err = new Error(reason(failed.error));
      err.sncast = failed;
      throw err;
    }

    const result = objects.reverse().find((o) => o.command || o.class_hash || o.contract_address);
    if (!result) {
      const text = (String(r.stderr ?? "") || String(r.stdout ?? "")).trim();
      if (transient(text) && attempt < 4) {
        say(`    transient, retrying…`);
        spawnSync("sleep", [String(2 + attempt * 3)]);
        return sncastOnce(a, attempt + 1);
      }
      throw new Error(`sncast ${a[0]} returned nothing readable: ${text.slice(-300)}`);
    }
    return result;
  }

  async function rpcCall(method, params) {
    const res = await fetch(rpc, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
    });
    const body = await res.json();
    if (body.error) throw new Error(JSON.stringify(body.error).slice(0, 200));
    return body.result;
  }

  /**
   * Wait for a transaction to be accepted before doing anything that depends on it.
   *
   * On devnet a declare is visible to the very next call. On a public network it is not: the
   * declare returned a class hash and the deploy a moment later failed with "class is not
   * declared", which reads like a bug in the contract and is actually a bug in the assumption
   * that a returned hash means a finished transaction.
   *
   * Not optional and not a sleep. A fixed delay is either too short on a slow block or wasted
   * on a fast one; this asks the chain.
   */
  async function waitFor(txHash, what, timeoutMs = 300_000) {
    if (!txHash) return;
    const started = Date.now();
    process.stderr.write(`    waiting for ${what} … `);
    for (;;) {
      try {
        const result = await rpcCall("starknet_getTransactionStatus", [txHash]);
        if (result?.execution_status === "REVERTED") {
          process.stderr.write("REVERTED\n");
          throw new Error(`${what} reverted: ${result.failure_reason ?? "no reason given"}`);
        }
        const status = result?.finality_status;
        if (status === "ACCEPTED_ON_L2" || status === "ACCEPTED_ON_L1") {
          process.stderr.write(`${status} in ${Math.round((Date.now() - started) / 1000)}s\n`);
          return;
        }
      } catch (e) {
        if (String(e.message).includes("reverted")) throw e;
        // A transaction the node has not indexed yet reads as an error; keep asking.
      }
      if (Date.now() - started > timeoutMs) {
        process.stderr.write("TIMED OUT\n");
        throw new Error(`${what} was not accepted within ${timeoutMs / 1000}s (${txHash})`);
      }
      await new Promise((r) => setTimeout(r, 3_000));
    }
  }

  /**
   * Declare a class, treating "already declared" as the success it is.
   *
   * Re-running is normal — a sequence of writes that fails halfway has to be resumable — and
   * a class hash is content-addressed, so a second declare of identical code is a no-op
   * rather than a conflict.
   */
  async function declare(contract) {
    try {
      const r = sncast("declare", "--contract-name", contract);
      say(`  declared ${contract} → ${r.class_hash}`);
      // The class is not usable until the declare is accepted, and on a public network that
      // is not immediate.
      await waitFor(r.transaction_hash, `declare ${contract}`);
      return r.class_hash;
    } catch (e) {
      const known = String(e.message).match(/0x[0-9a-fA-F]{40,64}/);
      if (/already declared/i.test(e.message) && known) {
        say(`  ${contract} already declared → ${known[0]}`);
        return known[0];
      }
      throw new Error(`declare ${contract}: ${e.message}`);
    }
  }

  async function deploy(classHash, calldata, label) {
    const r = sncast(
      "deploy",
      "--class-hash",
      classHash,
      ...(calldata.length ? ["--constructor-calldata", ...calldata] : []),
    );
    if (r.transaction_hash) transactions.push({ hash: r.transaction_hash, what: `deploy ${label}` });
    say(`  deployed ${label} → ${r.contract_address}`);
    await waitFor(r.transaction_hash, `deploy ${label}`);
    return r.contract_address;
  }

  async function invoke(address, entrypoint, calldata, label) {
    const r = sncast(
      "invoke",
      "--contract-address",
      address,
      "--function",
      entrypoint,
      "--calldata",
      ...calldata,
    );
    transactions.push({ hash: r.transaction_hash, what: label });
    say(`  ${label} → ${r.transaction_hash}`);
    // Sequenced, not fired and forgotten. Two invokes in flight from one account collide on a
    // nonce, and on a public network the second is simply rejected.
    if (wait) await waitFor(r.transaction_hash, label, 180_000);
    return r.transaction_hash;
  }

  /** The address sncast will sign with, read from its own account store. */
  function accountAddress() {
    const r = spawnSync("sncast", ["--json", "account", "list"], { cwd, encoding: "utf8" });
    for (const o of jsonLines(String(r.stdout ?? ""))) {
      const found = o?.[account]?.address ?? o?.accounts?.[account]?.address;
      if (found) return found;
    }
    // The listing shape has moved between sncast versions; fall back to the text form rather
    // than failing on a parse.
    const text = String(r.stdout ?? "") + String(r.stderr ?? "");
    const at = text.indexOf(account);
    const m = at >= 0 ? text.slice(at).match(/0x[0-9a-fA-F]{40,64}/) : null;
    return m?.[0];
  }

  return { sncast, rpcCall, waitFor, declare, deploy, invoke, accountAddress, transactions };
}

/**
 * L2 gas per Sierra felt, measured rather than assumed.
 *
 * From a real `estimateDeclareFee` against `MolfiMarket`: 2.028e9 L2 gas for 9,752 felts. A
 * declare pays for the whole program, so the cost is very nearly linear in its length — and
 * the number that actually matters is not the program size but whether the account can pay,
 * which is a different question and the one that stopped a deploy while a size check said
 * "12% of the limit, clear".
 */
export const DECLARE_GAS_PER_FELT = 2_028_243_360 / 9_752;

/**
 * What declaring this class would cost right now, in fri.
 *
 * Priced against the chain's current L2 gas rather than a constant: the figure moved between
 * 58 and 62 STRK over a week, and a hardcoded number is how a script tells someone they
 * cannot afford something they can.
 */
export async function declareCost(sierraPath, rpcCall) {
  const sierra = JSON.parse(readFileSync(sierraPath, "utf8"));
  const felts = sierra.sierra_program.length;
  const head = await rpcCall("starknet_getBlockWithTxHashes", ["latest"]);
  const price = BigInt(head.l2_gas_price.price_in_fri);
  return { felts, fri: BigInt(Math.round(felts * DECLARE_GAS_PER_FELT)) * price };
}
