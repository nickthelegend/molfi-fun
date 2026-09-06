//! The market's behaviour, including every way it must refuse.
//!
//! The refusals matter more than the happy path here. A prediction market that pays the wrong
//! person, pays twice, or settles against a bad price is worse than one that does nothing.

use core::num::traits::Zero;
use snforge_std::{
    ContractClassTrait, DeclareResultTrait, declare, start_cheat_block_timestamp_global,
    start_cheat_caller_address, stop_cheat_caller_address,
};
use starknet::ContractAddress;
use molfi::market::{IMolfiMarketDispatcher, IMolfiMarketDispatcherTrait};
use molfi::objects::{IAnonymizerDispatcher, IAnonymizerDispatcherTrait};
use molfi::devnet::{
    IStubOracleDispatcher, IStubOracleDispatcherTrait, IStubTokenDispatcher,
    IStubTokenDispatcherTrait,
};

const OP_OPEN: u8 = 0;
const OP_CLAIM: u8 = 1;
const NOW: u64 = 1_800_000_000;

/// Cutoffs are unix seconds, not block heights: the horizon a table was fitted for is a
/// duration, and Starknet's block cadence is not one.
const CUTOFF: u64 = NOW + 900;

/// One second past the cutoff — the earliest a market may settle.
const AFTER: u64 = CUTOFF + 1;

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
    
    (
        IMolfiMarketDispatcher { contract_address: market_addr },
        IAnonymizerDispatcher { contract_address: market_addr },
        IStubOracleDispatcher { contract_address: oracle_addr },
        token_addr,
    )
}

fn owner() -> ContractAddress {
    addr('OWNER')
}

/// BTC over fifteen minutes, measured on real tape. Used rather than a normal so the tests
/// price with the same shape production does.
fn btc_15m() -> Span<u256> {
    array![
        0, 300_323, 515_844, 666_532, 767_462, 836_637, 881_841, 912_690, 935_108, 950_822,
        962_639, 971_041, 977_620, 982_135, 985_386, 988_415, 990_440,
    ]
        .span()
}

fn a_market(m: IMolfiMarketDispatcher, token: ContractAddress) -> u64 {
    start_cheat_caller_address(m.contract_address, owner());
    let id = m.create_market('BTC/USD', CUTOFF, 900, token, 171_077, 400, btc_15m());
    stop_cheat_caller_address(m.contract_address);
    fund(m, token, id, 1_000_000);
    id
}

/// Send a stake to the market, the way the pool's withdraw leg does.
///
/// Every open needs this now: the contract measures what arrived rather than believing the
/// amount in the calldata, so an open with no tokens behind it is refused. That refusal is
/// the point — without it anyone able to reach `privacy_invoke` could record a position
/// backed by nothing.
fn send_stake(m: IMolfiMarketDispatcher, token: ContractAddress, amount: u256) {
    IStubTokenDispatcher { contract_address: token }.mint(m.contract_address, amount);
}

/// Put the house's money behind a market, the way the deploy script does.
///
/// Every test that opens a position needs this, because a market with no bankroll can sell
/// nothing: the first winner's payout exceeds their own stake by definition, and the market
/// refuses to sell a position it cannot already cover.
fn fund(
    m: IMolfiMarketDispatcher, token: ContractAddress, id: u64, amount: u256,
) {
    let erc20 = IStubTokenDispatcher { contract_address: token };
    erc20.mint(m.contract_address, amount);
    m.fund_market(id, amount);
}

/// Move the clock past the cutoff so the market may settle.
fn after_cutoff() {
    start_cheat_block_timestamp_global(AFTER);
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
    send_stake(m, token, 1_000);
    let deposits = anon.privacy_invoke(OP_OPEN, id, 99_829, 100_171, token, 1_000, 'secret', 0);
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
    send_stake(m, token, 1_000);
    anon.privacy_invoke(OP_OPEN, id, 99_829, 100_171, token, 1_000, 'secret', 0);
}

#[test]
#[should_panic(expected: 'UNKNOWN_OPERATION')]
fn an_unknown_operation_is_refused() {
    let (m, anon, _, token) = setup();
    let id = a_market(m, token);
    start_cheat_caller_address(m.contract_address, pool());
    anon.privacy_invoke(9, id, 99_829, 100_171, token, 1_000, 'secret', 0);
}

#[test]
#[should_panic(expected: 'POSITION_EXISTS')]
fn the_same_commitment_cannot_be_opened_twice() {
    let (m, anon, _, token) = setup();
    let id = a_market(m, token);
    start_cheat_caller_address(m.contract_address, pool());
    send_stake(m, token, 1_000);
    anon.privacy_invoke(OP_OPEN, id, 99_829, 100_171, token, 1_000, 'secret', 0);
    send_stake(m, token, 1_000);
    anon.privacy_invoke(OP_OPEN, id, 99_829, 100_171, token, 1_000, 'secret', 0);
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
    after_cutoff();
    oracle.set(100_000, AFTER - 5_000, 10);
    m.settle(id);
}

#[test]
#[should_panic(expected: 'TOO_FEW_SOURCES')]
fn a_single_source_median_is_refused_even_when_fresh() {
    // Recent and thin. Freshness alone would wave this through, which is exactly how the
    // Sepolia oracle looks today.
    let (m, _, oracle, token) = setup();
    let id = a_market(m, token);
    after_cutoff();
    oracle.set(100_000, AFTER, 1);
    m.settle(id);
}

#[test]
fn settling_records_the_price_its_age_and_its_breadth() {
    let (m, _, oracle, token) = setup();
    let id = a_market(m, token);
    after_cutoff();
    oracle.set(100_000, AFTER - 60, 11);
    m.settle(id);

    let market = m.get_market(id);
    assert(market.is_settled, 'settled');
    assert(market.settled_price == 100_000, 'price');
    assert(market.settled_at == AFTER - 60, 'timestamp kept');
    assert(market.settled_sources == 11, 'sources kept');
}

