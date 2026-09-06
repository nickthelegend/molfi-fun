import pg from "pg";

/**
 * The keeper's ledger.
 *
 * Every relay, settlement and listing the keeper performs is written here with its
 * transaction hash and what the chain said about it. That is the difference between "the
 * market settles itself" as a claim and as something a stranger can query — and the reason
 * this is Postgres rather than a variable: a process that forgets everything it did when it
 * restarts cannot be evidence of anything.
 *
 * Writes are best-effort on purpose. The chain is the record of truth; this is the index over
 * it. A database that is down must slow the keeper, never stop it from settling a market that
 * is due.
 */

export interface Action {
  /** `stall` marks a transition into or out of not being able to list, never a steady state. */
  kind: "relay" | "settle" | "list" | "fund" | "stall";
  network: string;
  pair: string | null;
  marketId: number | null;
  txHash: string | null;
  ok: boolean;
  detail: string;
  /** Whatever is worth keeping that does not deserve a column. */
  meta?: Record<string, unknown>;
}

let pool: pg.Pool | null = null;
let ready: Promise<void> | null = null;
let disabled = false;

export function configured(): boolean {
  return Boolean(process.env.DATABASE_URL) && !disabled;
}

function connect(): pg.Pool {
  if (!pool) {
    pool = new pg.Pool({
      connectionString: process.env.DATABASE_URL,
      // Managed Postgres almost always terminates TLS with a certificate the container does
      // not have a root for. Refusing to connect over that is worse than connecting: the
      // link is still encrypted, and the alternative is no ledger at all.
      ssl: process.env.DATABASE_URL?.includes("localhost")
        ? undefined
        : { rejectUnauthorized: false },
      max: 4,
      idleTimeoutMillis: 30_000,
    });
    pool.on("error", (e) => console.error("[db] idle client error:", e.message));
  }
  return pool;
}

const SCHEMA = `
  CREATE TABLE IF NOT EXISTS keeper_actions (
    id          BIGSERIAL PRIMARY KEY,
    at          TIMESTAMPTZ NOT NULL DEFAULT now(),
    kind        TEXT        NOT NULL,
    network     TEXT        NOT NULL,
    pair        TEXT,
    market_id   INTEGER,
    tx_hash     TEXT,
    ok          BOOLEAN     NOT NULL,
    detail      TEXT        NOT NULL,
    meta        JSONB
  );
  CREATE INDEX IF NOT EXISTS keeper_actions_at   ON keeper_actions (at DESC);
  CREATE INDEX IF NOT EXISTS keeper_actions_kind ON keeper_actions (kind, at DESC);

  -- One row per market the keeper has seen, so the site can render history without
  -- replaying the whole action log.
  CREATE TABLE IF NOT EXISTS markets (
    network      TEXT    NOT NULL,
    market_id    INTEGER NOT NULL,
    pair         TEXT    NOT NULL,
    round_seconds INTEGER NOT NULL,
    cutoff_at    BIGINT  NOT NULL,
    settled      BOOLEAN NOT NULL DEFAULT false,
    settled_price TEXT,
    settled_at   BIGINT,
    settled_sources INTEGER,
    staked       TEXT,
    paid         TEXT,
    seen_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (network, market_id)
  );
  CREATE INDEX IF NOT EXISTS markets_cutoff ON markets (network, cutoff_at DESC);
`;

export async function init(): Promise<void> {
  if (!configured()) return;
  if (!ready) {
    ready = (async () => {
      await connect().query(SCHEMA);
      console.log("[db] ledger ready");
    })().catch((e) => {
      // One failure disables the ledger for this process rather than retrying on every
      // write. A keeper that logs a connection error sixty times a minute is a keeper whose
      // real errors nobody will ever see.
      disabled = true;
      console.error("[db] disabled:", e.message);
    });
  }
  return ready;
}

export async function record(a: Action): Promise<void> {
  if (!configured()) return;
  try {
    await connect().query(
      `INSERT INTO keeper_actions (kind, network, pair, market_id, tx_hash, ok, detail, meta)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
      [a.kind, a.network, a.pair, a.marketId, a.txHash, a.ok, a.detail, a.meta ?? null],
    );
  } catch (e) {
    console.error("[db] could not record:", (e as Error).message);
  }
}

export interface MarketRow {
  network: string;
  marketId: number;
  pair: string;
  roundSeconds: number;
  cutoffAt: number;
  settled: boolean;
  settledPrice: string | null;
  settledAt: number | null;
  settledSources: number | null;
  staked: string | null;
  paid: string | null;
}

export async function upsertMarket(m: MarketRow): Promise<void> {
  if (!configured()) return;
  try {
    await connect().query(
      `INSERT INTO markets
         (network, market_id, pair, round_seconds, cutoff_at, settled, settled_price,
          settled_at, settled_sources, staked, paid, updated_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11, now())
       ON CONFLICT (network, market_id) DO UPDATE SET
         settled = EXCLUDED.settled,
         settled_price = EXCLUDED.settled_price,
         settled_at = EXCLUDED.settled_at,
         settled_sources = EXCLUDED.settled_sources,
         staked = EXCLUDED.staked,
         paid = EXCLUDED.paid,
         updated_at = now()`,
      [
        m.network, m.marketId, m.pair, m.roundSeconds, m.cutoffAt, m.settled,
        m.settledPrice, m.settledAt, m.settledSources, m.staked, m.paid,
      ],
    );
  } catch (e) {
    console.error("[db] could not upsert market:", (e as Error).message);
  }
}

export async function recentActions(limit = 50): Promise<unknown[]> {
  if (!configured()) return [];
  const { rows } = await connect().query(
    `SELECT at, kind, network, pair, market_id, tx_hash, ok, detail
       FROM keeper_actions ORDER BY at DESC LIMIT $1`,
    [Math.min(limit, 500)],
  );
  return rows;
}

export async function settledMarkets(limit = 50): Promise<unknown[]> {
  if (!configured()) return [];
  const { rows } = await connect().query(
    `SELECT market_id, pair, round_seconds, cutoff_at, settled_price, settled_at,
            settled_sources, staked, paid
       FROM markets WHERE settled = true ORDER BY cutoff_at DESC LIMIT $1`,
    [Math.min(limit, 500)],
  );
  return rows;
}

/** What the keeper has been up to, for a health check that means something. */
export async function summary(): Promise<Record<string, unknown>> {
  if (!configured()) return { ledger: "not configured" };
  const { rows } = await connect().query(`
    SELECT kind,
           count(*)                       AS total,
           count(*) FILTER (WHERE ok)     AS ok,
           max(at)                        AS last
      FROM keeper_actions GROUP BY kind`);
  return Object.fromEntries(
    rows.map((r) => [r.kind, { total: Number(r.total), ok: Number(r.ok), last: r.last }]),
  );
}
