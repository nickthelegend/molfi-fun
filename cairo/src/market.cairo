//! molfi's anonymizer: a prediction market whose positions are commitments.
//!
//! The pool never learns who opened a position, and neither does this contract. What it
//! stores is `poseidon(POSITION_TAG, secret, market_id, band_low, band_high)` — enough to pay
//! exactly one claimant later, and nothing that identifies them now.
//!
//! Two operations, driven entirely by the pool's `privacy_invoke`:
//!
//! * **Open** — the pool has already withdrawn the stake here. Record the commitment, park
//!   the funds, and return an **empty span**. Nothing is credited back yet, which is what
//!   makes this a stateful helper rather than a pass-through.
//! * **Claim** — recompute the commitment from the preimage. If the market has settled and
//!   the band contains the settled price, mark it claimed once, approve the pool, and return
//!   a single `OpenNoteDeposit` crediting the winner's open note.
//!
//! Settlement is separate and permissionless: anyone may call `settle`, because a market
//! whose resolution depends on the operator showing up is not one you should take the other
//! side of.

use starknet::ContractAddress;

#[derive(Drop, Copy, Serde, PartialEq, Debug, starknet::Store)]
pub struct Market {
    /// Pragma pair id — the label as a short string, e.g. 'BTC/USD'.
    pub pair: felt252,
    /// Unix second after which the market may be settled.
    ///
    /// A time, not a block height. Starknet's block cadence is neither fixed nor the thing
    /// that constrains a round here — the oracle's publish interval is — and a horizon
    /// expressed in blocks would drift against the horizon the table was fitted for.
    pub cutoff_at: u64,
    /// How long the round is, in seconds.
    ///
    /// Stored rather than inferred. A verifier has to know which fitted table this market
    /// was supposed to be listed with, and the cutoff alone cannot say: it gives no opening
    /// time, and the settling print's timestamp is when the oracle published, not when the
    /// market opened. Without this field the single most valuable check — that the contract
    /// prices with the table that was published — can never run at all.
    pub round_seconds: u64,
    /// Settlement token, and the token every stake is denominated in.
    pub token: ContractAddress,
    /// Move size over this market's horizon, as a fraction of spot times 1e8.
    ///
    /// Measured from real tape for this pair and this horizon, not assumed. The matching
    /// probability table is stored alongside it, knot by knot.
    pub sigma_1e4: u256,
    /// House edge, basis points.
    pub house_edge_bps: u256,
    /// Zero until settled.
    pub settled_price: u256,
    /// When the settling print was published by the oracle.
    pub settled_at: u64,
    /// When `settle` ran. Together with `settled_at` this is the age the contract actually
    /// asserted on, which is the only comparison a verifier can repeat faithfully.
    pub settled_block_at: u64,
    pub settled_sources: u32,
    pub is_settled: bool,
    /// Total staked into this market.
    pub staked: u256,
    /// Total paid out of it.
    pub paid: u256,
    /// What the house put behind this market.
    ///
    /// A market pays winners more than they staked — that is what a multiplier is — so the
    /// difference has to come from somewhere. Without a bankroll the first winner in a
    /// market can never be paid, because the only money present is their own stake and a
    /// 1.25x payout exceeds it. Recorded per market and public, so the size of the promise
    /// backing a market is visible before anyone takes it.
    pub bankroll: u256,
    /// Payouts committed to open positions and not yet paid.
    ///
    /// Checked when a position opens rather than when it claims. By claim time the money is
    /// already committed and refusing is too late — the position was sold at a price the
    /// market could not honour, and somebody's winning band simply does not pay.
    pub reserved: u256,
}

#[derive(Drop, Copy, Serde, PartialEq, Debug, starknet::Store)]
pub struct Position {
    pub market_id: u64,
    pub band_low: u256,
    pub band_high: u256,
    pub stake: u128,
    pub multiplier_bps: u256,
    pub claimed: bool,
    pub exists: bool,
}

