//! The other game: up or down, and which one you picked is nobody's business.
//!
//! # Why this is a separate contract and not a flag on `MolfiMarket`
//!
//! A range position is priced by *how far* the band reaches, so the contract must be told a
//! pair of reach ratios to charge correctly. A direction position has nothing to measure —
//! there are two outcomes and the price of each follows from the round alone. Bolting a
//! `is_direction: bool` onto the range market would carry the reach fields into every
//! direction position as dead storage, and every reader of `Position` would have to know
//! which half of the struct is meaningful. Two contracts, two shapes, one shared kernel.
//!
//! # The privacy argument, which is the whole point
//!
//! A direction is one bit. If the contract stored it, the game would be over: `get_position`
//! is public, every commitment is an indexed event key, and anyone could list a market and
//! read which way each position was pointing — the exact leak that makes an order a signal
//! before it is a trade.
//!
//! So the direction is never sent. What is sent is
//! `poseidon(DIRECTION_TAG, secret, market_id, direction)`, and the contract learns which way
//! you went only when you claim, by recomputing the commitment from the preimage you reveal.
//! One bit has almost no entropy on its own, which is exactly why the secret is in the hash:
//! without it, two guesses would break every position on the board.
//!
//! **The quote is what makes this work.** Both sides of a direction market are quoted the
//! *same* multiplier, so asking for a price reveals nothing — there is only one price. That
//! is not a convenience, it is load-bearing: if up and down were priced differently, the
//! amount reserved against a position would say which side it was on, and the reserve is
//! public. A symmetric quote is the reason the bit stays hidden.
//!
//! # What that costs, stated plainly
//!
//! Only one side of a direction market can win, so the house's true exposure is
//! `max(owed to up, owed to down)`, not the sum. Reserving the maximum would roughly double
//! capacity — and would require the contract to know which side each position is on, which is
//! the one thing it must not know. So every position reserves its full payout and the market
//! is over-collateralised by construction. Privacy is paid for in capacity here, and this
//! comment is where that bill is recorded rather than discovered later.

use molfi::objects::OpenNoteDeposit;
use starknet::ContractAddress;

/// A direction market. Same settlement machinery as a range market, different question.
#[derive(Drop, Copy, Serde, PartialEq, Debug, starknet::Store)]
pub struct Round {
    /// Pragma pair id — the label as a short string, e.g. 'BTC/USD'.
    pub pair: felt252,
    /// Unix second after which the round may be settled.
    pub cutoff_at: u64,
    /// How long the round is, in seconds. Stored so a verifier knows which calibration this
    /// round was supposed to be listed with.
    pub round_seconds: u64,
    pub token: ContractAddress,
    /// The price every position in this round is measured against.
    ///
    /// Fixed at listing and public, deliberately. A per-position entry price would be a
    /// timestamp in disguise: the reference alone would say when each trader arrived, and
    /// with it, roughly what they saw. One reference for the whole round means the only thing
    /// a position reveals is that it exists.
    pub reference_price: u256,
    /// When the reference print was published, so its freshness can be rechecked.
    pub reference_at: u64,
    pub reference_sources: u32,
    /// House edge, basis points. Applied identically to both sides.
    pub house_edge_bps: u256,
    /// The multiplier both sides are sold at, fixed at listing.
    ///
    /// Fixed rather than recomputed per open, because a multiplier that drifts during the
    /// round is a second channel: two positions reserving different amounts were opened at
    /// different times, and the reserve is public. One number for the round closes it.
    pub multiplier_bps: u256,
    pub settled_price: u256,
    pub settled_at: u64,
    pub settled_block_at: u64,
    pub settled_sources: u32,
    pub is_settled: bool,
    pub staked: u256,
    pub paid: u256,
    pub bankroll: u256,
    pub reserved: u256,
}

/// A direction position: what it costs, and nothing about what it says.
#[derive(Drop, Copy, Serde, PartialEq, Debug, starknet::Store)]
pub struct Ticket {
    pub round_id: u64,
    pub stake: u128,
    /// Copied from the round at open, so a claim cannot be repriced by a later listing.
    pub multiplier_bps: u256,
    pub claimed: bool,
    pub exists: bool,
    /// Who may claim it on the public route. Zero for a pool position, where the secret is
    /// the only credential and no address is ever recorded.
    pub owner: ContractAddress,
}

