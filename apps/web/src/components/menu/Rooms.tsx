"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { MARKETS, RoomMarketAbi, fmtUsd } from "@molfi/sdk";
import type { Address, Hex } from "viem";
import {
  ADDRESSES,
  activeChain,
  connectWallet,
  injected,
  publicClient,
  walletClientFor,
} from "@/lib/chain";

const ERC20 = [
  {
    name: "allowance",
    type: "function",
    stateMutability: "view",
    inputs: [
      { name: "o", type: "address" },
      { name: "s", type: "address" },
    ],
    outputs: [{ name: "", type: "uint256" }],
  },
  {
    name: "approve",
    type: "function",
    stateMutability: "nonpayable",
    inputs: [
      { name: "s", type: "address" },
      { name: "v", type: "uint256" },
    ],
    outputs: [{ name: "", type: "bool" }],
  },
] as const;

const ORACLE_LATEST = [
  {
    name: "latest",
    type: "function",
    stateMutability: "view",
    inputs: [{ name: "marketId", type: "bytes32" }],
    outputs: [
      { name: "price", type: "uint256" },
      { name: "updatedAt", type: "uint256" },
    ],
  },
] as const;

interface Room {
  id: bigint;
  marketId: Hex;
  creator: Address;
  openBlock: number;
  expiryBlock: number;
  stake: bigint;
  settledPrice: bigint;
  maxPlayers: number;
  status: number;
  code: Hex;
}

interface Entry {
  player: Address;
  low: bigint;
  high: bigint;
  won: boolean;
}

/**
 * Indexed by the contract's own constants: STATUS_OPEN = 0, SETTLED = 1, VOID = 2.
 *
 * Worth stating rather than assuming — reading this table one place to the right made
 * the screen call a settled room open and offer it a settle button that could never
 * work, with no error to explain why nothing happened.
 */
const STATUS = ["OPEN", "SETTLED", "VOID"];
const OPEN = 0;
const SETTLED = 1;

/** bytes8 <-> a short human code, so a room can be shared by saying it out loud. */
function codeToText(code: Hex): string {
  const bytes = code.slice(2).match(/.{2}/g) ?? [];
  return bytes
    .map((b) => String.fromCharCode(parseInt(b, 16)))
    .join("")
    .replace(/\0+$/, "");
}

function textToCode(text: string): Hex {
  const clean = text.toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 8);
  let hex = "";
  for (let i = 0; i < 8; i++) {
    hex += i < clean.length ? clean.charCodeAt(i).toString(16).padStart(2, "0") : "00";
  }
  return `0x${hex}` as Hex;
}

function randomCode(): string {
  // No I, O, 0 or 1 — this gets read aloud.
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  return Array.from({ length: 5 }, () => alphabet[Math.floor(Math.random() * alphabet.length)]).join("");
}

/**
 * Rooms — the house takes a fee and carries no risk.
 *
 * A range market needs a bankroll on the other side of every ticket, and that bankroll
 * is what caps how much can be open at once. A room does not: players put up equal
 * stakes, whoever lands inside the band splits the pot, and the vault's exposure is
 * exactly zero. `testFuzz_PotAlwaysClosesOut` is the property that makes that claim
 * safe to print.
 *
 * The contract has been deployed and tested since the beginning and had no way into
 * the product, which meant a whole mechanism existed only in the test suite.
 */