#[starknet::interface]
pub trait IMolfiMarket<T> {
    fn create_market(
        ref self: T,
        pair: felt252,
        cutoff_at: u64,
        round_seconds: u64,
        token: ContractAddress,
        sigma_1e4: u256,
        house_edge_bps: u256,
        table: Span<u256>,
    ) -> u64;
    fn get_table(self: @T, market_id: u64) -> Span<u256>;
    fn accounted_for(self: @T, token: ContractAddress) -> u256;
    fn fund_market(ref self: T, market_id: u64, amount: u256);
    fn settle(ref self: T, market_id: u64);
    fn get_market(self: @T, market_id: u64) -> Market;
    fn market_count(self: @T) -> u64;
    fn get_position(self: @T, commitment: felt252) -> Position;
    fn quote_band(self: @T, market_id: u64, spot: u256, low: u256, high: u256) -> u256;
    fn pool(self: @T) -> ContractAddress;
    fn oracle(self: @T) -> ContractAddress;
}

#[starknet::contract]
pub mod MolfiMarket {
    use core::poseidon::poseidon_hash_span;
    use starknet::{
        ContractAddress, get_caller_address, get_block_timestamp, get_contract_address,
    };
    use starknet::storage::{
        Map, StoragePointerReadAccess, StoragePointerWriteAccess, StorageMapReadAccess,
        StorageMapWriteAccess,
    };
    use molfi::objects::{
        DataType, IAnonymizer, IERC20Dispatcher, IERC20DispatcherTrait, IPragmaOracleDispatcher,
        IPragmaOracleDispatcherTrait, OpenNoteDeposit,
    };
    use molfi::pricing;
    use super::{IMolfiMarket, Market, Position};

    /// Domain separation. Without a tag a position commitment could collide with a hash used
    /// somewhere else that happens to take the same inputs.
    const POSITION_TAG: felt252 = 'MOLFI_POSITION_V1';

    /// Operations the pool can drive through `privacy_invoke`.
    const OP_OPEN: u8 = 0;
    const OP_CLAIM: u8 = 1;

    /// A print older than this is refused. Pragma publishes every few minutes; a market that
    /// settles against an hour-old number is settling against something that already moved.
    const MAX_PRICE_AGE: u64 = 900;

    /// A median of one publisher is one opinion wearing a median's clothes.
    const MIN_SOURCES: u32 = 3;

    /// The shortest round the oracle's cadence can settle honestly. Pragma republishes every
    /// few minutes; anything shorter resolves against a price that was already public.
    const MIN_ROUND_SECONDS: u64 = 900;

    /// A band must pay more than it costs.
    ///
    /// The desk refuses anything under 1.05x, but that is the desk's policy and a trader
    /// does not have to use it. A band wide enough to price at or below 1.00x pays back less
    /// than it took even when it wins, which is not a position anyone can rationally want —
    /// so the contract refuses it too, whatever client asked for it.
    const MIN_MULTIPLIER_BPS: u256 = 10_001;

    /// Past this the quote is 1/p over a table sampled every quarter sigma, and the
    /// arithmetic runs away faster than the measurement behind it supports.
    const MAX_MULTIPLIER_BPS: u256 = 80_000;

