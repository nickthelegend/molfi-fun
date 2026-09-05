//! The market's behaviour, including every way it must refuse.
//!
//! The refusals matter more than the happy path here. A prediction market that pays the wrong
//! person, pays twice, or settles against a bad price is worse than one that does nothing.

use snforge_std::{
    ContractClassTrait, DeclareResultTrait, declare, start_cheat_block_number_global,
    start_cheat_block_timestamp_global, start_cheat_caller_address, stop_cheat_caller_address,
};
use starknet::ContractAddress;
use molfi::market::{IMolfiMarketDispatcher, IMolfiMarketDispatcherTrait};
use molfi::objects::{IAnonymizerDispatcher, IAnonymizerDispatcherTrait};
use super::mocks::{IStubOracleDispatcher, IStubOracleDispatcherTrait};

const OP_OPEN: u8 = 0;
const OP_CLAIM: u8 = 1;
const NOW: u64 = 1_800_000_000;
const CUTOFF: u64 = 1_000;

fn addr(v: felt252) -> ContractAddress {
    v.try_into().unwrap()
}

fn pool() -> ContractAddress {
    addr('POOL')
}

/// A deployed market plus its stub oracle and token, with the clock already set.
fn setup() -> (IMolfiMarketDispatcher, IAnonymizerDispatcher, IStubOracleDispatcher, ContractAddress) {
    let oracle_class = declare("StubOracle").unwrap().contract_class();
    let (oracle_addr, _) = oracle_class.deploy(@array![]).unwrap();

    let token_class = declare("StubToken").unwrap().contract_class();
    let (token_addr, _) = token_class.deploy(@array![]).unwrap();

    let market_class = declare("MolfiMarket").unwrap().contract_class();
    let (market_addr, _) = market_class
        .deploy(@array![pool().into(), oracle_addr.into(), addr('OWNER').into()])
        .unwrap();

    start_cheat_block_timestamp_global(NOW);
    start_cheat_block_number_global(1);

    (
        IMolfiMarketDispatcher { contract_address: market_addr },
        IAnonymizerDispatcher { contract_address: market_addr },
        IStubOracleDispatcher { contract_address: oracle_addr },
        token_addr,
    )
}

fn a_market(m: IMolfiMarketDispatcher, token: ContractAddress) -> u64 {
    m.create_market('BTC/USD', CUTOFF, token, 100, 1, 300)
}

#[test]
fn a_created_market_starts_unsettled_and_empty() {
    let (m, _, _, token) = setup();
    let id = a_market(m, token);
    let market = m.get_market(id);
    assert(market.pair == 'BTC/USD', 'pair stored');
    assert(!market.is_settled, 'not settled');
    assert(market.staked == 0, 'nothing staked');
    assert(m.market_count() == 1, 'counted');
}

#[test]
fn opening_a_position_credits_nothing_back() {
    // The defining property of a stateful helper: the stake parks here, so the pool is told
    // to credit no notes at all.
    let (m, anon, _, token) = setup();
    let id = a_market(m, token);

    start_cheat_caller_address(m.contract_address, pool());
    let deposits = anon.privacy_invoke(OP_OPEN, id, 'secret', 90_000, 110_000, 0, token, 1_000);
    stop_cheat_caller_address(m.contract_address);

    assert(deposits.len() == 0, 'empty span');
    assert(m.get_market(id).staked == 1_000, 'stake recorded');
}

#[test]
#[should_panic(expected: 'CALLER_NOT_POOL')]
fn nobody_but_the_pool_can_drive_the_helper() {
    let (m, anon, _, token) = setup();
    let id = a_market(m, token);
    start_cheat_caller_address(m.contract_address, addr('ATTACKER'));
    anon.privacy_invoke(OP_OPEN, id, 'secret', 90_000, 110_000, 0, token, 1_000);
}

