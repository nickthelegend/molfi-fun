//! The market's behaviour, including every way it must refuse.
//!
//! The refusals matter more than the happy path here. A prediction market that pays the wrong
//! person, pays twice, or settles against a bad price is worse than one that does nothing.

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
    anon.privacy_invoke(OP_OPEN, id, 99_829, 100_171, token, 1_000, 'secret', 0);
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
    anon.privacy_invoke(OP_OPEN, id, 99_829, 100_171, token, 1_000, 'late', 0);
}

#[test]
#[should_panic(expected: 'NOT_SETTLED_YET')]
fn a_position_cannot_be_claimed_before_settlement() {
    let (m, anon, _, token) = setup();
    let id = a_market(m, token);
    start_cheat_caller_address(m.contract_address, pool());
    anon.privacy_invoke(OP_OPEN, id, 99_829, 100_171, token, 1_000, 'secret', 0);
    anon.privacy_invoke(OP_CLAIM, id, 99_829, 100_171, token, 0, 'secret', 'note');
}

#[test]
fn a_winning_band_is_paid_into_an_open_note() {
    let (m, anon, oracle, token) = setup();
    let id = a_market(m, token);

    start_cheat_caller_address(m.contract_address, pool());
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
    anon.privacy_invoke(OP_OPEN, id, 110_000, 90_000, token, 1_000, 'secret', 0);
}

#[test]
#[should_panic(expected: 'NO_SUCH_MARKET')]
fn an_unknown_market_is_refused() {
    let (m, anon, _, token) = setup();
    start_cheat_caller_address(m.contract_address, pool());
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
    anon.privacy_invoke(OP_OPEN, id, 99_999, 100_001, token, 1_000, 'tight', 0);
}
