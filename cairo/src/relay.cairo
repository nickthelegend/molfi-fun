//! A price relay, for a testnet whose oracle stopped publishing.
//!
//! ## Why this exists, stated plainly
//!
//! molfi settles against Pragma's aggregated median. On **mainnet** that feed is alive: ten
//! to twelve independent publishers, a new median every few minutes. On **Sepolia** Pragma
//! stopped publishing months ago — BTC's last print is close to a year old — so a market
//! deployed there can be opened and can never resolve. A prediction market that has never
//! resolved a prediction is not a demonstration of anything.
//!
//! This contract republishes **mainnet Pragma's own median** onto Sepolia. It presents the
//! exact `IPragmaOracle` surface, so the market contract cannot tell the difference and needs
//! no special case: the same settlement path runs, the same freshness rule applies, the same
//! publisher count is checked.
//!
//! ## What it is not
//!
//! It is not an oracle. It is a **relay with one publisher — us** — and every value it serves
//! carries the mainnet block it was read at, so anyone can go and check the number against
//! the chain it came from. On mainnet molfi points at Pragma directly and this contract is
//! not deployed at all.
//!
//! Saying that out loud matters more than the code. A testnet stand-in presented as an oracle
//! is the kind of thing that makes every other claim in a submission worth less.

use molfi::objects::{DataType, PragmaPricesResponse};
use starknet::ContractAddress;

/// One relayed price, with everything needed to check it against its source.
#[derive(Drop, Copy, Serde, PartialEq, Debug, starknet::Store)]
pub struct RelayedPrice {
    pub price: u128,
    pub decimals: u32,
    /// The timestamp Pragma itself put on the print. Not when we relayed it.
    pub published_at: u64,
    /// How many publishers stood behind the median on mainnet.
    pub sources: u32,
    /// The mainnet block this was read at, so the source can be re-read.
    pub source_block: u64,
    /// When this contract recorded it.
    pub relayed_at: u64,
}

#[starknet::interface]
pub trait IPriceRelay<T> {
    /// The `IPragmaOracle` surface, so the market contract needs no special case.
    fn get_data_median(self: @T, data_type: DataType) -> PragmaPricesResponse;

    /// Publish one price. Relayer only.
    fn relay(
        ref self: T,
        pair: felt252,
        price: u128,
        decimals: u32,
        published_at: u64,
        sources: u32,
        source_block: u64,
    );

    /// Everything known about the last relay for a pair, for anyone checking our work.
    fn get_relayed(self: @T, pair: felt252) -> RelayedPrice;

    fn relayer(self: @T) -> ContractAddress;
    fn set_relayer(ref self: T, who: ContractAddress);

    /// The mainnet contract this relay mirrors. Published so it can be compared.
    fn mirrors(self: @T) -> ContractAddress;
}

#[starknet::contract]
pub mod PriceRelay {
    use molfi::objects::{DataType, PragmaPricesResponse};
    use starknet::storage::{
        Map, StorageMapReadAccess, StorageMapWriteAccess, StoragePointerReadAccess,
        StoragePointerWriteAccess,
    };
    use starknet::{ContractAddress, get_block_timestamp, get_caller_address};
    use super::{IPriceRelay, RelayedPrice};

    pub mod errors {
        pub const NOT_RELAYER: felt252 = 'CALLER_NOT_RELAYER';
        pub const ZERO_PRICE: felt252 = 'ZERO_PRICE';
        pub const NO_SOURCES: felt252 = 'ZERO_SOURCES';
        pub const GOING_BACKWARDS: felt252 = 'PRINT_OLDER_THAN_STORED';
        pub const NO_PRICE: felt252 = 'NO_PRICE_FOR_PAIR';
    }

    #[storage]
    struct Storage {
        relayer: ContractAddress,
        mirrors: ContractAddress,
        prices: Map<felt252, RelayedPrice>,
    }

    #[event]
    #[derive(Drop, starknet::Event)]
    enum Event {
        Relayed: Relayed,
        RelayerChanged: RelayerChanged,
    }

    /// Emitted for every relay, so the full history is reconstructable from logs alone.
    #[derive(Drop, starknet::Event)]
    struct Relayed {
        #[key]
        pair: felt252,
        price: u128,
        published_at: u64,
        sources: u32,
        source_block: u64,
    }

    #[derive(Drop, starknet::Event)]
    struct RelayerChanged {
        from: ContractAddress,
        to: ContractAddress,
    }

    #[constructor]
    fn constructor(ref self: ContractState, relayer: ContractAddress, mirrors: ContractAddress) {
        self.relayer.write(relayer);
        self.mirrors.write(mirrors);
    }

    #[abi(embed_v0)]
    impl PriceRelayImpl of IPriceRelay<ContractState> {
        /// Serve the relayed price as Pragma would serve its own.
        ///
        /// The timestamp returned is **Pragma's**, not ours. That is deliberate: the market
        /// contract refuses a print older than fifteen minutes, and returning our relay time
        /// would let a stale mainnet price pass a freshness check it should fail. The relay
        /// must not be able to launder age.
        fn get_data_median(self: @ContractState, data_type: DataType) -> PragmaPricesResponse {
            let pair = match data_type {
                DataType::SpotEntry(p) => p,
                DataType::FutureEntry((p, _)) => p,
                DataType::GenericEntry(p) => p,
            };
            let stored = self.prices.read(pair);
            assert(stored.price != 0, errors::NO_PRICE);

            PragmaPricesResponse {
                price: stored.price,
                decimals: stored.decimals,
                last_updated_timestamp: stored.published_at,
                num_sources_aggregated: stored.sources,
                expiration_timestamp: Option::None,
            }
        }

        fn relay(
            ref self: ContractState,
            pair: felt252,
            price: u128,
            decimals: u32,
            published_at: u64,
            sources: u32,
            source_block: u64,
        ) {
            assert(get_caller_address() == self.relayer.read(), errors::NOT_RELAYER);
            assert(price != 0, errors::ZERO_PRICE);
            assert(sources != 0, errors::NO_SOURCES);

            // A relay may not move a pair backwards in time. Without this the relayer could
            // replay an old mainnet print to force a settlement onto a price it had already
            // seen — which is the one power a single-publisher relay must not have.
            let stored = self.prices.read(pair);
            assert(published_at >= stored.published_at, errors::GOING_BACKWARDS);

            self
                .prices
                .write(
                    pair,
                    RelayedPrice {
                        price,
                        decimals,
                        published_at,
                        sources,
                        source_block,
                        relayed_at: get_block_timestamp(),
                    },
                );

            self.emit(Relayed { pair, price, published_at, sources, source_block });
        }

        fn get_relayed(self: @ContractState, pair: felt252) -> RelayedPrice {
            self.prices.read(pair)
        }

        fn relayer(self: @ContractState) -> ContractAddress {
            self.relayer.read()
        }

        fn set_relayer(ref self: ContractState, who: ContractAddress) {
            let from = self.relayer.read();
            assert(get_caller_address() == from, errors::NOT_RELAYER);
            self.relayer.write(who);
            self.emit(RelayerChanged { from, to: who });
        }

        fn mirrors(self: @ContractState) -> ContractAddress {
            self.mirrors.read()
        }
    }
}