    pub mod errors {
        pub const NOT_POOL: felt252 = 'CALLER_NOT_POOL';
        pub const UNKNOWN_OP: felt252 = 'UNKNOWN_OPERATION';
        pub const NO_MARKET: felt252 = 'NO_SUCH_MARKET';
        pub const ALREADY_SETTLED: felt252 = 'ALREADY_SETTLED';
        pub const NOT_SETTLED: felt252 = 'NOT_SETTLED_YET';
        pub const TOO_EARLY: felt252 = 'BEFORE_CUTOFF';
        pub const CLOSED: felt252 = 'MARKET_CLOSED';
        pub const STALE_PRICE: felt252 = 'STALE_PRICE';
        pub const THIN_PRICE: felt252 = 'TOO_FEW_SOURCES';
        pub const ALREADY_CLAIMED: felt252 = 'ALREADY_CLAIMED';
        pub const NO_POSITION: felt252 = 'NO_SUCH_POSITION';
        pub const OUT_OF_BAND: felt252 = 'BAND_MISSED';
        pub const DUPLICATE: felt252 = 'POSITION_EXISTS';
        pub const INSOLVENT: felt252 = 'PAYOUT_EXCEEDS_STAKE';
        pub const BAD_BAND: felt252 = 'BAND_NOT_ORDERED';
        pub const NOT_OWNER: felt252 = 'CALLER_NOT_OWNER';
        pub const ZERO_SIGMA: felt252 = 'ZERO_SIGMA';
        pub const ROUND_TOO_SHORT: felt252 = 'ROUND_SHORTER_THAN_ORACLE';
        pub const ZERO_FUNDING: felt252 = 'ZERO_FUNDING';
        pub const FUNDING_NOT_RECEIVED: felt252 = 'FUNDING_NOT_RECEIVED';
        pub const OVER_RESERVED: felt252 = 'MARKET_CANNOT_COVER_PAYOUT';
        pub const BAND_TOO_WIDE: felt252 = 'BAND_PAYS_LESS_THAN_STAKE';
        pub const BAND_TOO_TIGHT: felt252 = 'BAND_TOO_TIGHT_TO_PRICE';
        pub const STAKE_NOT_RECEIVED: felt252 = 'STAKE_NOT_RECEIVED';
        pub const WRONG_TOKEN: felt252 = 'WRONG_TOKEN_FOR_MARKET';
        pub const ZERO_AMOUNT: felt252 = 'ZERO_AMOUNT';
    }

    #[storage]
    struct Storage {
        pool: ContractAddress,
        oracle: ContractAddress,
        owner: ContractAddress,
        market_count: u64,
        markets: Map<u64, Market>,
        positions: Map<felt252, Position>,
        /// What this contract is accountable for, per token.
        ///
        /// Every stake taken and every bankroll funded adds to it; every payout released
        /// subtracts. It exists so an incoming stake can be *measured* rather than believed:
        /// the balance the token reports, less what was already accounted for, is exactly
        /// what just arrived.
        accounted: Map<ContractAddress, u256>,
        /// The probability table for each market, one knot per slot.
        ///
        /// Stored per market rather than compiled in, because the shape of a fifteen minute
        /// move is not the shape of a four hour one and a single table would misprice at
        /// least one of them. Cairo has no storable array, so the knots are keyed by index.
        tables: Map<(u64, u32), u256>,
    }

    #[event]
    #[derive(Drop, starknet::Event)]
    enum Event {
        MarketCreated: MarketCreated,
        MarketFunded: MarketFunded,
        PositionOpened: PositionOpened,
        MarketSettled: MarketSettled,
        PositionClaimed: PositionClaimed,
    }

    /// Events carry the commitment, never anything that identifies who is behind it.
    #[derive(Drop, starknet::Event)]
    struct MarketCreated {
        #[key]
        market_id: u64,
        pair: felt252,
        cutoff_at: u64,
        round_seconds: u64,
    }

    #[derive(Drop, starknet::Event)]
    struct MarketFunded {
        #[key]
        market_id: u64,
        amount: u256,
        bankroll: u256,
    }

    #[derive(Drop, starknet::Event)]
    struct PositionOpened {
        #[key]
        market_id: u64,
        #[key]
        commitment: felt252,
        stake: u128,
    }

    #[derive(Drop, starknet::Event)]
    struct MarketSettled {
        #[key]
        market_id: u64,
        price: u256,
        published_at: u64,
        sources: u32,
    }

    #[derive(Drop, starknet::Event)]
    struct PositionClaimed {
        #[key]
        market_id: u64,
        #[key]
        commitment: felt252,
        payout: u128,
    }