#[test]
#[should_panic(expected: 'ALREADY_SETTLED')]
fn a_market_settles_once() {
    let (m, _, oracle, token) = setup();
    let id = a_market(m, token);
    after_cutoff();
    oracle.set(100_000, AFTER, 10);
    m.settle(id);
    m.settle(id);
}

#[test]
#[should_panic(expected: 'MARKET_CLOSED')]
fn a_position_cannot_open_after_the_cutoff() {
    let (m, anon, _, token) = setup();
    let id = a_market(m, token);
    after_cutoff();
    start_cheat_caller_address(m.contract_address, pool());
    send_stake(m, token, 1_000);
    anon.privacy_invoke(OP_OPEN, id, 99_829, 100_171, token, 1_000, 'late', 0);
}

#[test]
#[should_panic(expected: 'NOT_SETTLED_YET')]
fn a_position_cannot_be_claimed_before_settlement() {
    let (m, anon, _, token) = setup();
    let id = a_market(m, token);
    start_cheat_caller_address(m.contract_address, pool());
    send_stake(m, token, 1_000);
    anon.privacy_invoke(OP_OPEN, id, 99_829, 100_171, token, 1_000, 'secret', 0);
    anon.privacy_invoke(OP_CLAIM, id, 99_829, 100_171, token, 0, 'secret', 'note');
}

#[test]
fn a_winning_band_is_paid_into_an_open_note() {
    let (m, anon, oracle, token) = setup();
    let id = a_market(m, token);

    start_cheat_caller_address(m.contract_address, pool());
    send_stake(m, token, 1_000);
    anon.privacy_invoke(OP_OPEN, id, 99_829, 100_171, token, 1_000, 'secret', 0);
    stop_cheat_caller_address(m.contract_address);

    after_cutoff();
    oracle.set(100_000, AFTER, 10);
    m.settle(id);

    start_cheat_caller_address(m.contract_address, pool());
    let deposits = anon.privacy_invoke(OP_CLAIM, id, 99_829, 100_171, token, 0, 'secret', 'note');
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
    send_stake(m, token, 1_000);
    anon.privacy_invoke(OP_OPEN, id, 99_829, 100_171, token, 1_000, 'secret', 0);
    stop_cheat_caller_address(m.contract_address);

    after_cutoff();
    oracle.set(150_000, AFTER, 10);
    m.settle(id);

    start_cheat_caller_address(m.contract_address, pool());
    anon.privacy_invoke(OP_CLAIM, id, 99_829, 100_171, token, 0, 'secret', 'note');
}

#[test]
#[should_panic(expected: 'ALREADY_CLAIMED')]
fn a_position_pays_exactly_once() {
    let (m, anon, oracle, token) = setup();
    let id = a_market(m, token);

    start_cheat_caller_address(m.contract_address, pool());
    send_stake(m, token, 1_000);
    anon.privacy_invoke(OP_OPEN, id, 99_829, 100_171, token, 1_000, 'secret', 0);
    stop_cheat_caller_address(m.contract_address);

    after_cutoff();
    oracle.set(100_000, AFTER, 10);
    m.settle(id);

    start_cheat_caller_address(m.contract_address, pool());
    anon.privacy_invoke(OP_CLAIM, id, 99_829, 100_171, token, 0, 'secret', 'note');
    anon.privacy_invoke(OP_CLAIM, id, 99_829, 100_171, token, 0, 'secret', 'note');
}

#[test]
#[should_panic(expected: 'NO_SUCH_POSITION')]
fn a_wrong_secret_claims_nothing() {
    // The commitment is recomputed from the preimage, so naming someone else's band without
    // their secret finds no position at all.
    let (m, anon, oracle, token) = setup();
    let id = a_market(m, token);

    start_cheat_caller_address(m.contract_address, pool());
    send_stake(m, token, 1_000);
    anon.privacy_invoke(OP_OPEN, id, 99_829, 100_171, token, 1_000, 'secret', 0);
    stop_cheat_caller_address(m.contract_address);

    after_cutoff();
    oracle.set(100_000, AFTER, 10);
    m.settle(id);

    start_cheat_caller_address(m.contract_address, pool());
    anon.privacy_invoke(OP_CLAIM, id, 99_829, 100_171, token, 0, 'guess', 'note');
}

#[test]
#[should_panic(expected: 'BAND_NOT_ORDERED')]
fn an_inverted_band_is_refused() {
    let (m, anon, _, token) = setup();
    let id = a_market(m, token);
    start_cheat_caller_address(m.contract_address, pool());
    send_stake(m, token, 1_000);
    anon.privacy_invoke(OP_OPEN, id, 110_000, 90_000, token, 1_000, 'secret', 0);
}

#[test]
#[should_panic(expected: 'NO_SUCH_MARKET')]
fn an_unknown_market_is_refused() {
    let (m, anon, _, token) = setup();
    start_cheat_caller_address(m.contract_address, pool());
    send_stake(m, token, 1_000);
    anon.privacy_invoke(OP_OPEN, 999, 99_829, 100_171, token, 1_000, 'secret', 0);
}

#[test]
#[should_panic(expected: 'CALLER_NOT_OWNER')]
fn a_stranger_cannot_list_a_market() {
    // Not about custody — conservation already caps what any market can pay. It is about the
    // verifier: a market listed with a table of someone's own choosing settles honestly and
    // can still be checked against nothing.
    let (m, _, _, token) = setup();
    start_cheat_caller_address(m.contract_address, addr('STRANGER'));
    m.create_market('BTC/USD', CUTOFF, 900, token, 171_077, 400, btc_15m());
}

#[test]
#[should_panic(expected: 'BAD_TABLE')]
fn a_table_that_is_not_a_cdf_is_refused_at_listing() {
    // One dipped knot is a negative probability over that interval, and it would misprice
    // every band in the market rather than one of them.
    let (m, _, _, token) = setup();
    let mut broken = array![
        0_u256, 300_323, 515_844, 666_532, 767_462, 836_637, 881_841, 912_690, 935_108,
        950_822, 962_639, 971_041, 977_620, 982_135, 985_386, 988_415, 100,
    ];
    start_cheat_caller_address(m.contract_address, owner());
    m.create_market('BTC/USD', CUTOFF, 900, token, 171_077, 400, broken.span());
}