export function Rooms() {
  const room = ADDRESSES.roomMarket;
  const ausd = ADDRESSES.ausd;

  const [account, setAccount] = useState<Address | null>(null);
  const accountRef = useRef<Address | null>(null);
  const [block, setBlock] = useState(0n);
  const [rooms, setRooms] = useState<{ room: Room; entries: Entry[]; pot: bigint }[]>([]);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [joinCode, setJoinCode] = useState("");
  const [newCode, setNewCode] = useState(randomCode);
  const [stakeText, setStakeText] = useState("5");
  /**
   * The field only strips letters, which still leaves "", "." and "1.2.3" — each of
   * which reaches BigInt() as NaN and throws a raw JavaScript message at the player —
   * and a blank field, which would quietly open a room whose pot is worth nothing.
   * Parse in one place so the button can refuse and say which bound was missed, the
   * way the desk refuses a stake it cannot cover.
   */
  const parsedStake = useMemo((): { units: bigint } | { error: string } => {
    const t = stakeText.trim();
    if (t === "") return { error: "Enter a stake." };
    if ((t.match(/\./g) ?? []).length > 1) return { error: "That is not a number." };
    const n = Number(t);
    if (!Number.isFinite(n)) return { error: "That is not a number." };
    if (n <= 0) return { error: "The stake has to be more than zero." };
    const frac = t.split(".")[1] ?? "";
    if (frac.length > 6) return { error: "AUSD only goes to six decimal places." };
    return { units: BigInt(Math.round(n * 1e6)) };
  }, [stakeText]);
  const stakeError = "error" in parsedStake ? parsedStake.error : null;
  const [halfBps, setHalfBps] = useState(25);
  const [tierBlocks, setTierBlocks] = useState(1000);

  useEffect(() => {
    accountRef.current = account;
  }, [account]);

  const load = useCallback(async () => {
    if (!room) return;
    try {
      const [next, blk] = await Promise.all([
        publicClient.readContract({
          address: room,
          abi: RoomMarketAbi,
          functionName: "nextRoomId",
        }) as Promise<bigint>,
        publicClient.getBlockNumber(),
      ]);
      setBlock(blk);

      // Newest first, and only the last dozen — a room list is a lobby, not an archive.
      const ids: bigint[] = [];
      for (let id = next - 1n; id >= 1n && ids.length < 12; id--) ids.push(id);

      const rows = await Promise.all(
        ids.map(async (id) => {
          const [r, e, pot] = await Promise.all([
            publicClient.readContract({
              address: room,
              abi: RoomMarketAbi,
              functionName: "getRoom",
              args: [id],
            }) as Promise<Room>,
            publicClient.readContract({
              address: room,
              abi: RoomMarketAbi,
              functionName: "entries",
              args: [id],
            }) as Promise<Entry[]>,
            publicClient.readContract({
              address: room,
              abi: RoomMarketAbi,
              functionName: "potOf",
              args: [id],
            }) as Promise<bigint>,
          ]);
          return { room: { ...r, id }, entries: e, pot };
        }),
      );
      setRooms(rows);
      setErr(null);
    } catch (e) {
      setErr((e as Error).message);
    }
  }, [room]);

  useEffect(() => {
    void load();
    const t = setInterval(() => void load(), 4000);
    return () => clearInterval(t);
  }, [load]);

  const connect = useCallback(async () => {
    try {
      setAccount(await connectWallet());
    } catch (e) {
      setErr((e as Error).message);
    }
  }, []);

  /** Approve once, for everything — the room takes the stake at join time. */
  const ensureAllowance = useCallback(
    async (who: Address, need: bigint) => {
      if (!room || !ausd) throw new Error("no room market deployed");
      const allowance = (await publicClient.readContract({
        address: ausd,
        abi: ERC20,
        functionName: "allowance",
        args: [who, room],
      })) as bigint;
      if (allowance >= need) return;
      const wallet = walletClientFor(who);
      const hash = await wallet.writeContract({
        address: ausd,
        abi: ERC20,
        functionName: "approve",
        args: [room, 2n ** 255n],
      });
      await publicClient.waitForTransactionReceipt({ hash });
    },
    [room, ausd],
  );

  /**
   * Centre the band on the price this room will actually settle against.
   *
   * Read through the room's own oracle rather than the desk's, because they need not be
   * the same contract — the router can send one market to a book and another to a feed,
   * and a band centred on the wrong source is a band the room will reject.
   */
  const bandAround = useCallback(
    async (marketId: Hex): Promise<bigint> => {
      if (!room) return 0n;
      const oracleAddr = (await publicClient.readContract({
        address: room,
        abi: RoomMarketAbi,
        functionName: "oracle",
      })) as Address;

      const [spot] = (await publicClient.readContract({
        address: oracleAddr,
        abi: ORACLE_LATEST,
        functionName: "latest",
        args: [marketId],
      })) as readonly [bigint, bigint];
      return spot;
    },
    [room],
  );

  const create = useCallback(async () => {
    if (!room) return;
    setBusy("creating");
    setErr(null);
    try {
      const who = accountRef.current ?? (await connectWallet());
      setAccount(who);

      const market = MARKETS.find((m) => m.live) ?? MARKETS[0];
      if ("error" in parsedStake) throw new Error(parsedStake.error);
      const stake = parsedStake.units;
      await ensureAllowance(who, stake);

      const spot = await bandAround(market.marketId as Hex);
      if (spot === 0n) throw new Error("no price for this market yet");
      const half = (spot * BigInt(halfBps)) / 10_000n;

      const wallet = walletClientFor(who);
      const { request } = await publicClient.simulateContract({
        account: who,
        address: room,
        abi: RoomMarketAbi,
        functionName: "createRoom",
        args: [
          textToCode(newCode),
          market.marketId as Hex,
          stake,
          tierBlocks,
          8,
          spot - half,
          spot + half,
        ],
      });
      const hash = await wallet.writeContract(request);
      await publicClient.waitForTransactionReceipt({ hash });
      setNewCode(randomCode());
      await load();
    } catch (e) {
      setErr(shortError(e));
    } finally {
      setBusy(null);
    }
  }, [room, parsedStake, halfBps, tierBlocks, newCode, ensureAllowance, bandAround, load]);

  const joinRoom = useCallback(
    async (code: string, stake: bigint, marketId: Hex) => {
      if (!room) return;
      setBusy("joining");
      setErr(null);
      try {
        const who = accountRef.current ?? (await connectWallet());
        setAccount(who);
        await ensureAllowance(who, stake);

        const spot = await bandAround(marketId);
        if (spot === 0n) throw new Error("no price for this market yet");
        const half = (spot * BigInt(halfBps)) / 10_000n;

        const wallet = walletClientFor(who);
        const { request } = await publicClient.simulateContract({
          account: who,
          address: room,
          abi: RoomMarketAbi,
          functionName: "joinByCode",
          args: [textToCode(code), spot - half, spot + half],
        });
        const hash = await wallet.writeContract(request);
        await publicClient.waitForTransactionReceipt({ hash });
        setJoinCode("");
        await load();
      } catch (e) {
        setErr(shortError(e));
      } finally {
        setBusy(null);
      }
    },
    [room, halfBps, ensureAllowance, bandAround, load],
  );

  const settle = useCallback(
    async (id: bigint) => {
      if (!room) return;
      setBusy("settling");
      setErr(null);
      try {
        const who = accountRef.current ?? (await connectWallet());
        setAccount(who);
        const wallet = walletClientFor(who);
        const { request } = await publicClient.simulateContract({
          account: who,
          address: room,
          abi: RoomMarketAbi,
          functionName: "settleRoom",
          args: [id],
        });
        const hash = await wallet.writeContract(request);
        await publicClient.waitForTransactionReceipt({ hash });
        await load();
      } catch (e) {
        setErr(shortError(e));
      } finally {
        setBusy(null);
      }
    },
    [room, load],
  );

  if (!room) {
    return (
      <p className="mt-8 text-center text-[13px] leading-relaxed text-white/45">
        No room market is deployed for this environment.
        <br />
        Run <span className="text-white">pnpm demo</span> to bring one up.
      </p>
    );
  }

  return (
    <div className="pb-6">
      <div className="rounded-2xl bg-[#141414] p-4">
        <div className="label">Rooms · player against player</div>
        <p className="mt-2 text-[11px] leading-relaxed text-white/45">
          Everyone puts up the same stake and paints their own band. Whoever is inside at
          the cutoff splits the pot. The house takes {"3%"} and carries no risk at all —
          the vault is not on the other side of this, so nothing here touches the
          bankroll or its utilisation.
        </p>
      </div>

      {/* ---- join by code */}
      <div className="mt-3 rounded-2xl bg-[#141414] p-4">
        <div className="label">Join by code</div>
        <div className="mt-2 flex gap-2">
          <input
            value={joinCode}
            onChange={(e) => setJoinCode(e.target.value.toUpperCase())}
            placeholder="ABCDE"
            maxLength={8}
            className="mono tnum min-w-0 flex-1 rounded-xl bg-[#0d0d0d] px-3 py-2 text-[15px] tracking-[0.2em] text-white outline-none placeholder:text-dim-2"
          />
          <button
            disabled={!!busy || joinCode.length < 3}
            onClick={() => {
              const target = rooms.find((r) => codeToText(r.room.code) === joinCode);
              if (!target) {
                setErr(`no open room with code ${joinCode}`);
                return;
              }
              void joinRoom(joinCode, target.room.stake, target.room.marketId);
            }}
            className="key rounded-xl bg-[var(--color-cap)] px-4 text-[13px] font-semibold text-black disabled:opacity-40"
          >
            {busy === "joining" ? "…" : "JOIN"}
          </button>
        </div>
      </div>

      {/* ---- open one */}
      <div className="mt-3 rounded-2xl bg-[#141414] p-4">
        <div className="label">Open a room</div>

        <div className="mt-3 grid grid-cols-2 gap-3">
          <Field label="Code">
            <div className="flex items-center gap-2">
              <span className="mono tnum text-[15px] tracking-[0.2em] text-amber">{newCode}</span>
              <button
                onClick={() => setNewCode(randomCode())}
                className="label underline decoration-dotted"
              >
                new
              </button>
            </div>
          </Field>
          <Field label="Stake each">
            <div className="flex items-center gap-1">
              <span className="text-[15px] text-white/50">$</span>
              <input
                value={stakeText}
                onChange={(e) => setStakeText(e.target.value.replace(/[^0-9.]/g, ""))}
                className="tnum w-full bg-transparent text-[15px] font-semibold text-white outline-none"
              />
            </div>
          </Field>
        </div>

        <div className="mt-3">
          <div className="label">Cutoff</div>
          <div className="mt-1 flex gap-1">
            {[
              [100, "30s"],
              [333, "100s"],
              [1000, "5m"],
              [3000, "15m"],
            ].map(([b, label]) => (
              <button
                key={label as string}
                onClick={() => setTierBlocks(b as number)}
                className={`key flex-1 rounded-lg py-1.5 text-[11px] ${
                  tierBlocks === b ? "bg-[var(--color-cap-hi)] text-black" : "bg-[var(--color-cap)] text-black/70"
                }`}
              >
                {label as string}
              </button>
            ))}
          </div>
        </div>

        <div className="mt-3">
          <div className="flex items-baseline justify-between">
            <span className="label">Your band</span>
            <span className="tnum text-[12px] text-white/60">± {(halfBps / 100).toFixed(2)}%</span>
          </div>
          <input
            type="range"
            min={5}
            max={200}
            value={halfBps}
            onChange={(e) => setHalfBps(Number(e.target.value))}
            className="mt-2 w-full accent-[var(--color-amber)]"
          />
          <p className="mt-1 text-[11px] leading-relaxed text-white/35">
            Tighter is not priced here — everyone pays the same stake, so a tight band is
            simply a bolder claim about where the price will be.
          </p>
        </div>

        {stakeError ? (
          <p className="mt-3 text-[11px] leading-relaxed text-red">{stakeError}</p>
        ) : null}

        <button
          disabled={!!busy || !!stakeError}
          onClick={() => void create()}
          className="key mt-3 w-full rounded-xl bg-gradient-to-b from-[#f2564c] to-[#c8362e] py-3 text-[14px] font-semibold text-white disabled:opacity-40"
        >
          {busy === "creating" ? "opening…" : `OPEN ROOM ${newCode}`}
        </button>
      </div>

      {err ? <p className="mt-3 text-center text-[12px] text-red">{err}</p> : null}

      {/* ---- the lobby */}
      <div className="mt-3">
        <div className="label px-1">Recent rooms</div>
        {rooms.length === 0 ? (
          <p className="mt-3 text-center text-[13px] text-white/40">
            No rooms yet. Open one and share the code.
          </p>
        ) : (
          rooms.map(({ room: r, entries, pot }) => {
            const left = Number(r.expiryBlock) - Number(block);
            const settleable = r.status === OPEN && left <= 0;
            const mine = account ? entries.some((e) => e.player.toLowerCase() === account.toLowerCase()) : false;
            return (
              <div key={String(r.id)} className="mt-2 rounded-2xl bg-[#141414] p-4">
                <div className="flex items-baseline justify-between">
                  <span className="mono tnum text-[15px] tracking-[0.2em] text-amber">
                    {codeToText(r.code) || `#${r.id}`}
                  </span>
                  <span className="label">{STATUS[r.status] ?? "—"}</span>
                </div>

                <div className="mt-2 grid grid-cols-3 gap-2">
                  <Stat label="Pot" value={fmtUsd(pot)} />
                  <Stat label="Stake" value={fmtUsd(r.stake)} />
                  <Stat
                    label={r.status === OPEN ? "Blocks left" : "Settled at"}
                    value={
                      r.status === OPEN
                        ? left > 0
                          ? String(left)
                          : "due"
                        : (Number(r.settledPrice) / 1e8).toFixed(2)
                    }
                  />
                </div>

                <div className="mt-2 space-y-1">
                  {entries.map((e, i) => (
                    <div key={i} className="flex items-baseline justify-between text-[11px]">
                      <span className="tnum text-white/55">
                        {e.player.slice(0, 6)}…{e.player.slice(-4)}
                      </span>
                      <span className="tnum text-white/40">
                        {(Number(e.low) / 1e8).toFixed(2)} – {(Number(e.high) / 1e8).toFixed(2)}
                      </span>
                      {r.status === SETTLED ? (
                        <span className={e.won ? "text-green" : "text-red"}>
                          {e.won ? "WON" : "lost"}
                        </span>
                      ) : (
                        <span className="text-dim-2">
                          {entries.length}/{r.maxPlayers}
                        </span>
                      )}
                    </div>
                  ))}
                </div>

                {settleable ? (
                  <button
                    disabled={!!busy}
                    onClick={() => void settle(r.id)}
                    className="key mt-3 w-full rounded-xl bg-[var(--color-cap)] py-2 text-[12px] font-semibold text-black disabled:opacity-40"
                  >
                    {busy === "settling" ? "…" : "SETTLE THIS ROOM"}
                  </button>
                ) : r.status === OPEN && !mine && entries.length < r.maxPlayers ? (
                  <button
                    disabled={!!busy}
                    onClick={() => void joinRoom(codeToText(r.code), r.stake, r.marketId)}
                    className="key mt-3 w-full rounded-xl bg-[var(--color-cap)] py-2 text-[12px] font-semibold text-black disabled:opacity-40"
                  >
                    JOIN FOR {fmtUsd(r.stake)}
                  </button>
                ) : null}
              </div>
            );
          })
        )}
      </div>

      {!account ? (
        <button
          onClick={() => void connect()}
          className="key mt-4 w-full rounded-xl bg-[var(--color-cap)] py-3 text-[13px] font-semibold text-black"
        >
          {injected() ? `CONNECT ON ${activeChain.name.toUpperCase()}` : "NO WALLET FOUND"}
        </button>
      ) : null}
    </div>
  );
}