    #[constructor]
    fn constructor(
        ref self: ContractState,
        pool: ContractAddress,
        oracle: ContractAddress,
        owner: ContractAddress,
    ) {
        self.pool.write(pool);
        self.oracle.write(oracle);
        self.owner.write(owner);
    }

    #[generate_trait]
    impl Internal of InternalTrait {
        /// The table a market prices with, read back knot by knot.
        fn table_of(self: @ContractState, market_id: u64) -> Span<u256> {
            let mut knots: Array<u256> = array![];
            let mut i: u32 = 0;
            while i != pricing::TABLE_LEN {
                knots.append(self.tables.read((market_id, i)));
                i += 1;
            }
            knots.span()
        }

        /// The commitment a position is stored under.
        fn commitment_of(
            self: @ContractState, secret: felt252, market_id: u64, low: u256, high: u256,
        ) -> felt252 {
            poseidon_hash_span(
                array![
                    POSITION_TAG,
                    secret,
                    market_id.into(),
                    low.low.into(),
                    low.high.into(),
                    high.low.into(),
                    high.high.into(),
                ]
                    .span(),
            )
        }

        /// Book tokens that have arrived, and refuse if they have not.
        ///
        /// `balance_of` less what was already accounted for is exactly what is new. Nothing
        /// here trusts a number that came in with the call.
        fn take(ref self: ContractState, token: ContractAddress, amount: u256, err: felt252) {
            assert(amount != 0, errors::ZERO_AMOUNT);
            let erc20 = IERC20Dispatcher { contract_address: token };
            let held = erc20.balance_of(get_contract_address());
            let booked = self.accounted.read(token);
            assert(held >= booked + amount, err);
            self.accounted.write(token, booked + amount);
        }

        /// Release tokens the contract is no longer accountable for.
        fn release(ref self: ContractState, token: ContractAddress, amount: u256) {
            let booked = self.accounted.read(token);
            self.accounted.write(token, if booked > amount { booked - amount } else { 0 });
        }

        /// Only the pool may drive this contract. Without this anyone could open a position
        /// without paying for it, or claim one they do not hold.
        fn assert_pool(self: @ContractState) {
            assert(get_caller_address() == self.pool.read(), errors::NOT_POOL);
        }
    }

    #[abi(embed_v0)]
    impl MolfiMarketImpl of IMolfiMarket<ContractState> {
        /// List a market.
        ///
        /// Owner only, and the restriction is load bearing rather than reflexive: the whole
        /// verifier story is that a settled market can be recomputed from the published
        /// calibration. A market listed by a stranger with a table of their own choosing
        /// would still be honestly settled and still pay out correctly — conservation sees to
        /// that — but nobody could check its odds against anything.
        fn create_market(
            ref self: ContractState,
            pair: felt252,
            cutoff_at: u64,
            round_seconds: u64,
            token: ContractAddress,
            sigma_1e4: u256,
            house_edge_bps: u256,
            table: Span<u256>,
        ) -> u64 {
            assert(get_caller_address() == self.owner.read(), errors::NOT_OWNER);
            assert(cutoff_at > get_block_timestamp(), errors::CLOSED);
            assert(sigma_1e4 != 0, errors::ZERO_SIGMA);
            // A round shorter than the oracle's publish interval settles against a price
            // that was already public when it opened.
            assert(round_seconds >= MIN_ROUND_SECONDS, errors::ROUND_TOO_SHORT);
            // A table that is not a CDF misprices every band in the market at once, so it is
            // rejected here rather than discovered at the first quote.
            pricing::validate_table(table);

            let id = self.market_count.read() + 1;
            self.market_count.write(id);

            let mut i: u32 = 0;
            while i != pricing::TABLE_LEN {
                self.tables.write((id, i), *table.at(i));
                i += 1;
            }

            self
                .markets
                .write(
                    id,
                    Market {
                        pair,
                        cutoff_at,
                        round_seconds,
                        token,
                        sigma_1e4,
                        house_edge_bps,
                        settled_price: 0,
                        settled_at: 0,
                        settled_block_at: 0,
                        settled_sources: 0,
                        is_settled: false,
                        staked: 0,
                        paid: 0,
                        bankroll: 0,
                        reserved: 0,
                    },
                );
            self.emit(MarketCreated { market_id: id, pair, cutoff_at, round_seconds });
            id
        }