#[test]
#[should_panic(expected: 'MARKET_CLOSED')]
fn a_market_cannot_be_listed_already_expired() {
    let (m, _, _, token) = setup();
    start_cheat_caller_address(m.contract_address, owner());
    m.create_market('BTC/USD', NOW - 1, 900, token, 171_077, 400, btc_15m());
}

#[test]
#[should_panic(expected: 'ZERO_SIGMA')]
fn a_market_with_no_volatility_is_refused() {
    let (m, _, _, token) = setup();
    start_cheat_caller_address(m.contract_address, owner());
    m.create_market('BTC/USD', CUTOFF, 900, token, 0, 400, btc_15m());
}

#[test]
fn a_market_prices_with_its_own_table_not_a_normal() {
    // The bug this exists to catch: the contract quoting from a textbook normal while the
    // desk quotes from measured tape. Over fifteen minutes BTC finishes within a quarter
    // sigma of where it started 30% of the time and a normal says 20%, so the two disagree by
    // half again at the first knot — a gap large enough to be several times the whole fee.
    let (m, _, _, token) = setup();
    let id = a_market(m, token);

    let stored = m.get_table(id);
    assert(*stored.at(1) == 300_323, 'measured knot kept');

    let spot: u256 = 11_000_000_000_000;
    let half: u256 = 11_000_000_000;
    let mine = m.quote_band(id, spot, spot - half, spot + half);

    // The same band under a normal, for contrast. If these ever coincide the table is not
    // being read.
    let normal = molfi::pricing::quote(
        molfi::pricing::normal_table(), spot, spot - half, spot + half, 171_077, 400,
    );
    assert(mine == 16_937, 'quotes from measured tape');
    assert(mine != normal.multiplier_bps, 'not the normal table');
}

#[test]
fn the_commitment_matches_the_one_the_browser_computes() {
    // The single point where the desk and the chain must agree about identity. The browser
    // derives this hash to look a position up; the contract derives it to decide who gets
    // paid. If starknet.js's Poseidon and Cairo's disagreed by one field element, every
    // position would open fine and no position could ever be found again — and nothing
    // short of a real payout would reveal it.
    //
    // Generated by `hash.computePoseidonHashOnElements` in starknet.js over the same span
    // `commitment_of` builds: tag, secret, market id, band low (lo, hi), band high (lo, hi).
    let (m, anon, _, token) = setup();
    let id = a_market(m, token);
    assert(id == 1, 'first market is 1');

    start_cheat_caller_address(m.contract_address, pool());
    send_stake(m, token, 1_000);
    anon.privacy_invoke(OP_OPEN, id, 99_829, 100_171, token, 1_000, 'secret', 0);
    stop_cheat_caller_address(m.contract_address);

    let expected: felt252 = 0x42b3b35b705ba57b3a643f0cda1af6386f77a9534208b3df8e6595e555ec1f6;
    let position = m.get_position(expected);
    assert(position.exists, 'browser commitment agrees');
    assert(position.stake == 1_000, 'and points at the position');
}

#[test]
#[should_panic(expected: 'ROUND_SHORTER_THAN_ORACLE')]
fn a_round_shorter_than_the_oracle_can_settle_is_refused() {
    // The failure the whole horizon choice exists to prevent: a round that closes before
    // Pragma has republished settles against a price that was already public when it
    // opened. Refused at listing rather than discovered at settlement.
    let (m, _, _, token) = setup();
    start_cheat_caller_address(m.contract_address, owner());
    m.create_market('BTC/USD', CUTOFF, 60, token, 171_077, 400, btc_15m());
}

#[test]
fn a_market_records_the_round_it_was_listed_for() {
    // Without this a verifier cannot know which fitted table the market was supposed to
    // carry, and the check that matters most — that the contract prices with the published
    // table — can never run at all.
    let (m, _, _, token) = setup();
    let id = a_market(m, token);
    assert(m.get_market(id).round_seconds == 900, 'round length kept');
}

#[test]
fn settling_records_when_it_settled_not_only_when_the_price_was_published() {
    // The contract asserts the print's age against the settling block. A verifier holding
    // only the publish time and the cutoff cannot repeat that comparison — the print may
    // legitimately have been published after the cutoff and still be fresh at settlement.
    let (m, _, oracle, token) = setup();
    let id = a_market(m, token);
    after_cutoff();
    oracle.set(100_000, AFTER - 60, 11);
    m.settle(id);

    let market = m.get_market(id);
    assert(market.settled_at == AFTER - 60, 'publish time kept');
    assert(market.settled_block_at == AFTER, 'settle time kept');
}

#[test]
#[should_panic(expected: 'MARKET_CANNOT_COVER_PAYOUT')]
fn a_market_will_not_sell_a_position_it_cannot_cover() {
    // The defect this exists to prevent, and it was a real one: with no bankroll the first
    // winner in a market can never be paid, because the only money present is their own
    // stake and any multiplier above 1.00x exceeds it. Discovered at claim time that is a
    // winning band that simply does not pay, after the trader has held it all round.
    // Refused at open instead.
    let (m, anon, _, token) = setup();
    start_cheat_caller_address(m.contract_address, owner());
    let id = m.create_market('BTC/USD', CUTOFF, 900, token, 171_077, 400, btc_15m());
    stop_cheat_caller_address(m.contract_address);

    start_cheat_caller_address(m.contract_address, pool());
    send_stake(m, token, 1_000);
    anon.privacy_invoke(OP_OPEN, id, 99_829, 100_171, token, 1_000, 'secret', 0);
}

