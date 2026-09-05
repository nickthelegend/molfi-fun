//! Test doubles for the two contracts molfi talks to but does not own.
//!
//! Devnet and test only — never deployed. The real pool is StarkWare's and the real oracle is
//! Pragma's; these exist so the market's own logic can be exercised against controllable
//! inputs, including the failures a live oracle will not produce on demand.

use molfi::objects::{DataType, PragmaPricesResponse};
use starknet::ContractAddress;

#[starknet::interface]
pub trait IStubOracle<T> {
    fn set(ref self: T, price: u128, updated_at: u64, sources: u32);
    fn get_data_median(self: @T, data_type: DataType) -> PragmaPricesResponse;
}

#[starknet::contract]
pub mod StubOracle {
    use molfi::objects::{DataType, PragmaPricesResponse};
    use starknet::storage::{StoragePointerReadAccess, StoragePointerWriteAccess};
    use super::IStubOracle;

    #[storage]
    struct Storage {
        price: u128,
        updated_at: u64,
        sources: u32,
    }

    #[abi(embed_v0)]
    impl StubOracleImpl of IStubOracle<ContractState> {
        fn set(ref self: ContractState, price: u128, updated_at: u64, sources: u32) {
            self.price.write(price);
            self.updated_at.write(updated_at);
            self.sources.write(sources);
        }

        fn get_data_median(self: @ContractState, data_type: DataType) -> PragmaPricesResponse {
            PragmaPricesResponse {
                price: self.price.read(),
                decimals: 8,
                last_updated_timestamp: self.updated_at.read(),
                num_sources_aggregated: self.sources.read(),
                expiration_timestamp: Option::None,
            }
        }
    }
}

#[starknet::interface]
pub trait IStubToken<T> {
    fn approve(ref self: T, spender: ContractAddress, amount: u256) -> bool;
    fn balance_of(self: @T, account: ContractAddress) -> u256;
    fn transfer(ref self: T, recipient: ContractAddress, amount: u256) -> bool;
    fn last_approval(self: @T) -> (ContractAddress, u256);
}

#[starknet::contract]
pub mod StubToken {
    use starknet::ContractAddress;
    use starknet::storage::{StoragePointerReadAccess, StoragePointerWriteAccess};
    use super::IStubToken;

    #[storage]
    struct Storage {
        approved_spender: ContractAddress,
        approved_amount: u256,
    }

    #[abi(embed_v0)]
    impl StubTokenImpl of IStubToken<ContractState> {
        fn approve(ref self: ContractState, spender: ContractAddress, amount: u256) -> bool {
            self.approved_spender.write(spender);
            self.approved_amount.write(amount);
            true
        }

        fn balance_of(self: @ContractState, account: ContractAddress) -> u256 {
            0
        }

        fn transfer(ref self: ContractState, recipient: ContractAddress, amount: u256) -> bool {
            true
        }

        /// Lets a test assert the helper approved the pool rather than transferring itself.
        fn last_approval(self: @ContractState) -> (ContractAddress, u256) {
            (self.approved_spender.read(), self.approved_amount.read())
        }
    }
}