/// Which way the round has to move for a ticket to pay.
#[derive(Drop, Copy, Serde, PartialEq, Debug)]
pub enum Direction {
    /// Settles above the reference.
    Up,
    /// Settles below it.
    Down,
}

pub fn direction_felt(d: Direction) -> felt252 {
    match d {
        Direction::Up => 0,
        Direction::Down => 1,
    }
}

#[starknet::interface]
pub trait IUpDown<T> {
    fn create_round(
        ref self: T,
        pair: felt252,
        cutoff_at: u64,
        round_seconds: u64,
        token: ContractAddress,
        house_edge_bps: u256,
    ) -> u64;
    fn fund_round(ref self: T, round_id: u64, amount: u256);
    fn settle(ref self: T, round_id: u64);

    /// The one entrypoint the STRK20 pool can drive, mirroring `market.cairo`.
    ///
    /// The pool's `InvokeExternal` carries a contract address and calldata and nothing else —
    /// it cannot name an entrypoint — so an anonymizer has to expose exactly one dispatcher at
    /// the pool's fixed selector and branch inside it. Without this the direction game had no
    /// pool route at all: `open_ticket` already zeroes the owner when the caller is the pool,
    /// but the pool had no way to reach it, so every ticket was opened directly and the stake
    /// and the trader were public. Only the side was ever hidden.
    fn privacy_invoke(
        ref self: T,
        operation: u8,
        round_id: u64,
        direction: felt252,
        token: ContractAddress,
        amount: u128,
        secret: felt252,
        note_id: felt252,
    ) -> Span<OpenNoteDeposit>;

    fn open_ticket(
        ref self: T, round_id: u64, commitment: felt252, stake: u256,
    );
    fn claim_ticket(ref self: T, round_id: u64, secret: felt252, direction: felt252);

    fn get_round(self: @T, round_id: u64) -> Round;
    fn get_ticket(self: @T, commitment: felt252) -> Ticket;
    fn round_count(self: @T) -> u64;
    /// The multiplier both sides of a round are sold at. Takes no direction, on purpose.
    fn quote(self: @T, round_id: u64) -> u256;
    fn accounted_for(self: @T, token: ContractAddress) -> u256;
    fn oracle(self: @T) -> ContractAddress;
    fn pool(self: @T) -> ContractAddress;
    fn owner(self: @T) -> ContractAddress;
}

#[starknet::contract]
pub mod UpDownMarket {
    use core::num::traits::Zero;
    use core::poseidon::poseidon_hash_span;
    use starknet::storage::{
        Map, StoragePointerReadAccess, StoragePointerWriteAccess, StorageMapReadAccess,
        StorageMapWriteAccess,
    };
    use starknet::{ContractAddress, get_block_timestamp, get_caller_address, get_contract_address};
    use molfi::objects::{
        DataType, IERC20Dispatcher, IERC20DispatcherTrait, IPragmaOracleDispatcher,
        IPragmaOracleDispatcherTrait, OpenNoteDeposit,
    };
    use molfi::pricing::{BPS, payout_for};
    use super::{Direction, IUpDown, Round, Ticket, direction_felt};

    /// Domain tag, so a direction commitment can never be replayed as a range commitment.
    ///
    /// Both contracts hash `(tag, secret, id, …)` with Poseidon. Without distinct tags a
    /// preimage valid on one would be valid on the other, and a market id collides trivially
    /// across two contracts that both number from one.
    const DIRECTION_TAG: felt252 = 'MOLFI_DIRECTION_V1';

    /// Operations the pool can drive through `privacy_invoke`, matching `market.cairo`.
    const OP_OPEN: u8 = 0;
    const OP_CLAIM: u8 = 1;

    /// Same freshness rules as the range market. A direction settled on a stale print is
    /// wrong in exactly the same way.
    const MAX_PRICE_AGE: u64 = 900;
    const MIN_SOURCES: u32 = 3;
    const MIN_ROUND_SECONDS: u64 = 900;

    /// Below this a ticket cannot be sold: after the edge it would pay less than it cost.
    const MIN_MULTIPLIER_BPS: u256 = 10_001;