#[test]
fn funding_a_market_is_measured_not_taken_on_trust() {
    let (m, _, _, token) = setup();
    start_cheat_caller_address(m.contract_address, owner());
    let id = m.create_market('BTC/USD', CUTOFF, 900, token, 171_077, 400, btc_15m());
    stop_cheat_caller_address(m.contract_address);

    let erc20 = IStubTokenDispatcher { contract_address: token };
    erc20.mint(m.contract_address, 5_000);
    m.fund_market(id, 5_000);

    assert(m.get_market(id).bankroll == 5_000, 'bankroll recorded');
}

#[test]
#[should_panic(expected: 'FUNDING_NOT_RECEIVED')]
fn funding_that_never_arrived_is_refused() {
    // A market that could advertise a bankroll it does not hold is worse than one with no
    // bankroll at all: the number backing every quote would be a claim rather than a fact.
    let (m, _, _, token) = setup();
    start_cheat_caller_address(m.contract_address, owner());
    let id = m.create_market('BTC/USD', CUTOFF, 900, token, 171_077, 400, btc_15m());
    stop_cheat_caller_address(m.contract_address);

    m.fund_market(id, 5_000);
}

#[test]
fn opening_reserves_the_whole_payout() {
    let (m, anon, _, token) = setup();
    let id = a_market(m, token);

    start_cheat_caller_address(m.contract_address, pool());
    send_stake(m, token, 1_000);
    anon.privacy_invoke(OP_OPEN, id, 99_829, 100_171, token, 1_000, 'secret', 0);
    stop_cheat_caller_address(m.contract_address);

    let market = m.get_market(id);
    let position = m.get_position(
        // Same commitment the browser derives; see the parity test above.
        0x42b3b35b705ba57b3a643f0cda1af6386f77a9534208b3df8e6595e555ec1f6,
    );
    let payout = molfi::pricing::payout_for(position.stake.into(), position.multiplier_bps);
    assert(market.reserved == payout, 'full payout reserved');
    assert(market.staked == 1_000, 'stake recorded');
}

#[test]
fn a_claim_releases_the_reservation_it_made() {
    let (m, anon, oracle, token) = setup();
    let id = a_market(m, token);

    start_cheat_caller_address(m.contract_address, pool());
    send_stake(m, token, 1_000);
    anon.privacy_invoke(OP_OPEN, id, 99_829, 100_171, token, 1_000, 'secret', 0);
    stop_cheat_caller_address(m.contract_address);

    after_cutoff();
    oracle.set(100_000, AFTER, 10);
    m.settle(id);

    start_cheat_caller_address(m.contract_address, pool());
    anon.privacy_invoke(OP_CLAIM, id, 99_829, 100_171, token, 0, 'secret', 'note');
    stop_cheat_caller_address(m.contract_address);

    let market = m.get_market(id);
    assert(market.reserved == 0, 'reservation released');
    assert(market.paid > 1_000, 'paid more than the stake');
    assert(market.paid <= market.staked + market.bankroll, 'and stayed solvent');
}

#[test]
#[should_panic(expected: 'BAND_PAYS_LESS_THAN_STAKE')]
fn a_band_that_pays_less_than_it_costs_is_refused() {
    // The desk refuses anything under 1.05x, but a trader does not have to use the desk. A
    // band ten percent wide on a market whose sigma is under two tenths of a percent is
    // certain, and certainty prices below 1.00x after the fee — a position that pays back
    // less than it took even when it wins. Refused by the contract too, whatever client
    // asked for it.
    let (m, anon, _, token) = setup();
    let id = a_market(m, token);
    start_cheat_caller_address(m.contract_address, pool());
    send_stake(m, token, 1_000);
    anon.privacy_invoke(OP_OPEN, id, 90_000, 110_000, token, 1_000, 'wide', 0);
}

#[test]
#[should_panic(expected: 'BAND_TOO_TIGHT_TO_PRICE')]
fn a_band_too_tight_to_price_is_refused() {
    // At the other end the quote is 1/p over a table sampled every quarter sigma, and the
    // arithmetic runs away faster than the measurement behind it supports.
    let (m, anon, _, token) = setup();
    let id = a_market(m, token);
    start_cheat_caller_address(m.contract_address, pool());
    send_stake(m, token, 1_000);
    anon.privacy_invoke(OP_OPEN, id, 99_999, 100_001, token, 1_000, 'tight', 0);
}

#[test]
#[should_panic(expected: 'STAKE_NOT_RECEIVED')]
fn a_position_backed_by_nothing_is_refused() {
    // The vulnerability this closes, and it was real. The pool's `InvokeExternalInput`
    // carries a contract address and calldata and nothing else — no token, no amount — so
    // the stake arrives by a separate withdraw action in the same transaction and this
    // contract cannot tell from the call itself that it did.
    //
    // Trusting the amount in the calldata meant anyone able to reach `privacy_invoke` could
    // record a position backed by nothing and later claim a payout funded by the bankroll
    // and by other people's stakes. Measured now, never believed.
    let (m, anon, _, token) = setup();
    let id = a_market(m, token);

    start_cheat_caller_address(m.contract_address, pool());
    anon.privacy_invoke(OP_OPEN, id, 99_829, 100_171, token, 1_000, 'freeloader', 0);
}

#[test]
#[should_panic(expected: 'STAKE_NOT_RECEIVED')]
fn a_stake_smaller_than_claimed_is_refused() {
    // The subtler version: some tokens arrive, but fewer than the calldata says. Partial
    // credit would be the same hole with a smaller lever.
    let (m, anon, _, token) = setup();
    let id = a_market(m, token);
    send_stake(m, token, 400);

    start_cheat_caller_address(m.contract_address, pool());
    anon.privacy_invoke(OP_OPEN, id, 99_829, 100_171, token, 1_000, 'shortfall', 0);
}

#[test]
#[should_panic(expected: 'WRONG_TOKEN_FOR_MARKET')]
fn a_stake_in_the_wrong_token_is_refused() {
    // Otherwise a market denominated in one token could be opened by delivering another,
    // and the payout would come out of the token the market actually holds.
    let (m, anon, _, token) = setup();
    let id = a_market(m, token);
    send_stake(m, token, 1_000);

    start_cheat_caller_address(m.contract_address, pool());
    anon.privacy_invoke(OP_OPEN, id, 99_829, 100_171, addr('OTHER_TOKEN'), 1_000, 'wrong', 0);
}

