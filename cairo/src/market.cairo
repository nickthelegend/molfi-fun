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

/// A position, stored as what it costs rather than what it says.
///
/// The band itself is deliberately absent. What a position needs on chain is its *price*,
/// and the price depends only on how far the band reaches from its own midpoint — a pair of
/// ratios. Storing the reach instead of the edges means the chain can charge for a position
/// correctly while having no idea what it predicts, and the trader reveals the band only
/// when they claim, against the commitment that has bound it since they opened.
#[derive(Drop, Copy, Serde, PartialEq, Debug, starknet::Store)]
pub struct Position {
    pub market_id: u64,
    /// `(mid - band_low) * 1e8 / mid`, where `mid` is the band's own midpoint.
    pub low_off_1e8: u256,
    /// `(band_high - mid) * 1e8 / mid`.
    pub high_off_1e8: u256,
    pub stake: u128,
    pub multiplier_bps: u256,
    pub claimed: bool,
    pub exists: bool,
    /// Who may claim it, on the public route. Zero for a position opened through the pool,
    /// where the secret is the only credential and no address is ever recorded.
    pub owner: ContractAddress,
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
    fn quote_offsets(self: @T, market_id: u64, low_off_1e8: u256, high_off_1e8: u256) -> u256;
    fn open_position(
        ref self: T,
        market_id: u64,
        commitment: felt252,
        low_off_1e8: u256,
        high_off_1e8: u256,
        amount: u256,
    );
    fn claim_position(ref self: T, market_id: u64, secret: felt252, band_low: u256, band_high: u256);
    fn pool(self: @T) -> ContractAddress;
    fn oracle(self: @T) -> ContractAddress;
    fn set_oracle(ref self: T, who: ContractAddress);
    fn owner(self: @T) -> ContractAddress;
}