#[test]
#[should_panic(expected: 'UNKNOWN_OPERATION')]
fn an_unknown_operation_is_refused() {
    let (m, anon, _, token) = setup();
    let id = a_market(m, token);
    start_cheat_caller_address(m.contract_address, pool());
    anon.privacy_invoke(9, id, 'secret', 90_000, 110_000, 0, token, 1_000);
}

#[test]
#[should_panic(expected: 'POSITION_EXISTS')]
fn the_same_commitment_cannot_be_opened_twice() {
    let (m, anon, _, token) = setup();
    let id = a_market(m, token);
    start_cheat_caller_address(m.contract_address, pool());
    anon.privacy_invoke(OP_OPEN, id, 'secret', 90_000, 110_000, 0, token, 1_000);
    anon.privacy_invoke(OP_OPEN, id, 'secret', 90_000, 110_000, 0, token, 1_000);
}

#[test]
#[should_panic(expected: 'BEFORE_CUTOFF')]
fn a_market_cannot_settle_before_its_cutoff() {
    let (m, _, oracle, token) = setup();
    let id = a_market(m, token);
    oracle.set(100_000, NOW, 10);
    m.settle(id);
}

#[test]
#[should_panic(expected: 'STALE_PRICE')]
fn a_stale_print_is_refused() {
    // The failure mode that settles every position against a number that already moved.
    let (m, _, oracle, token) = setup();
    let id = a_market(m, token);
    start_cheat_block_number_global(CUTOFF + 1);
    oracle.set(100_000, NOW - 5_000, 10);
    m.settle(id);
}

#[test]
#[should_panic(expected: 'TOO_FEW_SOURCES')]
fn a_single_source_median_is_refused_even_when_fresh() {
    // Recent and thin. Freshness alone would wave this through, which is exactly how the
    // Sepolia oracle looks today.
    let (m, _, oracle, token) = setup();
    let id = a_market(m, token);
    start_cheat_block_number_global(CUTOFF + 1);
    oracle.set(100_000, NOW, 1);
    m.settle(id);
}

#[test]
fn settling_records_the_price_its_age_and_its_breadth() {
    let (m, _, oracle, token) = setup();
    let id = a_market(m, token);
    start_cheat_block_number_global(CUTOFF + 1);
    oracle.set(100_000, NOW - 60, 11);
    m.settle(id);

    let market = m.get_market(id);
    assert(market.is_settled, 'settled');
    assert(market.settled_price == 100_000, 'price');
    assert(market.settled_at == NOW - 60, 'timestamp kept');
    assert(market.settled_sources == 11, 'sources kept');
}

#[test]
#[should_panic(expected: 'ALREADY_SETTLED')]
fn a_market_settles_once() {
    let (m, _, oracle, token) = setup();
    let id = a_market(m, token);
    start_cheat_block_number_global(CUTOFF + 1);
    oracle.set(100_000, NOW, 10);
    m.settle(id);
    m.settle(id);
}

#[test]
#[should_panic(expected: 'MARKET_CLOSED')]
fn a_position_cannot_open_after_the_cutoff() {
    let (m, anon, _, token) = setup();
    let id = a_market(m, token);
    start_cheat_block_number_global(CUTOFF + 1);
    start_cheat_caller_address(m.contract_address, pool());
    anon.privacy_invoke(OP_OPEN, id, 'late', 90_000, 110_000, 0, token, 1_000);
}

#[test]
#[should_panic(expected: 'NOT_SETTLED_YET')]
fn a_position_cannot_be_claimed_before_settlement() {
    let (m, anon, _, token) = setup();
    let id = a_market(m, token);
    start_cheat_caller_address(m.contract_address, pool());
    anon.privacy_invoke(OP_OPEN, id, 'secret', 90_000, 110_000, 0, token, 1_000);
    anon.privacy_invoke(OP_CLAIM, id, 'secret', 90_000, 110_000, 'note', token, 0);
}