        fn get_table(self: @ContractState, market_id: u64) -> Span<u256> {
            self.table_of(market_id)
        }

        /// What this contract believes it is holding, per token.
        ///
        /// Public so anyone can compare it against the token's own `balance_of`. They should
        /// agree; a balance below it means the contract cannot honour what it has recorded.
        fn accounted_for(self: @ContractState, token: ContractAddress) -> u256 {
            self.accounted.read(token)
        }

        /// Put the house's money behind a market.
        ///
        /// The amount is measured as a balance delta rather than taken on trust: the funder
        /// transfers tokens to this contract and then calls, and only what actually arrived
        /// is credited. Recording a claimed amount would let a market advertise a bankroll
        /// it does not hold, which is the one number a trader most needs to be true.
        ///
        /// Permissionless. Anyone may fund a market — it is a gift to its participants and
        /// there is no reason to stop them — but only the owner may list one.
        fn fund_market(ref self: ContractState, market_id: u64, amount: u256) {
            let mut m = self.markets.read(market_id);
            assert(m.cutoff_at != 0, errors::NO_MARKET);
            assert(!m.is_settled, errors::CLOSED);
            assert(amount != 0, errors::ZERO_FUNDING);

            self.take(m.token, amount, errors::FUNDING_NOT_RECEIVED);

            m.bankroll = m.bankroll + amount;
            self.markets.write(market_id, m);
            self.emit(MarketFunded { market_id, amount, bankroll: m.bankroll });
        }

        /// Settle a market against the oracle. Permissionless on purpose.
        ///
        /// Two independent ways the price can be unusable, and each gets its own refusal: an
        /// old print means publishers stopped, and a thin one means the median is a single
        /// opinion. Either alone would settle every position in the market against a number
        /// nobody should trust, so neither is waved through.
        fn settle(ref self: ContractState, market_id: u64) {
            let mut m = self.markets.read(market_id);
            assert(m.cutoff_at != 0, errors::NO_MARKET);
            assert(!m.is_settled, errors::ALREADY_SETTLED);
            assert(get_block_timestamp() >= m.cutoff_at, errors::TOO_EARLY);

            let oracle = IPragmaOracleDispatcher { contract_address: self.oracle.read() };
            let response = oracle.get_data_median(DataType::SpotEntry(m.pair));

            let now = get_block_timestamp();
            assert(now - response.last_updated_timestamp <= MAX_PRICE_AGE, errors::STALE_PRICE);
            assert(response.num_sources_aggregated >= MIN_SOURCES, errors::THIN_PRICE);

            m.settled_price = response.price.into();
            m.settled_at = response.last_updated_timestamp;
            m.settled_block_at = now;
            m.settled_sources = response.num_sources_aggregated;
            m.is_settled = true;
            self.markets.write(market_id, m);

            self
                .emit(
                    MarketSettled {
                        market_id,
                        price: m.settled_price,
                        published_at: m.settled_at,
                        sources: m.settled_sources,
                    },
                );
        }

        fn get_market(self: @ContractState, market_id: u64) -> Market {
            self.markets.read(market_id)
        }

        fn market_count(self: @ContractState) -> u64 {
            self.market_count.read()
        }

        fn get_position(self: @ContractState, commitment: felt252) -> Position {
            self.positions.read(commitment)
        }