#[starknet::contract]
pub mod MolfiMarket {
    use core::num::traits::Zero;
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
        pub const NOT_OWNER_OF_POSITION: felt252 = 'NOT_YOUR_POSITION';
        pub const BAND_MISMATCH: felt252 = 'BAND_DOES_NOT_MATCH_PRICE';
        pub const WRONG_ROUTE: felt252 = 'WRONG_CLAIM_ROUTE';
        pub const STAKE_TOO_LARGE: felt252 = 'STAKE_TOO_LARGE';
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
        /// The market whose stored table this one shares, or zero for "my own".
        ///
        /// Seventeen `u256` knots is thirty-four storage writes, and the keeper lists the same
        /// three tables over and over — one per pair and round length — so all but the first
        /// listing of each was paying to write a table the contract already had. That was the
        /// single largest cost in the system: about 15M L2 gas of the 18M a listing burned.
        ///
        /// A pointer rather than a shared slot on purpose. A settled market has to stay
        /// auditable against the exact table it was priced with, and tables here are
        /// write-once — the market a pointer names never rewrites its knots — so following
        /// one can never change what an old market recomputes to.
        table_alias: Map<u64, u64>,
        /// First market to store a given table, by the Poseidon hash of its knots.
        ///
        /// Zero means the table has not been seen. Content-addressed rather than keyed by
        /// pair and round length so that a recalibration is a different table, gets its own
        /// storage, and cannot retroactively change how an already-settled market prices.
        ///
        /// The obvious cheaper-looking alternative — keep the last market listed for a pair
        /// and round, and compare its seventeen knots against the incoming ones — was built
        /// and measured, and is worse on both axes: 10,129 felts of class against 10,037,
        /// and a reusing listing that costs *more* l2_gas than writing a fresh table, because
        /// seventeen storage reads outweigh what they avoid. Recorded so it is not tried
        /// again.
        table_index: Map<felt252, u64>,
    }

    #[event]
    #[derive(Drop, starknet::Event)]
    enum Event {
        OracleChanged: OracleChanged,
        MarketCreated: MarketCreated,
        MarketFunded: MarketFunded,
        PositionOpened: PositionOpened,
        MarketSettled: MarketSettled,
        PositionClaimed: PositionClaimed,
    }

    /// Repointing the oracle is logged with both addresses, so the full history of what a
    /// market could have settled against is reconstructable from logs.
    #[derive(Drop, starknet::Event)]
    struct OracleChanged {
        from: ContractAddress,
        to: ContractAddress,
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
            // One hop, never two: a market that stores its own table has alias zero, and a
            // market that points at another always points at one that stores its own.
            let alias = self.table_alias.read(market_id);
            let source = if alias == 0 {
                market_id
            } else {
                alias
            };
            let mut knots: Array<u256> = array![];
            let mut i: u32 = 0;
            while i != pricing::TABLE_LEN {
                knots.append(self.tables.read((source, i)));
                i += 1;
            }
            knots.span()
        }

        /// The Poseidon hash of a table's knots, low limb then high, in order.
        ///
        /// Both limbs of every `u256` go in. Hashing only the low limbs would let two tables
        /// that differ solely above 2^128 share storage, which is not a case that can arise
        /// from a real calibration but is not a property worth leaving to luck.
        fn table_hash(self: @ContractState, table: Span<u256>) -> felt252 {
            let mut felts: Array<felt252> = array![];
            let mut i: u32 = 0;
            while i != pricing::TABLE_LEN {
                let knot = *table.at(i);
                felts.append(knot.low.into());
                felts.append(knot.high.into());
                i += 1;
            }
            poseidon_hash_span(felts.span())
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

        /// The band being revealed at claim has to be the band that was paid for.
        ///
        /// Only the reach was stored, so this is the check that binds it: recompute the two
        /// ratios from the band and require them to be the ones the position was priced with.
        /// The commitment already binds the band to the trader; this binds it to the price.
        /// Without it a trader could buy a wide, cheap, high-probability band and claim it as
        /// a narrow one paying eight times as much.
        fn assert_band_matches(
            self: @ContractState, position: Position, band_low: u256, band_high: u256,
        ) {
            assert(band_low < band_high, errors::BAD_BAND);
            let (low_off, high_off) = pricing::offsets_of(
                (band_low + band_high) / 2, band_low, band_high,
            );
            assert(
                low_off == position.low_off_1e8 && high_off == position.high_off_1e8,
                errors::BAND_MISMATCH,
            );
        }

        /// Everything both trading routes do once the stake has arrived.
        ///
        /// The two routes differ only in how the tokens get here and who is allowed to claim.
        /// Pricing, reservation, conservation and the duplicate check are the same code for
        /// both, on purpose: a second implementation of any of them is a second place for the
        /// house to be wrong about what it owes.
        fn open_inner(
            ref self: ContractState,
            market_id: u64,
            commitment: felt252,
            low_off_1e8: u256,
            high_off_1e8: u256,
            amount: u128,
            owner: ContractAddress,
        ) {
            let mut m = self.markets.read(market_id);
            assert(m.cutoff_at != 0, errors::NO_MARKET);
            assert(!m.is_settled, errors::CLOSED);
            assert(get_block_timestamp() < m.cutoff_at, errors::CLOSED);

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
            // getting it wrong is not a wrong number but a free position. The public route
            // pulls the tokens itself a line earlier and is measured all the same, so a
            // token that quietly transfers less than it was asked for is caught there too.
            self.take(m.token, amount.into(), errors::STAKE_NOT_RECEIVED);

            let existing = self.positions.read(commitment);
            assert(!existing.exists, errors::DUPLICATE);

            // The multiplier is fixed at open, from the reach the trader actually bought.
            // Pricing it again at claim time would let a later move change what they were
            // sold. Priced about the band's own midpoint rather than a spot the contract
            // would have to read from the oracle, so the price a position is sold at cannot
            // be moved by an oracle update landing in the same block.
            let q = pricing::quote_off(
                self.table_of(market_id), low_off_1e8, high_off_1e8, m.sigma_1e4,
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
            // `paid` belongs in this sum even though it is always zero here.
            //
            // A claim needs `is_settled` and an open refuses it, so the two windows cannot
            // overlap and nothing has left the market yet. That makes the term redundant
            // today and load-bearing the moment the open window changes — a rollover, a
            // re-open, an early settle — at which point this line would be authorising
            // reservations against money that had already gone out. `claim_position` counts
            // it; so does the direction market. Cheap to be consistent, expensive not to be.
            assert(m.paid + m.reserved + payout <= backing, errors::OVER_RESERVED);

            self
                .positions
                .write(
                    commitment,
                    Position {
                        market_id,
                        low_off_1e8,
                        high_off_1e8,
                        stake: amount,
                        multiplier_bps: q.multiplier_bps,
                        claimed: false,
                        exists: true,
                        owner,
                    },
                );

            m.staked = m.staked + amount.into();
            m.reserved = m.reserved + payout;
            self.markets.write(market_id, m);

            self.emit(PositionOpened { market_id, commitment, stake: amount });
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

            // Write the knots once, then point at them. The keeper relists the same three
            // tables indefinitely, so this is the difference between thirty-four storage
            // writes per listing and one.
            let hash = self.table_hash(table);
            let seen = self.table_index.read(hash);
            if seen == 0 {
                let mut i: u32 = 0;
                while i != pricing::TABLE_LEN {
                    self.tables.write((id, i), *table.at(i));
                    i += 1;
                }
                self.table_index.write(hash, id);
            } else {
                self.table_alias.write(id, seen);
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

        /// What a band of this reach sells for. The quote the public route is charged.
        ///
        /// Takes the same two ratios `open_position` takes, so a trader can read the price
        /// of the exact thing they are about to buy rather than of a band that has to be
        /// described out loud first.
        fn quote_offsets(
            self: @ContractState, market_id: u64, low_off_1e8: u256, high_off_1e8: u256,
        ) -> u256 {
            let m = self.markets.read(market_id);
            assert(m.cutoff_at != 0, errors::NO_MARKET);
            let q = pricing::quote_off(
                self.table_of(market_id), low_off_1e8, high_off_1e8, m.sigma_1e4,
                m.house_edge_bps,
            );
            q.multiplier_bps
        }

        /// Open a position directly, from an ordinary Starknet account.
        ///
        /// The other route into this contract is the STRK20 pool, which hides the trader and
        /// the size along with the band. This one hides only the band — and it is the route
        /// anyone can use today, with a wallet they already have and no shielded balance.
        /// A market only one kind of wallet can reach is a market nobody trades.
        ///
        /// The band never appears. The caller sends a commitment they computed themselves
        /// and the two reach ratios the price depends on, so what lands in a block is "someone
        /// bought a band 0.4% wide on BTC for 2 STRK" and not which 0.4%. The band is revealed
        /// to `claim_position` after the market has settled, against the commitment that has
        /// bound it since this call — which is the whole of molfi's claim, working without a
        /// privacy wallet.
        ///
        /// Hiding the band cannot cost the house anything, which is why it is safe to price
        /// one sight unseen. The quote assumes the band straddles spot; any band that does
        /// not is strictly *less* likely to contain the settling print than the one that was
        /// paid for. A trader who lies about where their band sits can only overpay.
        fn open_position(
            ref self: ContractState,
            market_id: u64,
            commitment: felt252,
            low_off_1e8: u256,
            high_off_1e8: u256,
            amount: u256,
        ) {
            let m = self.markets.read(market_id);
            assert(m.cutoff_at != 0, errors::NO_MARKET);
            let stake: u128 = amount.try_into().expect(errors::STAKE_TOO_LARGE);
            let trader = get_caller_address();

            // Pull the stake before booking it. `open_inner` then measures the balance delta
            // exactly as the pool route does — the transfer is what makes the tokens arrive,
            // the measurement is what makes the contract believe it.
            let erc20 = IERC20Dispatcher { contract_address: m.token };
            erc20.transfer_from(trader, get_contract_address(), amount);

            self.open_inner(market_id, commitment, low_off_1e8, high_off_1e8, stake, trader);
        }

        /// Claim a settled winning position opened on the public route, paid to the caller.
        ///
        /// This is where the band finally becomes public. The commitment is recomputed from
        /// the preimage, so a trader cannot name a band they did not buy, and the reach
        /// ratios are recomputed from that band and checked against the ones the position was
        /// priced with — otherwise a cheap wide band could be claimed as an expensive narrow
        /// one after the fact.
        ///
        /// Bound to the address that opened it. The secret is public the moment this
        /// transaction is in a block, so without the owner check the first person to see it
        /// could resubmit the same claim and take the payout.
        fn claim_position(
            ref self: ContractState,
            market_id: u64,
            secret: felt252,
            band_low: u256,
            band_high: u256,
        ) {
            let mut m = self.markets.read(market_id);
            assert(m.cutoff_at != 0, errors::NO_MARKET);
            assert(m.is_settled, errors::NOT_SETTLED);

            let commitment = self.commitment_of(secret, market_id, band_low, band_high);
            let mut position = self.positions.read(commitment);
            assert(position.exists, errors::NO_POSITION);
            assert(!position.claimed, errors::ALREADY_CLAIMED);

            let claimant = get_caller_address();
            assert(!position.owner.is_zero(), errors::WRONG_ROUTE);
            assert(position.owner == claimant, errors::NOT_OWNER_OF_POSITION);

            self.assert_band_matches(position, band_low, band_high);
            /// Inclusive, because that is the interval the trader was charged for.
            ///
            /// `prob_inside` integrates over the closed band, so the price of a position
            /// already counts both endpoints. Excluding them on the way out meant selling an
            /// interval fractionally wider than the one being paid on — an edge that appears
            /// nowhere in the quoted multiplier. An exact hit at eight decimal places is
            /// vanishingly rare, which is the argument for getting it right rather than
            /// against: it costs nothing, and an undocumented house-favouring boundary is the
            /// sort of thing that reads badly when someone else finds it.
            assert(
                m.settled_price >= band_low && m.settled_price <= band_high, errors::OUT_OF_BAND,
            );

            let payout = pricing::payout_for(position.stake.into(), position.multiplier_bps);
            assert(m.paid + payout <= m.staked + m.bankroll, errors::INSOLVENT);

            position.claimed = true;
            self.positions.write(commitment, position);

            m.paid = m.paid + payout;
            // Plain subtraction, so a broken invariant halts rather than being clamped away.
            //
            // `reserved` gains exactly this payout when the position opens and loses exactly
            // it here, and a position claims once — so it cannot underflow. Saturating to zero
            // instead would mean that if it ever did, the accounting had already gone wrong
            // and the market would carry on selling against numbers nobody could trust.
            m.reserved = m.reserved - payout;
            self.markets.write(market_id, m);

            self.release(m.token, payout);
            let erc20 = IERC20Dispatcher { contract_address: m.token };
            erc20.transfer(claimant, payout);

            let payout_u128: u128 = payout.try_into().unwrap();
            self.emit(PositionClaimed { market_id, commitment, payout: payout_u128 });
        }

        fn pool(self: @ContractState) -> ContractAddress {
            self.pool.read()
        }

        fn oracle(self: @ContractState) -> ContractAddress {
            self.oracle.read()
        }

        /// Repoint the oracle. Owner only, and it cannot touch a market already settled.
        ///
        /// This exists for one reason and it is worth naming rather than leaving as a
        /// generic admin hook: **Pragma stopped publishing to Sepolia**, so a testnet
        /// deployment needs to be repointed at a relay to demonstrate settlement at all.
        /// Without it the choice is a fresh deployment every time, which throws away the
        /// history that makes a deployment worth looking at.
        ///
        /// It is also a real power, so it is bounded. Settled markets keep the price they
        /// settled on — `settle` writes it into storage and never reads the oracle again —
        /// so repointing can change how future markets resolve and can never rewrite one
        /// that already has. The change is logged with both addresses.
        fn set_oracle(ref self: ContractState, who: ContractAddress) {
            assert(get_caller_address() == self.owner.read(), errors::NOT_OWNER);
            let from = self.oracle.read();
            self.oracle.write(who);
            self.emit(OracleChanged { from, to: who });
        }

        fn owner(self: @ContractState) -> ContractAddress {
            self.owner.read()
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
        ///
        /// The pool route knows the band, because the whole call is inside a proof and
        /// nothing in it is public. So it derives the commitment and the reach ratios itself
        /// rather than being handed them, and from there the two routes are the same code.
        fn open(
            ref self: ContractState,
            market_id: u64,
            secret: felt252,
            band_low: u256,
            band_high: u256,
            token: ContractAddress,
            amount: u128,
        ) -> Span<OpenNoteDeposit> {
            let m = self.markets.read(market_id);
            assert(m.cutoff_at != 0, errors::NO_MARKET);
            assert(band_low < band_high, errors::BAD_BAND);
            assert(token == m.token, errors::WRONG_TOKEN);

            let commitment = self.commitment_of(secret, market_id, band_low, band_high);
            let (low_off, high_off) = pricing::offsets_of(
                (band_low + band_high) / 2, band_low, band_high,
            );

            self.open_inner(market_id, commitment, low_off, high_off, amount, Zero::zero());
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

            // A position opened from a public address is claimed back to that address, not
            // laundered into a note. Sending it through here instead would let anyone holding
            // the secret take a payout the owner check on the public route exists to protect.
            assert(position.owner.is_zero(), errors::WRONG_ROUTE);

            // The band was never stored, only what it cost. Recomputing the reach from the
            // band being revealed now is what stops a wide band bought cheap from being
            // claimed as the narrow one it was not.
            self.assert_band_matches(position, band_low, band_high);

            /// The band has to contain the settled price, endpoints included.
            ///
            /// This read "inclusive at neither edge: a price exactly on the boundary did not
            /// print inside the range" — a defensible sentence that happened not to match what
            /// the trader was charged. `prob_inside` integrates over the closed interval, so
            /// the position was priced on a band fractionally wider than the one it could be
            /// paid on, and the difference went to the house. Both routes now agree with the
            /// pricing and with each other.
            assert(
                m.settled_price >= band_low && m.settled_price <= band_high, errors::OUT_OF_BAND,
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