#[test]
fn a_winning_band_is_paid_into_an_open_note() {
    let (m, anon, oracle, token) = setup();
    let id = a_market(m, token);

    start_cheat_caller_address(m.contract_address, pool());
    anon.privacy_invoke(OP_OPEN, id, 'secret', 90_000, 110_000, 0, token, 1_000);
    stop_cheat_caller_address(m.contract_address);

    start_cheat_block_number_global(CUTOFF + 1);
    oracle.set(100_000, NOW, 10);
    m.settle(id);

    start_cheat_caller_address(m.contract_address, pool());
    let deposits = anon.privacy_invoke(OP_CLAIM, id, 'secret', 90_000, 110_000, 'note', token, 0);
    stop_cheat_caller_address(m.contract_address);

    assert(deposits.len() == 1, 'one note credited');
    let d = *deposits.at(0);
    assert(d.note_id == 'note', 'note id');
    assert(d.token == token, 'token');
    assert(d.amount > 0, 'paid something');
}

#[test]
#[should_panic(expected: 'BAND_MISSED')]
fn a_losing_band_pays_nothing() {
    let (m, anon, oracle, token) = setup();
    let id = a_market(m, token);

    start_cheat_caller_address(m.contract_address, pool());
    anon.privacy_invoke(OP_OPEN, id, 'secret', 90_000, 110_000, 0, token, 1_000);
    stop_cheat_caller_address(m.contract_address);

    start_cheat_block_number_global(CUTOFF + 1);
    oracle.set(150_000, NOW, 10);
    m.settle(id);

    start_cheat_caller_address(m.contract_address, pool());
    anon.privacy_invoke(OP_CLAIM, id, 'secret', 90_000, 110_000, 'note', token, 0);
}

#[test]
#[should_panic(expected: 'ALREADY_CLAIMED')]
fn a_position_pays_exactly_once() {
    let (m, anon, oracle, token) = setup();
    let id = a_market(m, token);

    start_cheat_caller_address(m.contract_address, pool());
    anon.privacy_invoke(OP_OPEN, id, 'secret', 90_000, 110_000, 0, token, 1_000);
    stop_cheat_caller_address(m.contract_address);

    start_cheat_block_number_global(CUTOFF + 1);
    oracle.set(100_000, NOW, 10);
    m.settle(id);

    start_cheat_caller_address(m.contract_address, pool());
    anon.privacy_invoke(OP_CLAIM, id, 'secret', 90_000, 110_000, 'note', token, 0);
    anon.privacy_invoke(OP_CLAIM, id, 'secret', 90_000, 110_000, 'note', token, 0);
}

#[test]
#[should_panic(expected: 'NO_SUCH_POSITION')]
fn a_wrong_secret_claims_nothing() {
    // The commitment is recomputed from the preimage, so naming someone else's band without
    // their secret finds no position at all.
    let (m, anon, oracle, token) = setup();
    let id = a_market(m, token);

    start_cheat_caller_address(m.contract_address, pool());
    anon.privacy_invoke(OP_OPEN, id, 'secret', 90_000, 110_000, 0, token, 1_000);
    stop_cheat_caller_address(m.contract_address);

    start_cheat_block_number_global(CUTOFF + 1);
    oracle.set(100_000, NOW, 10);
    m.settle(id);

    start_cheat_caller_address(m.contract_address, pool());
    anon.privacy_invoke(OP_CLAIM, id, 'guess', 90_000, 110_000, 'note', token, 0);
}

#[test]
#[should_panic(expected: 'BAND_NOT_ORDERED')]
fn an_inverted_band_is_refused() {
    let (m, anon, _, token) = setup();
    let id = a_market(m, token);
    start_cheat_caller_address(m.contract_address, pool());
    anon.privacy_invoke(OP_OPEN, id, 'secret', 110_000, 90_000, 0, token, 1_000);
}

#[test]
#[should_panic(expected: 'NO_SUCH_MARKET')]
fn an_unknown_market_is_refused() {
    let (m, anon, _, token) = setup();
    start_cheat_caller_address(m.contract_address, pool());
    anon.privacy_invoke(OP_OPEN, 999, 'secret', 90_000, 110_000, 0, token, 1_000);
}
