/**
 * The page half of the dev wallet: a wallet-standard wallet that forwards signing.
 *
 * Injected into the console during a browser test run. It implements exactly the four
 * features `@starknet-io/get-starknet-discovery` requires — starknet:walletApi,
 * standard:connect, standard:disconnect, standard:events — and nothing beyond them, so what
 * the console exercises is its real wallet code path rather than a shortcut.
 *
 * No cryptography happens here. `wallet_addInvokeTransaction` posts the calls to the signer
 * on 127.0.0.1, which holds the key, signs, submits and waits for inclusion; this returns the
 * transaction hash the chain gave it. If the transaction reverts, this throws — the console
 * sees a failure because there was one.
 *
 * Deliberately not STRK20-capable: no `strk20InvokeTransaction`. That is the wallet most
 * people actually have, and it is the case molfi used to refuse outright.
 */
(function registerDevWallet(signer) {
  const post = async (path, body) => {
    const r = await fetch(`${signer}${path}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });
    const j = await r.json();
    if (!r.ok) throw new Error(j.error ?? `signer ${r.status}`);
    return j;
  };

  const who = window.__devWalletWho;
  const chain = `starknet:${who.chainId}`;
  const account = {
    address: who.address,
    publicKey: new Uint8Array(),
    chains: [chain],
    features: ["starknet:walletApi", "standard:connect", "standard:disconnect", "standard:events"],
    icon: undefined,
    label: "Dev Signer",
  };

  const listeners = new Set();

  const request = async ({ type, params }) => {
    switch (type) {
      case "wallet_requestAccounts":
        return [who.address];
      case "wallet_requestChainId":
        return who.chainId;
      case "wallet_getPermissions":
        return ["accounts"];
      case "wallet_supportedSpecs":
        return ["0.8.1"];
      case "wallet_supportedWalletApi":
        return ["0.8.0"];
      case "wallet_addInvokeTransaction": {
        const calls = (params.calls ?? []).map((c) => ({
          contractAddress: c.contract_address ?? c.contractAddress,
          entrypoint: c.entry_point ?? c.entrypoint,
          calldata: c.calldata ?? [],
        }));
        return post("/execute", { calls });
      }
      case "wallet_deploymentData":
        throw new Error("this account is already deployed");
      default:
        throw new Error(`the dev wallet does not implement ${type}`);
    }
  };

  const wallet = {
    version: "1.0.0",
    name: "Dev Signer",
    // A 1x1 transparent PNG. The discovery UI wants an icon; nothing depends on what it is.
    icon: "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
    chains: [chain],
    accounts: [account],
    features: {
      "standard:connect": {
        version: "1.0.0",
        connect: async () => ({ accounts: [account] }),
      },
      "standard:disconnect": {
        version: "1.0.0",
        disconnect: async () => {},
      },
      "standard:events": {
        version: "1.0.0",
        on: (event, listener) => {
          listeners.add({ event, listener });
          return () => listeners.delete(listener);
        },
      },
      "starknet:walletApi": {
        version: "1.0.0",
        request,
      },
    },
  };

  // The wallet-standard handshake, both directions: announce now for an app that is already
  // listening, and answer the app-ready event for one that starts listening later.
  const announce = (register) => register(wallet);
  window.addEventListener("wallet-standard:app-ready", (e) => announce(e.detail.register));
  window.dispatchEvent(
    new CustomEvent("wallet-standard:register-wallet", { detail: announce }),
  );
  window.__devWalletRegistered = true;
})(window.__devWalletSigner || "http://127.0.0.1:5099");
