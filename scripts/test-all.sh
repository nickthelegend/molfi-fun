#!/usr/bin/env bash
# Every suite molfi has, in one run.
#
# The devnet is torn down and redeployed first, deliberately. Both chain suites advance the
# clock past a cutoff to settle, so a second run against the same devnet finds every market
# closed and stops with "no market is still open" — which reads like a broken test and is
# just exhausted state. Rebuilding takes ten seconds and removes the failure mode entirely.
set -euo pipefail
cd "$(dirname "$0")/.."

DEVNET_ACCOUNT=0x034ba56f92265f0868c57d3fe72ecab144fc96f97954bbbc4252cef8e8a979ba
run() { printf '\n\033[1m── %s\033[0m\n' "$1"; shift; "$@"; }

run "Cairo — the contract" bash -c 'cd cairo && snforge test 2>&1 | tail -1'
run "SDK — units, including the calldata the browser sends" pnpm -s test 2>&1 | tail -8
run "Typecheck" pnpm -s typecheck
printf '  clean\n'

if ! command -v starknet-devnet >/dev/null; then
  printf '\n  starknet-devnet not installed; skipping the chain suites\n'
  exit 0
fi

printf '\n\033[1m── A fresh devnet\033[0m\n'
pkill -f starknet-devnet 2>/dev/null || true
sleep 2
nohup starknet-devnet --seed 42 --port 5050 --state-archive-capacity full >/tmp/molfi-devnet.log 2>&1 &
for _ in $(seq 1 30); do
  curl -sf -X POST http://127.0.0.1:5050 -H 'content-type: application/json' \
    -d '{"jsonrpc":"2.0","id":1,"method":"starknet_blockNumber","params":[]}' >/dev/null && break
  sleep 1
done
DEVNET_ACCOUNT_ADDRESS=$DEVNET_ACCOUNT node --experimental-strip-types scripts/deploy.mjs \
  --network devnet --account devnet0 2>&1 | tail -1

run "End to end — both routes, on a real chain" \
  node --experimental-strip-types scripts/e2e.mjs
run "Integration — the console's own calls, signed and executed" \
  node --experimental-strip-types scripts/integration.mjs --network devnet

printf '\n\033[1m── The live product\033[0m\n'
node --experimental-strip-types scripts/verify.mjs || true

pkill -f starknet-devnet 2>/dev/null || true
printf '\n'
