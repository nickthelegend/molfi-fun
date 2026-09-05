//! The pool's own types.
//!
//! Reproduced rather than imported. The `privacy` package is not published to a registry
//! Scarb can resolve, so a helper that wants to speak to the pool has to declare the shape
//! itself. The layout is fixed by the pool's deserialiser, so this file is a transcription
//! and not a design: change a field order here and the pool rejects every return value.
//!
//! Source: starkware-libs/starknet-privacy, packages/privacy/src/objects.cairo (Apache-2.0).

use starknet::ContractAddress;

/// An instruction telling the pool which open note to credit, with what, and how much.
///
/// The amount is public — it was measured on chain, so it could not have been fixed at proof
/// time — but the note's owner is not. That asymmetry is the whole point of an open note.
#[derive(Drop, Copy, Serde, PartialEq, Debug, starknet::Store)]
pub struct OpenNoteDeposit {
    /// The identifier of the open note to deposit to.
    pub note_id: felt252,
    /// The ERC20 token contract to deposit.
    pub token: ContractAddress,
    /// The amount of tokens to deposit.
    pub amount: u128,
}

/// The entry point the pool calls on every anonymizer, via its INVOKE_SELECTOR.
///
/// Calldata after the selector is deserialised into the parameters; the return value is
/// deserialised as `Span<OpenNoteDeposit>`. Returning anything else, or trailing anything
/// after it, makes the pool reject the call.
#[starknet::interface]
pub trait IAnonymizer<T> {
    fn privacy_invoke(
        ref self: T,
        operation: u8,
        market_id: u64,
        band_low: u256,
        band_high: u256,
        token: ContractAddress,
        amount: u128,
        secret: felt252,
        note_id: felt252,
    ) -> Span<OpenNoteDeposit>;
}

/// The slice of ERC-20 a helper needs: approve on the way out, balance to measure the delta.
#[starknet::interface]
pub trait IERC20<T> {
    fn approve(ref self: T, spender: ContractAddress, amount: u256) -> bool;
    fn balance_of(self: @T, account: ContractAddress) -> u256;
    fn transfer(ref self: T, recipient: ContractAddress, amount: u256) -> bool;
}

/// What Pragma's `get_data_median` answers with, in declaration order.
#[derive(Drop, Copy, Serde, PartialEq, Debug)]
pub struct PragmaPricesResponse {
    pub price: u128,
    pub decimals: u32,
    pub last_updated_timestamp: u64,
    pub num_sources_aggregated: u32,
    pub expiration_timestamp: Option<u64>,
}

/// Pragma keys a spot feed by the pair label read as a short string.
#[derive(Drop, Copy, Serde)]
pub enum DataType {
    SpotEntry: felt252,
    FutureEntry: (felt252, u64),
    GenericEntry: felt252,
}

#[starknet::interface]
pub trait IPragmaOracle<T> {
    fn get_data_median(self: @T, data_type: DataType) -> PragmaPricesResponse;
}