#[test]
#[should_panic(expected: 'STAKE_NOT_RECEIVED')]
fn the_bankroll_cannot_be_spent_twice_as_a_stake() {
    // The reason the ledger is a running total rather than a bare balance check: the
    // contract is already holding a million in bankroll, so `balance_of` alone would happily
    // read that as a stake that just arrived — and every position in the market could be
    // opened for free out of the money meant to pay them.
    let (m, anon, _, token) = setup();
    let id = a_market(m, token); // funds 1_000_000 of bankroll

    // No new tokens sent. The contract holds plenty; all of it is already spoken for.
    start_cheat_caller_address(m.contract_address, pool());
    anon.privacy_invoke(OP_OPEN, id, 99_829, 100_171, token, 1_000, 'double-spend', 0);
}

#[test]
fn the_ledger_tracks_what_the_contract_owes() {
    let (m, anon, oracle, token) = setup();
    let id = a_market(m, token);
    assert(m.accounted_for(token) == 1_000_000, 'bankroll booked');

    send_stake(m, token, 1_000);
    start_cheat_caller_address(m.contract_address, pool());
    anon.privacy_invoke(OP_OPEN, id, 99_829, 100_171, token, 1_000, 'secret', 0);
    stop_cheat_caller_address(m.contract_address);
    assert(m.accounted_for(token) == 1_001_000, 'stake booked too');

    after_cutoff();
    oracle.set(100_000, AFTER, 10);
    m.settle(id);

    start_cheat_caller_address(m.contract_address, pool());
    anon.privacy_invoke(OP_CLAIM, id, 99_829, 100_171, token, 0, 'secret', 'note');
    stop_cheat_caller_address(m.contract_address);

    // The payout is approved to the pool, so it is no longer ours to count.
    let market = m.get_market(id);
    assert(m.accounted_for(token) == 1_001_000 - market.paid, 'payout released');
}

#[test]
fn the_oracle_can_be_repointed_by_the_owner() {
    // Pragma stopped publishing to Sepolia, so a testnet deployment has to be repointed at
    // a relay to settle at all. Without this the only option is a fresh deployment, which
    // throws away the history that makes a deployment worth looking at.
    let (m, _, _, _) = setup();
    let before = m.oracle();
    start_cheat_caller_address(m.contract_address, owner());
    m.set_oracle(addr('RELAY'));
    stop_cheat_caller_address(m.contract_address);
    assert(m.oracle() == addr('RELAY'), 'oracle repointed');
    assert(before != addr('RELAY'), 'and it actually changed');
}

#[test]
#[should_panic(expected: 'CALLER_NOT_OWNER')]
fn a_stranger_cannot_repoint_the_oracle() {
    let (m, _, _, _) = setup();
    start_cheat_caller_address(m.contract_address, addr('STRANGER'));
    m.set_oracle(addr('EVIL'));
}

#[test]
fn repointing_the_oracle_cannot_rewrite_a_settled_market() {
    // The bound that makes the power safe: `settle` writes the price into storage and never
    // reads the oracle again, so a later repoint can change how future markets resolve and
    // can never change one that already has.
    let (m, _, oracle, token) = setup();
    let id = a_market(m, token);
    after_cutoff();
    oracle.set(100_000, AFTER, 10);
    m.settle(id);
    let settled = m.get_market(id).settled_price;

    start_cheat_caller_address(m.contract_address, owner());
    m.set_oracle(addr('SOMEWHERE_ELSE'));
    stop_cheat_caller_address(m.contract_address);

    assert(m.get_market(id).settled_price == settled, 'settled price is immutable');
}

// ── The public trading route ──────────────────────────────────────────────────────────
//
// The pool route hides who, how much, and what. This one hides only what — and it is the
// route a trader with an ordinary wallet can use, which until it existed meant nobody could
// take a position at all. The tests below are mostly about the two things that route has to
// get right and the pool route never has to: the band is never sent, so the price has to be
// bound to it some other way; and a public address is on the transaction, so the payout has
// to go back to that address and to nobody else.

/// The reach of a band, computed the way the client does before it sends anything.
fn offsets(low: u256, high: u256) -> (u256, u256) {
    molfi::pricing::offsets_of((low + high) / 2, low, high)
}

fn commitment(secret: felt252, id: u64, low: u256, high: u256) -> felt252 {
    core::poseidon::poseidon_hash_span(
        array![
            'MOLFI_POSITION_V1', secret, id.into(), low.low.into(), low.high.into(),
            high.low.into(), high.high.into(),
        ]
            .span(),
    )
}

/// Give a trader tokens and let the market pull them, the way a wallet's approve does.
fn funded_trader(
    m: IMolfiMarketDispatcher, token: ContractAddress, who: ContractAddress, amount: u256,
) {
    let erc20 = IStubTokenDispatcher { contract_address: token };
    erc20.mint(who, amount);
    start_cheat_caller_address(token, who);
    erc20.approve(m.contract_address, amount);
    stop_cheat_caller_address(token);
}

#[test]
fn a_trader_can_open_a_position_without_naming_the_band() {
    let (m, _, _, token) = setup();
    let id = a_market(m, token);
    let trader = addr('TRADER');
    funded_trader(m, token, trader, 1_000);

    let (low_off, high_off) = offsets(99_829, 100_171);
    start_cheat_caller_address(m.contract_address, trader);
    m.open_position(id, commitment('s', id, 99_829, 100_171), low_off, high_off, 1_000);
    stop_cheat_caller_address(m.contract_address);

    assert(m.get_market(id).staked == 1_000, 'stake recorded');
    let p = m.get_position(commitment('s', id, 99_829, 100_171));
    assert(p.exists, 'position exists');
    assert(p.owner == trader, 'bound to the trader');
    assert(p.stake == 1_000, 'stake stored');
    // What is on chain is the reach, not the band. Nothing here says 99_829.
    assert(p.low_off_1e8 == low_off, 'reach stored');
    assert(p.multiplier_bps > 10_000, 'priced above par');
}