        /// What a band sells for right now, so a caller can show the quote before committing.
        fn quote_band(
            self: @ContractState, market_id: u64, spot: u256, low: u256, high: u256,
        ) -> u256 {
            let m = self.markets.read(market_id);
            assert(m.cutoff_at != 0, errors::NO_MARKET);
            let q = pricing::quote(
                self.table_of(market_id), spot, low, high, m.sigma_1e4, m.house_edge_bps,
            );
            q.multiplier_bps
        }

        fn pool(self: @ContractState) -> ContractAddress {
            self.pool.read()
        }

        fn oracle(self: @ContractState) -> ContractAddress {
            self.oracle.read()
        }
    }

    #[abi(embed_v0)]
    impl AnonymizerImpl of IAnonymizer<ContractState> {
        /// Parameter order follows the escrow helper in the STRK20 docs: the operation
        /// first, then this app's own fields, then `token` and `amount` adjacent, then
        /// `secret` and `note_id` last. The pool deserializes calldata straight into these
        /// parameters, so the order is part of the interface and matching the documented
        /// idiom is the difference between a dry run that passes and one that does not.
        fn privacy_invoke(
            ref self: ContractState,
            operation: u8,
            market_id: u64,
            band_low: u256,
            band_high: u256,
            token: ContractAddress,
            amount: u128,
            secret: felt252,
            note_id: felt252,
        ) -> Span<OpenNoteDeposit> {
            self.assert_pool();

            if operation == OP_OPEN {
                self.open(market_id, secret, band_low, band_high, token, amount)
            } else if operation == OP_CLAIM {
                self.claim(market_id, secret, band_low, band_high, note_id, token)
            } else {
                core::panic_with_felt252(errors::UNKNOWN_OP)
            }
        }
    }

    #[generate_trait]
    impl Operations of OperationsTrait {
        /// Open a position. Returns an empty span: the stake stays parked here, so there is
        /// nothing for the pool to credit back yet.
        fn open(
            ref self: ContractState,
            market_id: u64,
            secret: felt252,
            band_low: u256,
            band_high: u256,
            token: ContractAddress,
            amount: u128,
        ) -> Span<OpenNoteDeposit> {
            let mut m = self.markets.read(market_id);
            assert(m.cutoff_at != 0, errors::NO_MARKET);
            assert(!m.is_settled, errors::CLOSED);
            assert(get_block_timestamp() < m.cutoff_at, errors::CLOSED);
            assert(band_low < band_high, errors::BAD_BAND);
            assert(token == m.token, errors::WRONG_TOKEN);

            // The stake is MEASURED, never believed.
            //
            // The pool's `InvokeExternalInput` carries a contract address and calldata and
            // nothing else — no token, no amount — so the tokens arrive by a separate
            // withdraw action in the same transaction, and this contract has no way to know
            // from the call itself that they did. Taking `amount` on trust would let anyone
            // able to reach `privacy_invoke` record a position backed by nothing and later
            // claim a payout funded by the bankroll and by other people's stakes.
            //
            // The docs state the rule plainly for the output side — "measure output by
            // balance delta" — and it applies at least as hard to the input side, where
            // getting it wrong is not a wrong number but a free position.
            self.take(m.token, amount.into(), errors::STAKE_NOT_RECEIVED);

            let commitment = self.commitment_of(secret, market_id, band_low, band_high);
            let existing = self.positions.read(commitment);
            assert(!existing.exists, errors::DUPLICATE);

            // The multiplier is fixed at open, from the band the trader actually bought.
            // Pricing it again at claim time would let a later move change what they were sold.
            // Priced about the band's own midpoint rather than a spot the contract would
            // have to read from the oracle. For the symmetric bands the desk sells these are
            // the same number exactly, and this way the price a position is sold at cannot be
            // moved by an oracle update landing in the same block.
            let mid = (band_low + band_high) / 2;
            let q = pricing::quote(
                self.table_of(market_id), mid, band_low, band_high, m.sigma_1e4,
                m.house_edge_bps,
            );

            assert(q.multiplier_bps >= MIN_MULTIPLIER_BPS, errors::BAND_TOO_WIDE);
            assert(q.multiplier_bps <= MAX_MULTIPLIER_BPS, errors::BAND_TOO_TIGHT);

            // Reserve the whole payout now.
            //
            // A market may only sell a position it can already cover: the stake that just
            // arrived, plus the house's bankroll, minus everything committed to positions
            // still open. Checking this at claim time instead would mean discovering at
            // settlement that a winning band cannot be paid — after the trader has held it
            // for the whole round believing otherwise.
            let payout = pricing::payout_for(amount.into(), q.multiplier_bps);
            let backing = m.staked + amount.into() + m.bankroll;
            assert(m.reserved + payout <= backing, errors::OVER_RESERVED);

            self
                .positions
                .write(
                    commitment,
                    Position {
                        market_id,
                        band_low,
                        band_high,
                        stake: amount,
                        multiplier_bps: q.multiplier_bps,
                        claimed: false,
                        exists: true,
                    },
                );

            m.staked = m.staked + amount.into();
            m.reserved = m.reserved + payout;
            self.markets.write(market_id, m);

            self.emit(PositionOpened { market_id, commitment, stake: amount });

            array![].span()
        }

