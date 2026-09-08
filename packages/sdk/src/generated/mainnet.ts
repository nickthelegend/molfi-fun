/** GENERATED — do not edit by hand. Produced by `node scripts/sync-manifest.mjs`
 *  from `deployments/mainnet.json`, which the deploy script writes as the chain confirms.
 *
 *  Here so the landing page can state what molfi did on mainnet without a human retyping a
 *  hash. Generated: kept in step by `--check` in preflight.
 */

export interface MainnetTransaction {
  /** The transaction hash, as accepted on L1. */
  readonly hash: string;
  /** What it did, in the deploy script's own words. */
  readonly what: string;
}

export const MAINNET_DEPLOYMENT = {
  /** The market contract, live and reading Pragma mainnet directly. */
  market: "0x0215dc0b029cfa4d3671494ad4ddcd9ceede531867487a9970b094a665a3aaf9",
  /** Pragma's aggregator on mainnet. No relay here — Pragma is alive on mainnet. */
  oracle: "0x2a85bd616f912537c50a49a4076db02c00b29b2cdc8a197ce92ed1837fa875b",
  deployedAt: "2026-09-07T17:23:04.557Z",
  /** House bankroll put behind each market, in wei of STRK. */
  bankrollPerMarket: "5000000000000000000",
  /** Pairs listed. The five Pragma does not carry on mainnet were deliberately skipped. */
  markets: [{"pair":"BTC/USD","seconds":14400},{"pair":"ETH/USD","seconds":14400},{"pair":"STRK/USD","seconds":14400},{"pair":"WBTC/USD","seconds":14400}],
  /** Pairs skipped, because a market whose oracle cannot be read can never resolve. */
  skipped: ["SOL/USD","XRP/USD","DOGE/USD","LINK/USD","AVAX/USD"],
  transactions: [
    {
      "hash": "0x00d87d1a993560448ca27ed54ab8b0b2f56aa34d01133d881928aa528fbb3524",
      "what": "account deployed"
    },
    {
      "hash": "0x01b5c98db224b3e1547363401480feb8449989011b02d868bb76a7c787393104",
      "what": "deploy MolfiMarket"
    },
    {
      "hash": "0x05216ca2e525199f2b8a9ab4ac252093e7ba4ea696d0c91f2686a9834039bddc",
      "what": "listed BTC/USD 14400s"
    },
    {
      "hash": "0x05d013bcd0833a2b6bef47de3aac8ac504df7fe43ae6baa8b4dd231fd92ba548",
      "what": "listed ETH/USD 14400s"
    },
    {
      "hash": "0x0427053cb94b8e3a167f00bd6c3568f1f2e183f14ef5617ffa820b8e2f8d32d0",
      "what": "listed STRK/USD 14400s"
    },
    {
      "hash": "0x032e99b955f617fe80aadd8a8d5e27f47cab51eee44d0f73303fa6e6a79c51eb",
      "what": "listed WBTC/USD 14400s"
    },
    {
      "hash": "0x04008e34322365bd19c07714dba5451cc1ddaf6c6711be2aaef4d35b806b2cff",
      "what": "sent bankroll for market 1"
    },
    {
      "hash": "0x068791d225e83f581bd18c66acd4516fcf91cfd14042e166d5a8f4a1903abc65",
      "what": "funded market 1"
    },
    {
      "hash": "0x07445742d327a10a9395df7f82284c8af2cc04031c2e5ca1e63889293d13a24a",
      "what": "sent bankroll for market 2"
    },
    {
      "hash": "0x01d7d11f35aae5078e375cccc53a8cf86aebfb711eec7867b95e57bd266ec4f5",
      "what": "funded market 2"
    },
    {
      "hash": "0x036733490c36806889348b6ab0d3879b439699b4c88729b0e63393b06c012e62",
      "what": "sent bankroll for market 3"
    },
    {
      "hash": "0x0698df34713efeac5b6da0424d7a9a139e6cc0b13517940a7a2111beb7271c1c",
      "what": "funded market 3"
    },
    {
      "hash": "0x07a1bfd57939b05f5245d3a945e32b04f913eb6a1280f42adb50c680804809b0",
      "what": "sent bankroll for market 4"
    },
    {
      "hash": "0x03977ebb9896e69052857a2f18459e39792550514b5a5136c9052baddba8a76d",
      "what": "funded market 4"
    },
    {
      "hash": "0x04c0af89fe96650260a78e7a5897aed6908a71ef82088ff79f7b9a830de1de43",
      "what": "settled market 1 (BTC/USD)"
    },
    {
      "hash": "0x00454fab7db36f4b8d97da30b45e6ddd2d0555fd414eb4f4cb78490576545a3c",
      "what": "settled market 2 (ETH/USD)"
    },
    {
      "hash": "0x069c3b6c5507e59d742d4da9f66422ad4c60ee94bebd6b3be9e0cc46b6f650b6",
      "what": "settled market 3 (STRK/USD)"
    },
    {
      "hash": "0x01a9dd70496e244112bce6b9d98964278d3f17a4a033763e903e8cb5c5ba6dd7",
      "what": "settled market 4 (WBTC/USD)"
    },
    {
      "hash": "0x038d9ac3763dc9962b6fdca87e08f3204d9c1448a97d99036f20d23e50b37998",
      "what": "trader account deployed"
    },
    {
      "hash": "0x681430bd0b6b1933c64c89b665bc27f656d07342d618778f58bcbef5c87f579",
      "what": "opened a position on market 9 (1 STRK)"
    },
    {
      "hash": "0x07dac15e91e32fca138fe9d9e00b55c1025027b1619f2a2174a2abf771541dcf",
      "what": "claimed it — band revealed, 1.6227 STRK paid"
    },
    {
      "hash": "0x6feb9e34cdf229dc18bc83708dd9114fbded34ea789a886d62bbabf1e5c396a",
      "what": "opened a position on market 13 (1 STRK)"
    }
  ],
  explorer: "https://starkscan.co",
} as const;