#[test]
fn the_public_route_charges_what_the_pool_route_charges() {
    // Two positions, same band, one bought through each route. A trader should not be able
    // to get a better price by choosing how private to be, in either direction.
    let (m, anon, _, token) = setup();
    let id = a_market(m, token);
    let trader = addr('TRADER');
    funded_trader(m, token, trader, 1_000);

    let (low_off, high_off) = offsets(99_829, 100_171);
    start_cheat_caller_address(m.contract_address, trader);
    m.open_position(id, commitment('public', id, 99_829, 100_171), low_off, high_off, 1_000);
    stop_cheat_caller_address(m.contract_address);

    start_cheat_caller_address(m.contract_address, pool());
    send_stake(m, token, 1_000);
    anon.privacy_invoke(OP_OPEN, id, 99_829, 100_171, token, 1_000, 'private', 0);
    stop_cheat_caller_address(m.contract_address);

    let a = m.get_position(commitment('public', id, 99_829, 100_171));
    let b = m.get_position(commitment('private', id, 99_829, 100_171));
    assert(a.multiplier_bps == b.multiplier_bps, 'same price both routes');
    assert(a.low_off_1e8 == b.low_off_1e8, 'same reach both routes');
    assert(b.owner.is_zero(), 'pool position has no owner');
}

#[test]
fn a_winning_public_position_pays_the_trader_directly() {
    let (m, _, oracle, token) = setup();
    let id = a_market(m, token);
    let trader = addr('TRADER');
    funded_trader(m, token, trader, 1_000);

    let (low_off, high_off) = offsets(99_829, 100_171);
    start_cheat_caller_address(m.contract_address, trader);
    m.open_position(id, commitment('s', id, 99_829, 100_171), low_off, high_off, 1_000);
    stop_cheat_caller_address(m.contract_address);

    let multiplier = m.get_position(commitment('s', id, 99_829, 100_171)).multiplier_bps;

    after_cutoff();
    oracle.set(100_000, AFTER, 10);
    m.settle(id);

    let erc20 = IStubTokenDispatcher { contract_address: token };
    let before = erc20.balance_of(trader);
    start_cheat_caller_address(m.contract_address, trader);
    m.claim_position(id, 's', 99_829, 100_171);
    stop_cheat_caller_address(m.contract_address);

    let expected = (1_000_u256 * multiplier) / 10_000;
    assert(erc20.balance_of(trader) == before + expected, 'paid the trader');
    assert(m.get_market(id).paid == expected, 'payout booked');
}

#[test]
#[should_panic(expected: 'NOT_YOUR_POSITION')]
fn a_stranger_who_learns_the_secret_cannot_take_the_payout() {
    // The secret is public the instant the owner's own claim is in a block, and on a public
    // route it is also guessable ahead of one. The address the position was opened from is
    // what actually gates the money.
    let (m, _, oracle, token) = setup();
    let id = a_market(m, token);
    let trader = addr('TRADER');
    funded_trader(m, token, trader, 1_000);

    let (low_off, high_off) = offsets(99_829, 100_171);
    start_cheat_caller_address(m.contract_address, trader);
    m.open_position(id, commitment('s', id, 99_829, 100_171), low_off, high_off, 1_000);
    stop_cheat_caller_address(m.contract_address);

    after_cutoff();
    oracle.set(100_000, AFTER, 10);
    m.settle(id);

    start_cheat_caller_address(m.contract_address, addr('THIEF'));
    m.claim_position(id, 's', 99_829, 100_171);
}

#[test]
#[should_panic(expected: 'BAND_DOES_NOT_MATCH_PRICE')]
fn a_cheap_wide_band_cannot_be_claimed_as_an_expensive_narrow_one() {
    // The attack the reach check exists for. Buy the widest band in the market for almost
    // nothing, then at claim time reveal a band one tick wide around the settled price and
    // ask to be paid at the narrow band's multiplier. The commitment binds the band, and the
    // reach recomputed from it has to be the reach that was paid for.
    let (m, _, oracle, token) = setup();
    let id = a_market(m, token);
    let trader = addr('TRADER');
    funded_trader(m, token, trader, 1_000);

    let (wide_low, wide_high) = offsets(99_700, 100_300);
    start_cheat_caller_address(m.contract_address, trader);
    m.open_position(id, commitment('s', id, 99_990, 100_010), wide_low, wide_high, 1_000);
    stop_cheat_caller_address(m.contract_address);

    after_cutoff();
    oracle.set(100_000, AFTER, 10);
    m.settle(id);

    start_cheat_caller_address(m.contract_address, trader);
    m.claim_position(id, 's', 99_990, 100_010);
}

#[test]
#[should_panic(expected: 'BAND_MISSED')]
fn a_losing_public_band_pays_nothing() {
    let (m, _, oracle, token) = setup();
    let id = a_market(m, token);
    let trader = addr('TRADER');
    funded_trader(m, token, trader, 1_000);

    let (low_off, high_off) = offsets(99_829, 100_171);
    start_cheat_caller_address(m.contract_address, trader);
    m.open_position(id, commitment('s', id, 99_829, 100_171), low_off, high_off, 1_000);
    stop_cheat_caller_address(m.contract_address);

    after_cutoff();
    oracle.set(101_000, AFTER, 10);
    m.settle(id);

    start_cheat_caller_address(m.contract_address, trader);
    m.claim_position(id, 's', 99_829, 100_171);
}

