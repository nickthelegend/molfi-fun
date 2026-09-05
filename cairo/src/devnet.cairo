//! Test doubles for the two contracts molfi talks to but does not own.
//!
//! **Devnet and tests only. These must never be deployed to a public network.** The real pool
//! is StarkWare's and the real oracle is Pragma's; these exist so the market's own logic can
//! be exercised against controllable inputs — including the failures a live oracle will not
//! produce on demand, like a print that is one publisher wide or an hour old.
//!
//! They live in `src/` rather than `tests/` because a local end-to-end run needs to *deploy*
//! them, and a contract only reachable from the test harness cannot be deployed. The deploy
//! script refuses to put them on anything but a local devnet.

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
    /// What the pool does when it applies an `OpenNoteDeposit`: pull what was approved.
    fn transfer_from(
        ref self: T, sender: ContractAddress, recipient: ContractAddress, amount: u256,
    ) -> bool;
    /// Test-only: put tokens somewhere without a funded account behind it.
    fn mint(ref self: T, to: ContractAddress, amount: u256);
    fn last_approval(self: @T) -> (ContractAddress, u256);
}

#[starknet::contract]
pub mod StubToken {
    use starknet::storage::{
        Map, StorageMapReadAccess, StorageMapWriteAccess, StoragePointerReadAccess,
        StoragePointerWriteAccess,
    };
    use starknet::{ContractAddress, get_caller_address};
    use super::IStubToken;

    #[storage]
    struct Storage {
        approved_spender: ContractAddress,
        approved_amount: u256,
        balances: Map<ContractAddress, u256>,
    }

    #[abi(embed_v0)]
    impl StubTokenImpl of IStubToken<ContractState> {
        fn approve(ref self: ContractState, spender: ContractAddress, amount: u256) -> bool {
            self.approved_spender.write(spender);
            self.approved_amount.write(amount);
            true
        }

        /// A real balance, not a constant.
        ///
        /// It used to return zero, which made the stub useless for the one thing the market
        /// reads a balance for: checking that a market's funding actually arrived. Against a
        /// token that always says zero, that check can only ever fail.
        fn balance_of(self: @ContractState, account: ContractAddress) -> u256 {
            self.balances.read(account)
        }

        fn transfer(ref self: ContractState, recipient: ContractAddress, amount: u256) -> bool {
            let from = get_caller_address();
            let held = self.balances.read(from);
            assert(held >= amount, 'INSUFFICIENT_BALANCE');
            self.balances.write(from, held - amount);
            self.balances.write(recipient, self.balances.read(recipient) + amount);
            true
        }

        /// Approve, then pull — the half of the pattern a stub usually forgets.
        ///
        /// Without it a local run leaves the helper still physically holding every payout it
        /// has approved, so its balance drifts above its own ledger and the next open finds
        /// free money sitting there. That is not what a real pool does, and modelling only
        /// the approve makes the local run quietly easier than production.
        fn transfer_from(
            ref self: ContractState,
            sender: ContractAddress,
            recipient: ContractAddress,
            amount: u256,
        ) -> bool {
            let allowed = self.approved_amount.read();
            assert(self.approved_spender.read() == get_caller_address(), 'NOT_APPROVED_SPENDER');
            assert(allowed >= amount, 'INSUFFICIENT_ALLOWANCE');
            let held = self.balances.read(sender);
            assert(held >= amount, 'INSUFFICIENT_BALANCE');
            self.balances.write(sender, held - amount);
            self.balances.write(recipient, self.balances.read(recipient) + amount);
            self.approved_amount.write(allowed - amount);
            true
        }

        fn mint(ref self: ContractState, to: ContractAddress, amount: u256) {
            self.balances.write(to, self.balances.read(to) + amount);
        }

        /// Lets a test assert the helper approved the pool rather than transferring itself.
        fn last_approval(self: @ContractState) -> (ContractAddress, u256) {
            (self.approved_spender.read(), self.approved_amount.read())
        }
    }
}