        /// Claim a winning position into an open note.
        ///
        /// The commitment is recomputed from the preimage; the caller cannot name one they do
        /// not hold the secret for. The `claimed` flag flips exactly once, so a second attempt
        /// hits ALREADY_CLAIMED rather than paying twice.
        fn claim(
            ref self: ContractState,
            market_id: u64,
            secret: felt252,
            band_low: u256,
            band_high: u256,
            note_id: felt252,
            token: ContractAddress,
        ) -> Span<OpenNoteDeposit> {
            let mut m = self.markets.read(market_id);
            assert(m.cutoff_at != 0, errors::NO_MARKET);
            assert(m.is_settled, errors::NOT_SETTLED);

            let commitment = self.commitment_of(secret, market_id, band_low, band_high);
            let mut position = self.positions.read(commitment);
            assert(position.exists, errors::NO_POSITION);
            assert(!position.claimed, errors::ALREADY_CLAIMED);

            // The band has to contain the settled price. Inclusive at neither edge: a price
            // exactly on the boundary did not print inside the range.
            assert(
                m.settled_price > position.band_low && m.settled_price < position.band_high,
                errors::OUT_OF_BAND,
            );

            let payout = pricing::payout_for(position.stake.into(), position.multiplier_bps);

            // Conservation. A market cannot pay out more than the stakes it took plus the
            // bankroll the house put behind it. The reservation at open is what makes this
            // hold rather than hope; asserting it again here means an arithmetic mistake
            // anywhere fails loudly instead of draining the pot.
            assert(m.paid + payout <= m.staked + m.bankroll, errors::INSOLVENT);

            position.claimed = true;
            self.positions.write(commitment, position);

            m.paid = m.paid + payout;
            // The payout is no longer a commitment; it has been made.
            m.reserved = if m.reserved > payout {
                m.reserved - payout
            } else {
                0
            };
            self.markets.write(market_id, m);

            let payout_u128: u128 = payout.try_into().unwrap();

            // The payout stops being ours the moment the pool is allowed to pull it, so it
            // leaves the ledger here rather than when the transfer lands. Leaving it in
            // would let the next open count the same tokens as a fresh stake.
            self.release(token, payout);

            // Approve, do not transfer. The pool pulls the tokens itself when it applies the
            // deposit, which is what the pattern requires.
            let erc20 = IERC20Dispatcher { contract_address: token };
            erc20.approve(self.pool.read(), payout);

            self.emit(PositionClaimed { market_id, commitment, payout: payout_u128 });

            array![OpenNoteDeposit { note_id, token, amount: payout_u128 }].span()
        }
    }
}