#[test]
#[should_panic(expected: 'ALREADY_CLAIMED')]
fn a_public_position_pays_exactly_once() {
    let (m, _, oracle, token) = setup();
    let id = a_market(m, token);
    let trader = addr('TRADER');
    funded_trader(m, token, trader, 1_000);

    let (low_off, high_off) = offsets(99_829, 100_171);
    start_cheat_caller_address(m.contract_address, trader);
    m.open_position(id, commitment('s', id, 99_829, 100_171), low_off, high_off, 1_000);
    stop_cheat_caller_address(m.contract_address);

    after_cutoff();
    oracle.set(100_000, AFTER, 10);
    m.settle(id);

    start_cheat_caller_address(m.contract_address, trader);
    m.claim_position(id, 's', 99_829, 100_171);
    m.claim_position(id, 's', 99_829, 100_171);
}

#[test]
#[should_panic(expected: 'WRONG_CLAIM_ROUTE')]
fn a_public_position_cannot_be_drained_through_the_pool() {
    // Otherwise the owner check is decoration: anyone holding the secret could ask the pool
    // to claim a public position into a note of their own.
    let (m, anon, oracle, token) = setup();
    let id = a_market(m, token);
    let trader = addr('TRADER');
    funded_trader(m, token, trader, 1_000);

    let (low_off, high_off) = offsets(99_829, 100_171);
    start_cheat_caller_address(m.contract_address, trader);
    m.open_position(id, commitment('s', id, 99_829, 100_171), low_off, high_off, 1_000);
    stop_cheat_caller_address(m.contract_address);

    after_cutoff();
    oracle.set(100_000, AFTER, 10);
    m.settle(id);

    start_cheat_caller_address(m.contract_address, pool());
    anon.privacy_invoke(OP_CLAIM, id, 99_829, 100_171, token, 0, 's', 'note');
}

#[test]
#[should_panic(expected: 'WRONG_CLAIM_ROUTE')]
fn a_pool_position_cannot_be_claimed_from_an_address() {
    // The mirror image. A position opened privately has no owner, so `claim_position` would
    // otherwise pay whoever called it first.
    let (m, anon, oracle, token) = setup();
    let id = a_market(m, token);

    start_cheat_caller_address(m.contract_address, pool());
    send_stake(m, token, 1_000);
    anon.privacy_invoke(OP_OPEN, id, 99_829, 100_171, token, 1_000, 's', 0);
    stop_cheat_caller_address(m.contract_address);

    after_cutoff();
    oracle.set(100_000, AFTER, 10);
    m.settle(id);

    start_cheat_caller_address(m.contract_address, addr('ANYONE'));
    m.claim_position(id, 's', 99_829, 100_171);
}

#[test]
#[should_panic(expected: 'MARKET_CLOSED')]
fn a_public_position_cannot_open_after_the_cutoff() {
    let (m, _, _, token) = setup();
    let id = a_market(m, token);
    let trader = addr('TRADER');
    funded_trader(m, token, trader, 1_000);
    after_cutoff();

    let (low_off, high_off) = offsets(99_829, 100_171);
    start_cheat_caller_address(m.contract_address, trader);
    m.open_position(id, commitment('s', id, 99_829, 100_171), low_off, high_off, 1_000);
}

#[test]
#[should_panic(expected: 'BAND_PAYS_LESS_THAN_STAKE')]
fn a_reach_wide_enough_to_pay_par_is_refused_on_the_public_route_too() {
    // The reach arrives as a bare number on this route rather than being derived from a
    // band, so nothing stops a caller sending one that is nonsense. The multiplier bounds
    // are what catch it, and they are the same bounds both routes go through.
    let (m, _, _, token) = setup();
    let id = a_market(m, token);
    let trader = addr('TRADER');
    funded_trader(m, token, trader, 1_000);

    start_cheat_caller_address(m.contract_address, trader);
    m.open_position(id, commitment('s', id, 1, 2), 50_000_000, 50_000_000, 1_000);
}

#[test]
fn a_public_open_reserves_the_payout_like_any_other() {
    let (m, _, _, token) = setup();
    let id = a_market(m, token);
    let trader = addr('TRADER');
    funded_trader(m, token, trader, 1_000);

    let (low_off, high_off) = offsets(99_829, 100_171);
    start_cheat_caller_address(m.contract_address, trader);
    m.open_position(id, commitment('s', id, 99_829, 100_171), low_off, high_off, 1_000);
    stop_cheat_caller_address(m.contract_address);

    let p = m.get_position(commitment('s', id, 99_829, 100_171));
    let expected = (1_000_u256 * p.multiplier_bps) / 10_000;
    assert(m.get_market(id).reserved == expected, 'whole payout reserved');
}

#[test]
fn quote_offsets_is_the_price_the_position_is_actually_sold_at() {
    // The trader has to be able to read the price of the exact thing they are buying. On
    // this route that thing is a pair of ratios, not a band, so `quote_band` alone would
    // leave them checking a different question than the one the contract answers.
    let (m, _, _, token) = setup();
    let id = a_market(m, token);
    let trader = addr('TRADER');
    funded_trader(m, token, trader, 1_000);

    let (low_off, high_off) = offsets(99_829, 100_171);
    let quoted = m.quote_offsets(id, low_off, high_off);

    start_cheat_caller_address(m.contract_address, trader);
    m.open_position(id, commitment('s', id, 99_829, 100_171), low_off, high_off, 1_000);
    stop_cheat_caller_address(m.contract_address);

    assert(m.get_position(commitment('s', id, 99_829, 100_171)).multiplier_bps == quoted, 'quoted == charged');
    assert(m.quote_band(id, 100_000, 99_829, 100_171) == quoted, 'both views agree');
}

// ---------------------------------------------------------------- shared pricing tables
//
// The keeper relists the same three tables — one per pair and round length — indefinitely,
// and each listing used to write all seventeen `u256` knots again. These pin the dedup that
// stopped that, and the property that makes it safe: a market's table is decided when it is
// listed and cannot be changed afterwards by anything a later listing does.

/// ETH over fifteen minutes. A genuinely different shape from BTC's, so a test that mixes
/// them cannot pass by accident.
fn eth_15m() -> Span<u256> {
    array![
        0, 271_882, 470_512, 612_318, 710_662, 779_180, 826_314, 858_795, 881_216, 896_712,
        907_500, 915_066, 920_460, 924_368, 927_249, 929_432, 931_130,
    ]
        .span()
}