/** Contract errors are named for a reason; show the name rather than a client's guess. */
function shortError(e: unknown): string {
  const msg = String((e as Error)?.message ?? e);
  const named = msg.match(
    /\b(CodeTaken|UnknownRoom|RoomFull|AlreadyJoined|BadBand|BadHorizon|NotOpenRoom|NotExpired|StalePrice|TooManyPlayers|NoPlayers)\b/,
  );
  if (named) {
    const human: Record<string, string> = {
      CodeTaken: "that code is already in use",
      UnknownRoom: "no room with that code",
      RoomFull: "the room is full",
      AlreadyJoined: "you are already in this room",
      BadBand: "that band is not valid for this room",
      BadHorizon: "that cutoff is outside what the market allows",
      NotOpenRoom: "the room is not open",
      NotExpired: "the cutoff has not passed yet",
      StalePrice: "the price is stale — settlement waits rather than settling wrong",
      TooManyPlayers: "too many seats",
      NoPlayers: "nobody joined",
    };
    return human[named[1]] ?? named[1];
  }
  return msg.slice(0, 140);
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="rounded-xl bg-[#0d0d0d] p-3">
      <div className="label">{label}</div>
      <div className="mt-1">{children}</div>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div className="label">{label}</div>
      <div className="tnum mt-0.5 text-[14px] font-semibold text-white">{value}</div>
    </div>
  );
}