    pub mod errors {
        pub const NOT_POOL: felt252 = 'CALLER_NOT_POOL';
        pub const NOT_OWNER: felt252 = 'CALLER_NOT_OWNER';
        pub const NO_ROUND: felt252 = 'NO_SUCH_ROUND';
        pub const ALREADY_SETTLED: felt252 = 'ALREADY_SETTLED';
        pub const NOT_SETTLED: felt252 = 'NOT_SETTLED_YET';
        pub const TOO_EARLY: felt252 = 'BEFORE_CUTOFF';
        pub const CLOSED: felt252 = 'ROUND_CLOSED';
        pub const STALE_PRICE: felt252 = 'STALE_PRICE';
        pub const THIN_PRICE: felt252 = 'TOO_FEW_SOURCES';
        pub const ALREADY_CLAIMED: felt252 = 'ALREADY_CLAIMED';
        pub const NO_TICKET: felt252 = 'NO_SUCH_TICKET';
        pub const DUPLICATE: felt252 = 'TICKET_EXISTS';
        pub const OVER_RESERVED: felt252 = 'ROUND_CANNOT_COVER_PAYOUT';
        pub const ZERO_STAKE: felt252 = 'ZERO_STAKE';
        /// A stake above 2^128. Named rather than left to `unwrap`, which panics with a
        /// generic overflow felt that says nothing about which field was too big.
        pub const STAKE_TOO_LARGE: felt252 = 'STAKE_ABOVE_U128';
        pub const ZERO_FUNDING: felt252 = 'ZERO_FUNDING';
        pub const FUNDING_NOT_RECEIVED: felt252 = 'FUNDING_NOT_RECEIVED';
        pub const STAKE_NOT_RECEIVED: felt252 = 'STAKE_NOT_RECEIVED';
        pub const ROUND_TOO_SHORT: felt252 = 'ROUND_SHORTER_THAN_ORACLE';
        pub const BAD_DIRECTION: felt252 = 'DIRECTION_NOT_0_OR_1';
        pub const UNKNOWN_OP: felt252 = 'UNKNOWN_OPERATION';
        pub const WRONG_TOKEN: felt252 = 'WRONG_TOKEN';
        pub const EDGE_TOO_HIGH: felt252 = 'EDGE_LEAVES_NOTHING';
        pub const NOT_OWNER_OF_TICKET: felt252 = 'NOT_OWNER_OF_TICKET';
        pub const WRONG_ROUTE: felt252 = 'WRONG_ROUTE_FOR_TICKET';
    }

    #[storage]
    struct Storage {
        owner: ContractAddress,
        oracle: ContractAddress,
        pool: ContractAddress,
        round_count: u64,
        rounds: Map<u64, Round>,
        tickets: Map<felt252, Ticket>,
        /// Per-token running total of what the contract is holding for someone else.
        held: Map<ContractAddress, u256>,
    }

    #[event]
    #[derive(Drop, starknet::Event)]
    pub enum Event {
        RoundCreated: RoundCreated,
        RoundFunded: RoundFunded,
        TicketOpened: TicketOpened,
        TicketClaimed: TicketClaimed,
        RoundSettled: RoundSettled,
    }

    #[derive(Drop, starknet::Event)]
    pub struct RoundCreated {
        #[key]
        pub round_id: u64,
        pub pair: felt252,
        pub cutoff_at: u64,
        pub reference_price: u256,
        pub multiplier_bps: u256,
    }

    #[derive(Drop, starknet::Event)]
    pub struct RoundFunded {
        #[key]
        pub round_id: u64,
        pub amount: u256,
    }

    /// Deliberately says nothing but that a ticket exists.
    ///
    /// No direction, no owner, no reference. The stake is here because conservation has to be
    /// checkable from outside — a market that never publishes what went in cannot be shown to
    /// have paid out of it — and it is the one field the pool route already hides, since the
    /// pool is the caller and the amount it withdrew is its own business.
    #[derive(Drop, starknet::Event)]
    pub struct TicketOpened {
        #[key]
        pub round_id: u64,
        #[key]
        pub commitment: felt252,
        pub stake: u256,
    }

    #[derive(Drop, starknet::Event)]
    pub struct TicketClaimed {
        #[key]
        pub round_id: u64,
        #[key]
        pub commitment: felt252,
        pub payout: u256,
    }