#[test]
fn two_markets_on_the_same_table_read_back_the_same_knots() {
    let (m, _, _, token) = setup();
    start_cheat_caller_address(m.contract_address, owner());
    let first = m.create_market('BTC/USD', CUTOFF, 900, token, 171_077, 400, btc_15m());
    let second = m.create_market('BTC/USD', CUTOFF, 900, token, 171_077, 400, btc_15m());
    stop_cheat_caller_address(m.contract_address);

    // The second market stores a pointer rather than the knots, so the read has to follow it.
    assert(m.get_table(second) == btc_15m(), 'shared table reads wrong');
    assert(m.get_table(first) == m.get_table(second), 'tables disagree');
}

#[test]
fn a_shared_table_prices_identically() {
    let (m, _, _, token) = setup();
    start_cheat_caller_address(m.contract_address, owner());
    let first = m.create_market('BTC/USD', CUTOFF, 900, token, 171_077, 400, btc_15m());
    let second = m.create_market('BTC/USD', CUTOFF, 900, token, 171_077, 400, btc_15m());
    stop_cheat_caller_address(m.contract_address);

    // Pointing at another market's knots must be invisible to the thing that matters.
    let spot: u256 = 8_000_000_000_000;
    let low = spot - spot * 171_077 / 100_000_000;
    let high = spot + spot * 171_077 / 100_000_000;
    assert(
        m.quote_band(first, spot, low, high) == m.quote_band(second, spot, low, high),
        'shared table misprices',
    );
}

#[test]
fn a_different_table_is_stored_separately() {
    let (m, _, _, token) = setup();
    start_cheat_caller_address(m.contract_address, owner());
    let btc = m.create_market('BTC/USD', CUTOFF, 900, token, 171_077, 400, btc_15m());
    let eth = m.create_market('ETH/USD', CUTOFF, 900, token, 227_000, 400, eth_15m());
    stop_cheat_caller_address(m.contract_address);

    assert(m.get_table(btc) == btc_15m(), 'btc table clobbered');
    assert(m.get_table(eth) == eth_15m(), 'eth table clobbered');
    assert(m.get_table(btc) != m.get_table(eth), 'two tables collapsed into one');
}

#[test]
fn a_later_listing_cannot_change_an_earlier_market_s_table() {
    let (m, _, _, token) = setup();
    start_cheat_caller_address(m.contract_address, owner());
    let first = m.create_market('BTC/USD', CUTOFF, 900, token, 171_077, 400, btc_15m());

    // The same pair and the same round length, recalibrated. Keying storage on those two
    // would have quietly repriced the market above; content-addressing gives this its own.
    let recalibrated = m
        .create_market('BTC/USD', CUTOFF, 900, token, 171_077, 400, eth_15m());
    stop_cheat_caller_address(m.contract_address);

    assert(m.get_table(first) == btc_15m(), 'earlier market repriced');
    assert(m.get_table(recalibrated) == eth_15m(), 'recalibration lost');
}

#[test]
fn a_settled_market_still_audits_against_its_own_table() {
    let (m, _, oracle, token) = setup();
    start_cheat_caller_address(m.contract_address, owner());
    let settled = m.create_market('BTC/USD', CUTOFF, 900, token, 171_077, 400, btc_15m());
    stop_cheat_caller_address(m.contract_address);
    fund(m, token, settled, 1_000_000);

    let spot: u256 = 8_000_000_000_000;
    let low = spot - spot * 171_077 / 100_000_000;
    let high = spot + spot * 171_077 / 100_000_000;
    let before = m.quote_band(settled, spot, low, high);

    oracle.set(7_970_000_000_000, CUTOFF, 11);
    start_cheat_block_timestamp_global(CUTOFF + 1);
    m.settle(settled);

    // Anything listed after settlement, with any table, must leave the recomputation alone.
    start_cheat_caller_address(m.contract_address, owner());
    m.create_market('BTC/USD', CUTOFF + 10_000, 900, token, 171_077, 400, eth_15m());
    stop_cheat_caller_address(m.contract_address);

    assert(m.quote_band(settled, spot, low, high) == before, 'settled market repriced');
}

// The two below are a matched pair, run for the difference between their reported costs.
//
// They do the same work except that one lists a table the contract already holds and the
// other lists a new one, so the gap is exactly what storing a table costs. Measured with
// `snforge test bench_second`:
//
//     reuses a table   l2_gas ~2,993,126   l1_data_gas ~3,552
//     writes a new one l2_gas ~3,600,276   l1_data_gas ~5,088
//     saved per repeat listing      607,150            1,536
//
// The l1_data_gas half is the one that does not depend on a gas model: it is thirty-four
// storage slots of state diff that no longer reach L1. Each still asserts the invariant that
// makes the comparison meaningful — two markets listed, each priceable — so neither can
// silently stop measuring what it claims to.

#[test]
fn bench_second_listing_reuses_a_table() {
    let (m, _, _, token) = setup();
    start_cheat_caller_address(m.contract_address, owner());
    let a = m.create_market('BTC/USD', CUTOFF, 900, token, 171_077, 400, btc_15m());
    let b = m.create_market('BTC/USD', CUTOFF, 900, token, 171_077, 400, btc_15m());
    stop_cheat_caller_address(m.contract_address);
    assert(b == a + 1, 'two markets not listed');
    assert(m.get_table(b) == btc_15m(), 'reused table unreadable');
}

#[test]
fn bench_second_listing_writes_a_new_table() {
    let (m, _, _, token) = setup();
    start_cheat_caller_address(m.contract_address, owner());
    let a = m.create_market('BTC/USD', CUTOFF, 900, token, 171_077, 400, btc_15m());
    let b = m.create_market('ETH/USD', CUTOFF, 900, token, 227_000, 400, eth_15m());
    stop_cheat_caller_address(m.contract_address);
    assert(b == a + 1, 'two markets not listed');
    assert(m.get_table(b) == eth_15m(), 'new table unreadable');
}
