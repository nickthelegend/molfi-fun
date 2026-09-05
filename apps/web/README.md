# @molfi/web — the console

## Why `regions: ["bom1"]`

The live mark comes from Binance, and Binance answers **451** to US IP addresses. Vercel runs
functions in `iad1` (Washington) unless told otherwise, so on the default region every price
request failed and the console had no mark at all.

Mumbai is not arbitrary: it is where the previous host served from, and it is close to where
this is operated. Any non-US region works. If the mark ever needs a second source, the region
pin can go — but the *tape* must stay Binance, because that is the data the probability
tables were fitted on, and replaying a different exchange's returns would quote one
probability and deliver another.

## Environment

See `.env.example`. Nothing here needs a secret to boot: with no `STARKNET_RPC_URL` the app
reads a public Starknet endpoint, and `/api/health` says which endpoint answered so "working"
and "working on the backup" stay distinguishable.