    #[derive(Drop, starknet::Event)]
    pub struct RoundSettled {
        #[key]
        pub round_id: u64,
        pub settled_price: u256,
        pub reference_price: u256,
        pub sources: u32,
    }

    #[constructor]
    fn constructor(
        ref self: ContractState,
        owner: ContractAddress,
        oracle: ContractAddress,
        pool: ContractAddress,
    ) {
        self.owner.write(owner);
        self.oracle.write(oracle);
        self.pool.write(pool);
    }

    #[abi(embed_v0)]
    impl UpDownImpl of IUpDown<ContractState> {
        /// List a round, and fix its reference price and its multiplier at the same instant.
        ///
        /// The reference is read from the oracle here rather than accepted as an argument.
        /// An owner-supplied reference would let the house choose a number the market has
        /// already moved away from, which is the whole game decided before it opens.
        fn create_round(
            ref self: ContractState,
            pair: felt252,
            cutoff_at: u64,
            round_seconds: u64,
            token: ContractAddress,
            house_edge_bps: u256,
        ) -> u64 {
            assert(get_caller_address() == self.owner.read(), errors::NOT_OWNER);
            assert(cutoff_at > get_block_timestamp(), errors::CLOSED);
            // A round shorter than the oracle's publish interval settles against a price that
            // was already public when it opened.
            assert(round_seconds >= MIN_ROUND_SECONDS, errors::ROUND_TOO_SHORT);
            // An edge at or above 100% would price the ticket at or below its stake, and the
            // multiplier floor below would reject it anyway — refused here with a name that
            // says which input was wrong.
            assert(house_edge_bps < BPS, errors::EDGE_TOO_HIGH);

            let (price, published_at, sources) = self.fresh_print(pair);

            /// Both sides at one price, and that price is the fair one less the edge.
            ///
            /// Over a horizon this short the move is a martingale to within far less than the
            /// edge: the probability of finishing above where you started is one half, and the
            /// fair multiplier is 1/0.5 = 2. Anything cleverer here would be a forecast, and a
            /// forecast that is wrong in the house's favour is just a bigger edge wearing a
            /// model. So: 2x, less the edge, identically on both sides.
            let multiplier_bps = (2 * BPS * (BPS - house_edge_bps)) / BPS;
            assert(multiplier_bps >= MIN_MULTIPLIER_BPS, errors::EDGE_TOO_HIGH);

            let id = self.round_count.read() + 1;
            self.round_count.write(id);
            self
                .rounds
                .write(
                    id,
                    Round {
                        pair,
                        cutoff_at,
                        round_seconds,
                        token,
                        reference_price: price,
                        reference_at: published_at,
                        reference_sources: sources,
                        house_edge_bps,
                        multiplier_bps,
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
            self
                .emit(
                    RoundCreated {
                        round_id: id, pair, cutoff_at, reference_price: price, multiplier_bps,
                    },
                );
            id
        }

        /// Put house money behind a round. Anyone may; the house is not privileged here.
        fn fund_round(ref self: ContractState, round_id: u64, amount: u256) {
            let mut r = self.round_of(round_id);
            assert(!r.is_settled, errors::ALREADY_SETTLED);
            assert(amount > 0, errors::ZERO_FUNDING);

            let token = IERC20Dispatcher { contract_address: r.token };
            let before = token.balance_of(get_contract_address());
            token.transfer_from(get_caller_address(), get_contract_address(), amount);
            let after = token.balance_of(get_contract_address());
            // Measured, not assumed: a fee-on-transfer token credits less than it was told to
            // send, and a bankroll recorded larger than the balance behind it is an
            // insolvency the contract wrote down itself.
            assert(after - before == amount, errors::FUNDING_NOT_RECEIVED);

            r.bankroll += amount;
            self.rounds.write(round_id, r);
            self.held.write(r.token, self.held.read(r.token) + amount);
            self.emit(RoundFunded { round_id, amount });
        }

        /// Open a ticket against a commitment. The contract never learns the direction.
        fn open_ticket(
            ref self: ContractState, round_id: u64, commitment: felt252, stake: u256,
        ) {
            // The public route pulls the stake itself, then books it. The pool route has the
            // stake delivered by a withdraw action in the same transaction and books the same
            // way — one accounting path, two ways of the money arriving.
            let r = self.round_of(round_id);
            let caller = get_caller_address();
            let token = IERC20Dispatcher { contract_address: r.token };
            let before = token.balance_of(get_contract_address());
            token.transfer_from(caller, get_contract_address(), stake);
            let after = token.balance_of(get_contract_address());
            assert(after - before == stake, errors::STAKE_NOT_RECEIVED);
            self.book_ticket(round_id, commitment, stake, caller);
        }

        /// Reveal the direction and take the payout, if it was the right one.
        /// The pool's one entrypoint, branching on the operation.
        ///
        /// Mirrors `market.cairo` exactly, including the shape of the return: the pool
        /// deserialises the result as `Span<OpenNoteDeposit>` and rejects the call if it is
        /// anything else, so an open returns an **empty** span — the stake parks here until
        /// the round settles and there is nothing to credit back yet.
        fn privacy_invoke(
            ref self: ContractState,
            operation: u8,
            round_id: u64,
            direction: felt252,
            token: ContractAddress,
            amount: u128,
            secret: felt252,
            note_id: felt252,
        ) -> Span<OpenNoteDeposit> {
            assert(get_caller_address() == self.pool.read(), errors::NOT_POOL);

            if operation == OP_OPEN {
                let r = self.round_of(round_id);
                assert(token == r.token, errors::WRONG_TOKEN);
                assert(direction == 0 || direction == 1, errors::BAD_DIRECTION);

                /// The stake is MEASURED, never believed.
                ///
                /// The pool's `InvokeExternalInput` carries a contract address and calldata
                /// and nothing else — no token, no amount — so the tokens arrive by a separate
                /// withdraw action in the same transaction and this contract cannot tell from
                /// the call that they did. Taking `amount` on trust would let anyone who can
                /// reach this record a ticket backed by nothing and claim a payout funded by
                /// the bankroll and by other people's stakes.
                let erc20 = IERC20Dispatcher { contract_address: r.token };
                let stake: u256 = amount.into();
                let delivered = erc20.balance_of(get_contract_address()) - self.held.read(r.token);
                assert(delivered >= stake, errors::STAKE_NOT_RECEIVED);

                let commitment = commitment_of(secret, round_id, direction);
                self.book_ticket(round_id, commitment, stake, get_caller_address());
                array![].span()
            } else if operation == OP_CLAIM {
                let (payout, paid_in) = self
                    .resolve_claim(round_id, secret, direction, get_caller_address());
                assert(token == paid_in, errors::WRONG_TOKEN);

                // A losing claim is still a successful call; it simply credits nothing. The
                // pool accepts an empty span, and the ticket is marked spent either way.
                if payout == 0 {
                    array![].span()
                } else {
                    let amount_u128: u128 = payout.try_into().expect(errors::STAKE_TOO_LARGE);
                    array![OpenNoteDeposit { note_id, token: paid_in, amount: amount_u128 }].span()
                }
            } else {
                core::panic_with_felt252(errors::UNKNOWN_OP)
            }
        }

        /// Reveal the direction and take the payout, if it was the right one.
        fn claim_ticket(ref self: ContractState, round_id: u64, secret: felt252, direction: felt252) {
            self.resolve_claim(round_id, secret, direction, get_caller_address());
        }

        /// Settle a round against a fresh print. Permissionless, like the range market.
        fn settle(ref self: ContractState, round_id: u64) {
            let mut r = self.round_of(round_id);
            assert(!r.is_settled, errors::ALREADY_SETTLED);
            assert(get_block_timestamp() >= r.cutoff_at, errors::TOO_EARLY);

            let (price, published_at, sources) = self.fresh_print(r.pair);

            r.settled_price = price;
            r.settled_at = published_at;
            r.settled_block_at = get_block_timestamp();
            r.settled_sources = sources;
            r.is_settled = true;
            self.rounds.write(round_id, r);

            self
                .emit(
                    RoundSettled {
                        round_id,
                        settled_price: price,
                        reference_price: r.reference_price,
                        sources,
                    },
                );
        }

        fn get_round(self: @ContractState, round_id: u64) -> Round {
            self.rounds.read(round_id)
        }

        fn get_ticket(self: @ContractState, commitment: felt252) -> Ticket {
            self.tickets.read(commitment)
        }

        fn round_count(self: @ContractState) -> u64 {
            self.round_count.read()
        }

        fn quote(self: @ContractState, round_id: u64) -> u256 {
            self.round_of(round_id).multiplier_bps
        }

        fn accounted_for(self: @ContractState, token: ContractAddress) -> u256 {
            self.held.read(token)
        }

        fn oracle(self: @ContractState) -> ContractAddress {
            self.oracle.read()
        }

        fn pool(self: @ContractState) -> ContractAddress {
            self.pool.read()
        }

        fn owner(self: @ContractState) -> ContractAddress {
            self.owner.read()
        }
    }

    #[generate_trait]
    impl Internals of InternalsTrait {
        /// The whole of a claim, returning what it paid and which token it paid in.
        ///
        /// Both routes end here so they cannot resolve a ticket differently. The claimant is
        /// passed in because on the pool route the caller is the pool and the ownership check
        /// has to compare against that, not against whoever the pool is acting for — which
        /// this contract deliberately never learns.
        fn resolve_claim(
            ref self: ContractState,
            round_id: u64,
            secret: felt252,
            direction: felt252,
            claimant: ContractAddress,
        ) -> (u256, ContractAddress) {
            assert(direction == 0 || direction == 1, errors::BAD_DIRECTION);
            let mut r = self.round_of(round_id);
            assert(r.is_settled, errors::NOT_SETTLED);

            let commitment = commitment_of(secret, round_id, direction);
            let mut t = self.tickets.read(commitment);
            // A commitment that does not resolve is indistinguishable from one that was never
            // opened, which is the point: naming a direction you do not hold the secret for
            // finds nothing rather than telling you that you were close.
            assert(t.exists, errors::NO_TICKET);
            assert(t.round_id == round_id, errors::NO_TICKET);
            assert(!t.claimed, errors::ALREADY_CLAIMED);

            if t.owner.is_zero() {
                // Pool route: only the pool may present it, and the secret is the credential.
                assert(claimant == self.pool.read(), errors::WRONG_ROUTE);
            } else {
                assert(t.owner == claimant, errors::NOT_OWNER_OF_TICKET);
            }

            let stake: u256 = t.stake.into();
            let full = payout_for(stake, t.multiplier_bps);

            /// Three outcomes, and the third one is the honest one.
            ///
            /// Above the reference pays Up, below pays Down. Exactly equal pays **the stake
            /// back**, to either side. A tie is not a loss: the round asked which way the
            /// price would move and it did not move, so there is no winner to pay and no
            /// reason to keep the money. Resolving a tie to the house would be a silent extra
            /// edge that appears nowhere in the quoted multiplier.
            let won_up = r.settled_price > r.reference_price;
            let won_down = r.settled_price < r.reference_price;
            let tie = r.settled_price == r.reference_price;

            let payout = if tie {
                stake
            } else if (direction == 0 && won_up) || (direction == 1 && won_down) {
                full
            } else {
                0
            };

            t.claimed = true;
            self.tickets.write(commitment, t);

            // The reservation is released in full either way — it was made against the payout
            // this ticket might have taken, and once claimed it can never take it.
            r.reserved -= full;
            if payout > 0 {
                r.paid += payout;
                self.rounds.write(round_id, r);
                self.held.write(r.token, self.held.read(r.token) - payout);
                let erc20 = IERC20Dispatcher { contract_address: r.token };
                if t.owner.is_zero() {
                    /// Pool route: approve, do not transfer.
                    ///
                    /// The pool pulls the payout itself when it applies the `OpenNoteDeposit`
                    /// this call returns, which is what the anonymizer pattern requires.
                    /// Transferring here instead would move the tokens to the pool's own
                    /// balance without any note being credited — the money would arrive and
                    /// belong to nobody, and the pool's invariant would fail the transaction
                    /// or, worse, not.
                    erc20.approve(self.pool.read(), payout);
                } else {
                    erc20.transfer(claimant, payout);
                }
            } else {
                self.rounds.write(round_id, r);
            }

            /// A losing claim succeeds, and that is deliberate.
            ///
            /// Reverting would be tidier to read and worse in every other way: the ticket
            /// would stay unclaimed for ever, its reservation would never be released, and
            /// the round's capacity would be permanently consumed by positions that already
            /// lost. It would also cost the loser gas to be told something they can read off
            /// the round for free. So the ticket is marked spent, the reservation comes back,
            /// and the payout is zero.
            self.emit(TicketClaimed { round_id, commitment, payout });
            (payout, r.token)
        }

        /// Everything about opening a ticket except how the stake arrived.
        ///
        /// Split out so the public route and the pool route cannot drift. The caller is passed
        /// in rather than read here, because on the pool route `get_caller_address()` inside
        /// this helper is still the pool — which is the answer we want — but on the public
        /// route the dispatcher has already read it, and two reads of the same thing is how
        /// one of them ends up wrong.
        fn book_ticket(
            ref self: ContractState,
            round_id: u64,
            commitment: felt252,
            stake: u256,
            opener: ContractAddress,
        ) {
            let mut r = self.round_of(round_id);
            assert(!r.is_settled, errors::ALREADY_SETTLED);
            assert(get_block_timestamp() < r.cutoff_at, errors::CLOSED);
            assert(stake > 0, errors::ZERO_STAKE);
            assert(!self.tickets.read(commitment).exists, errors::DUPLICATE);

            let payout = payout_for(stake, r.multiplier_bps);

            /// Reserve the whole payout now, not at claim time.
            ///
            /// By claim time the money is committed and refusing is too late — the ticket was
            /// sold at a price the round could not honour and a winner simply does not get
            /// paid.
            assert(
                r.paid + r.reserved + payout <= r.staked + stake + r.bankroll,
                errors::OVER_RESERVED,
            );

            r.staked += stake;
            r.reserved += payout;
            self.rounds.write(round_id, r);
            self.held.write(r.token, self.held.read(r.token) + stake);

            // A ticket opened by the pool has no owner: the pool is the caller and recording
            // it would name the pool on every position, which says nothing, or name the
            // trader, which says everything.
            let owner = if opener == self.pool.read() {
                Zero::zero()
            } else {
                opener
            };

            self
                .tickets
                .write(
                    commitment,
                    Ticket {
                        round_id,
                        stake: stake.try_into().expect(errors::STAKE_TOO_LARGE),
                        multiplier_bps: r.multiplier_bps,
                        claimed: false,
                        exists: true,
                        owner,
                    },
                );
            self.emit(TicketOpened { round_id, commitment, stake });
        }

        fn round_of(self: @ContractState, round_id: u64) -> Round {
            let r = self.rounds.read(round_id);
            // A round that was never listed reads back as zeroes, and a zero round would
            // accept tickets against a zero reference and settle every one of them as a tie.
            assert(r.cutoff_at != 0, errors::NO_ROUND);
            r
        }

        /// A print the contract is willing to act on, or a refusal naming which rule it broke.
        fn fresh_print(self: @ContractState, pair: felt252) -> (u256, u64, u32) {
            let oracle = IPragmaOracleDispatcher { contract_address: self.oracle.read() };
            let p = oracle.get_data_median(DataType::SpotEntry(pair));
            let now = get_block_timestamp();
            // Both directions of the comparison matter: a print from the future is as wrong
            // as one from last week, and subtracting unsigned would wrap.
            let age = if now > p.last_updated_timestamp {
                now - p.last_updated_timestamp
            } else {
                0
            };
            assert(age <= MAX_PRICE_AGE, errors::STALE_PRICE);
            assert(p.num_sources_aggregated >= MIN_SOURCES, errors::THIN_PRICE);
            (p.price.into(), p.last_updated_timestamp, p.num_sources_aggregated)
        }
    }

    /// `poseidon(DIRECTION_TAG, secret, round_id, direction)`.
    ///
    /// Free function rather than a method so the TypeScript kernel can be tested against the
    /// identical input ordering, and so a verifier can recompute a commitment without a
    /// contract instance.
    pub fn commitment_of(secret: felt252, round_id: u64, direction: felt252) -> felt252 {
        let mut data = array![DIRECTION_TAG, secret, round_id.into(), direction];
        poseidon_hash_span(data.span())
    }

    /// The same hash, taken over the typed enum. Kept beside its felt twin so the two can be
    /// asserted equal in tests rather than assumed equal by eye.
    pub fn commitment_of_direction(secret: felt252, round_id: u64, d: Direction) -> felt252 {
        commitment_of(secret, round_id, direction_felt(d))
    }
}
