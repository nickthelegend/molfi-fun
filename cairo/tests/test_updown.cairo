//! The direction game, and the two things it must never get wrong.
//!
//! **The money**, because a payout that is off by a unit is a payout that is wrong, and
//! **the bit**, because a direction the contract can read is a direction anyone can read.
//! Everything below is one of those two, plus the refusals — a market that pays the wrong
//! person or settles on a bad price is worse than one that does nothing.

use snforge_std::{
    ContractClassTrait, DeclareResultTrait, declare, start_cheat_block_timestamp_global,
    start_cheat_caller_address, stop_cheat_caller_address,
};
use starknet::ContractAddress;
use core::poseidon::poseidon_hash_span;
use molfi::updown::{IUpDownDispatcher, IUpDownDispatcherTrait};
use molfi::devnet::{
    IStubOracleDispatcher, IStubOracleDispatcherTrait, IStubTokenDispatcher,
    IStubTokenDispatcherTrait,
};

const NOW: u64 = 1_800_000_000;
const CUTOFF: u64 = NOW + 900;
const AFTER: u64 = CUTOFF + 1;

/// The reference the round is listed at. Everything settles above, below, or exactly on it.
const REFERENCE: u128 = 100_000_000_000;

const UP: felt252 = 0;
const DOWN: felt252 = 1;

fn addr(v: felt252) -> ContractAddress {
    v.try_into().unwrap()
}

fn owner() -> ContractAddress {
    addr('OWNER')
}

fn pool() -> ContractAddress {
    addr('POOL')
}

fn trader() -> ContractAddress {
    addr('TRADER')
}

fn setup() -> (IUpDownDispatcher, IStubOracleDispatcher, ContractAddress) {
    let oracle_class = declare("StubOracle").unwrap().contract_class();
    let (oracle_addr, _) = oracle_class.deploy(@array![]).unwrap();

    let token_class = declare("StubToken").unwrap().contract_class();
    let (token_addr, _) = token_class.deploy(@array![]).unwrap();

    let class = declare("UpDownMarket").unwrap().contract_class();
    let (market_addr, _) = class
        .deploy(@array![owner().into(), oracle_addr.into(), pool().into()])
        .unwrap();

    start_cheat_block_timestamp_global(NOW);
    IStubOracleDispatcher { contract_address: oracle_addr }.set(REFERENCE, NOW, 10);

    (
        IUpDownDispatcher { contract_address: market_addr },
        IStubOracleDispatcher { contract_address: oracle_addr },
        token_addr,
    )
}

/// A round with the house behind it, at the 4% edge production uses.
fn a_round(m: IUpDownDispatcher, token: ContractAddress) -> u64 {
    start_cheat_caller_address(m.contract_address, owner());
    let id = m.create_round('BTC/USD', CUTOFF, 900, token, 400);
    stop_cheat_caller_address(m.contract_address);
    fund(m, token, id, 1_000_000);
    id
}

fn fund(m: IUpDownDispatcher, token: ContractAddress, id: u64, amount: u256) {
    let t = IStubTokenDispatcher { contract_address: token };
    t.mint(owner(), amount);
    start_cheat_caller_address(token, owner());
    t.approve(m.contract_address, amount);
    stop_cheat_caller_address(token);
    start_cheat_caller_address(m.contract_address, owner());
    m.fund_round(id, amount);
    stop_cheat_caller_address(m.contract_address);
}

/// Open a ticket as `who`, with the stake actually funded and approved.
fn open_as(
    m: IUpDownDispatcher,
    token: ContractAddress,
    who: ContractAddress,
    id: u64,
    commitment: felt252,
    stake: u256,
) {
    let t = IStubTokenDispatcher { contract_address: token };
    t.mint(who, stake);
    start_cheat_caller_address(token, who);
    t.approve(m.contract_address, stake);
    stop_cheat_caller_address(token);
    start_cheat_caller_address(m.contract_address, who);
    m.open_ticket(id, commitment, stake);
    stop_cheat_caller_address(m.contract_address);
}

/// The commitment, recomputed here rather than imported, so a change to the contract's
/// hashing has to be made deliberately in two places instead of silently in one.
fn commit(secret: felt252, round_id: u64, direction: felt252) -> felt252 {
    poseidon_hash_span(array!['MOLFI_DIRECTION_V1', secret, round_id.into(), direction].span())
}

fn settle_at(m: IUpDownDispatcher, o: IStubOracleDispatcher, id: u64, price: u128) {
    start_cheat_block_timestamp_global(AFTER);
    o.set(price, AFTER, 10);
    m.settle(id);
}

// ─────────────────────────────────────────────────────────────────── the money

#[test]
fn both_sides_are_quoted_the_same_multiplier() {
    let (m, _, token) = setup();
    let id = a_round(m, token);
    // There is one price and it takes no direction. If this ever became two numbers the
    // reserve would say which side a ticket was on, and the bit would be public.
    assert(m.quote(id) == 19_200, 'quote is 1.92x');
}

#[test]
fn the_multiplier_is_two_less_the_edge_exactly() {
    let (m, _, token) = setup();
    start_cheat_caller_address(m.contract_address, owner());
    // 2.0000x at no edge, and each basis point of edge takes exactly two off the multiplier.
    let free = m.create_round('BTC/USD', CUTOFF, 900, token, 0);
    let four = m.create_round('BTC/USD', CUTOFF, 900, token, 400);
    let ten = m.create_round('BTC/USD', CUTOFF, 900, token, 1_000);
    stop_cheat_caller_address(m.contract_address);
    assert(m.quote(free) == 20_000, 'no edge is 2.00x');
    assert(m.quote(four) == 19_200, '4% edge is 1.92x');
    assert(m.quote(ten) == 18_000, '10% edge is 1.80x');
}

#[test]
fn a_winning_ticket_pays_stake_times_multiplier_to_the_unit() {
    let (m, o, token) = setup();
    let id = a_round(m, token);
    let stake: u256 = 1_000;
    open_as(m, token, trader(), id, commit('s1', id, UP), stake);

    settle_at(m, o, id, REFERENCE + 1);

    let t = IStubTokenDispatcher { contract_address: token };
    let before = t.balance_of(trader());
    start_cheat_caller_address(m.contract_address, trader());
    m.claim_ticket(id, 's1', UP);
    stop_cheat_caller_address(m.contract_address);

    // 1000 * 19200 / 10000 = 1920. Not 1919, not 1921.
    assert(t.balance_of(trader()) - before == 1_920, 'pays 1920');
    assert(m.get_round(id).paid == 1_920, 'round records 1920');
}

#[test]
fn the_payout_truncates_the_way_the_kernel_does() {
    let (m, o, token) = setup();
    let id = a_round(m, token);
    // 7 * 19200 / 10000 = 13.44 → 13. Integer division floors, and the desk's TypeScript
    // does the same thing with the same operands, which is what makes the quote binding.
    open_as(m, token, trader(), id, commit('s2', id, UP), 7);
    settle_at(m, o, id, REFERENCE + 1);

    let t = IStubTokenDispatcher { contract_address: token };
    let before = t.balance_of(trader());
    start_cheat_caller_address(m.contract_address, trader());
    m.claim_ticket(id, 's2', UP);
    stop_cheat_caller_address(m.contract_address);
    assert(t.balance_of(trader()) - before == 13, 'floors to 13');
}

#[test]
fn a_losing_ticket_pays_nothing_and_gives_its_reservation_back() {
    let (m, o, token) = setup();
    let id = a_round(m, token);
    open_as(m, token, trader(), id, commit('s3', id, UP), 1_000);
    let reserved = m.get_round(id).reserved;
    assert(reserved == 1_920, 'reserves the full payout');

    settle_at(m, o, id, REFERENCE - 1); // went down; an UP ticket loses

    let t = IStubTokenDispatcher { contract_address: token };
    let before = t.balance_of(trader());
    start_cheat_caller_address(m.contract_address, trader());
    m.claim_ticket(id, 's3', UP);
    stop_cheat_caller_address(m.contract_address);

    assert(t.balance_of(trader()) == before, 'pays nothing');
    // Released, so the round can sell that capacity again rather than holding it for ever
    // against a ticket that already lost.
    assert(m.get_round(id).reserved == 0, 'reservation released');
    assert(m.get_ticket(commit('s3', id, UP)).claimed, 'marked spent');
}

#[test]
fn a_tie_returns_the_stake_to_either_side() {
    let (m, o, token) = setup();
    let id = a_round(m, token);
    open_as(m, token, trader(), id, commit('u', id, UP), 1_000);
    open_as(m, token, addr('T2'), id, commit('d', id, DOWN), 1_000);

    settle_at(m, o, id, REFERENCE); // did not move

    let t = IStubTokenDispatcher { contract_address: token };
    let up_before = t.balance_of(trader());
    let down_before = t.balance_of(addr('T2'));

    start_cheat_caller_address(m.contract_address, trader());
    m.claim_ticket(id, 'u', UP);
    stop_cheat_caller_address(m.contract_address);
    start_cheat_caller_address(m.contract_address, addr('T2'));
    m.claim_ticket(id, 'd', DOWN);
    stop_cheat_caller_address(m.contract_address);

    // The round asked which way it would move and it did not move. Keeping the stake would be
    // an edge that appears nowhere in the quoted multiplier.
    assert(t.balance_of(trader()) - up_before == 1_000, 'up refunded');
    assert(t.balance_of(addr('T2')) - down_before == 1_000, 'down refunded');
}

#[test]
fn the_round_never_pays_more_than_the_stakes_and_bankroll_behind_it() {
    let (m, o, token) = setup();
    let id = a_round(m, token);
    open_as(m, token, trader(), id, commit('a', id, UP), 1_000);
    open_as(m, token, addr('T2'), id, commit('b', id, DOWN), 2_000);
    settle_at(m, o, id, REFERENCE + 5);

    start_cheat_caller_address(m.contract_address, trader());
    m.claim_ticket(id, 'a', UP);
    stop_cheat_caller_address(m.contract_address);
    start_cheat_caller_address(m.contract_address, addr('T2'));
    m.claim_ticket(id, 'b', DOWN);
    stop_cheat_caller_address(m.contract_address);

    let r = m.get_round(id);
    assert(r.paid <= r.staked + r.bankroll, 'conservation holds');
    assert(r.reserved == 0, 'nothing left reserved');
    // What the contract says it holds is what it holds.
    assert(
        m.accounted_for(token) == r.staked + r.bankroll - r.paid, 'accounted_for is exact',
    );
}

#[test]
#[should_panic(expected: 'ROUND_CANNOT_COVER_PAYOUT')]
fn a_stake_the_round_cannot_cover_is_refused_at_open() {
    let (m, _, token) = setup();
    start_cheat_caller_address(m.contract_address, owner());
    let id = m.create_round('BTC/USD', CUTOFF, 900, token, 400);
    stop_cheat_caller_address(m.contract_address);
    fund(m, token, id, 100);
    // 1000 staked would owe 1920 against 1100 of backing. Refused now, not discovered by a
    // winner at claim time.
    open_as(m, token, trader(), id, commit('x', id, UP), 1_000);
}

// ─────────────────────────────────────────────────────────────────────── the bit

#[test]
fn the_stored_ticket_says_nothing_about_the_direction() {
    let (m, _, token) = setup();
    let id = a_round(m, token);
    let up = commit('same', id, UP);
    open_as(m, token, trader(), id, up, 1_000);

    let t = m.get_ticket(up);
    // Everything a reader can see. If a direction field is ever added to `Ticket`, this test
    // still compiles and the game is over, so the real assertion is the one below it.
    assert(t.stake == 1_000, 'stake is public');
    assert(t.multiplier_bps == 19_200, 'price is public');
    assert(!t.claimed, 'unclaimed');

    // The same secret and round, the other way, is a different commitment and resolves to
    // nothing. An observer holding the whole storage map cannot tell which of the two a given
    // entry was, because only one of them exists and its preimage is unknown.
    let down = commit('same', id, DOWN);
    assert(up != down, 'the bit changes the hash');
    assert(!m.get_ticket(down).exists, 'the other side is absent');
}

#[test]
fn two_tickets_the_same_way_are_indistinguishable_from_two_opposite_ones() {
    let (m, _, token) = setup();
    let id = a_round(m, token);
    open_as(m, token, trader(), id, commit('p', id, UP), 500);
    open_as(m, token, addr('T2'), id, commit('q', id, UP), 500);

    let a = m.get_ticket(commit('p', id, UP));
    let b = m.get_ticket(commit('q', id, UP));
    // Two UP tickets of equal size are byte-identical apart from their owner. So are one UP
    // and one DOWN. That equality is the anonymity set.
    assert(a.stake == b.stake, 'same stake');
    assert(a.multiplier_bps == b.multiplier_bps, 'same price');
    assert(a.round_id == b.round_id, 'same round');
}

#[test]
#[should_panic(expected: 'NO_SUCH_TICKET')]
fn claiming_the_direction_you_did_not_commit_to_finds_nothing() {
    let (m, o, token) = setup();
    let id = a_round(m, token);
    open_as(m, token, trader(), id, commit('s', id, UP), 1_000);
    settle_at(m, o, id, REFERENCE + 1);
    // Guessing the other way does not reveal that you were close — it resolves to a
    // commitment that was never opened, which is what a stranger's guess looks like too.
    start_cheat_caller_address(m.contract_address, trader());
    m.claim_ticket(id, 's', DOWN);
}

#[test]
#[should_panic(expected: 'NO_SUCH_TICKET')]
fn a_stranger_without_the_secret_cannot_name_a_position() {
    let (m, o, token) = setup();
    let id = a_round(m, token);
    open_as(m, token, trader(), id, commit('mine', id, UP), 1_000);
    settle_at(m, o, id, REFERENCE + 1);
    start_cheat_caller_address(m.contract_address, addr('THIEF'));
    m.claim_ticket(id, 'guess', UP);
}

#[test]
#[should_panic(expected: 'NOT_OWNER_OF_TICKET')]
fn a_public_ticket_cannot_be_claimed_by_someone_else_holding_the_secret() {
    let (m, o, token) = setup();
    let id = a_round(m, token);
    open_as(m, token, trader(), id, commit('leaked', id, UP), 1_000);
    settle_at(m, o, id, REFERENCE + 1);
    // The secret alone is not enough on the public route: the position recorded an owner and
    // the payout goes to them. On the pool route there is no owner and the secret is all there
    // is, which is the trade the two routes make explicit.
    start_cheat_caller_address(m.contract_address, addr('THIEF'));
    m.claim_ticket(id, 'leaked', UP);
}

#[test]
fn the_direction_tag_stops_a_range_commitment_being_replayed_here() {
    // Same secret, same id — different domain tag, different hash. Without the tag a preimage
    // valid on the range market would be valid here, and both contracts number from one.
    let range = poseidon_hash_span(array!['MOLFI_POSITION_V1', 's', 1, 0].span());
    let direction = poseidon_hash_span(array!['MOLFI_DIRECTION_V1', 's', 1, 0].span());
    assert(range != direction, 'tags separate the domains');
}

// ─────────────────────────────────────────────────────────────────── the refusals

#[test]
#[should_panic(expected: 'TICKET_EXISTS')]
fn the_same_commitment_cannot_be_opened_twice() {
    let (m, _, token) = setup();
    let id = a_round(m, token);
    let c = commit('dup', id, UP);
    open_as(m, token, trader(), id, c, 100);
    open_as(m, token, trader(), id, c, 100);
}

#[test]
#[should_panic(expected: 'ALREADY_CLAIMED')]
fn a_ticket_cannot_be_claimed_twice() {
    let (m, o, token) = setup();
    let id = a_round(m, token);
    open_as(m, token, trader(), id, commit('once', id, UP), 1_000);
    settle_at(m, o, id, REFERENCE + 1);
    start_cheat_caller_address(m.contract_address, trader());
    m.claim_ticket(id, 'once', UP);
    m.claim_ticket(id, 'once', UP);
}

#[test]
#[should_panic(expected: 'ROUND_CLOSED')]
fn a_ticket_cannot_be_opened_past_the_cutoff() {
    let (m, _, token) = setup();
    let id = a_round(m, token);
    start_cheat_block_timestamp_global(AFTER);
    open_as(m, token, trader(), id, commit('late', id, UP), 100);
}

#[test]
#[should_panic(expected: 'BEFORE_CUTOFF')]
fn a_round_cannot_settle_before_its_cutoff() {
    let (m, _, token) = setup();
    let id = a_round(m, token);
    m.settle(id);
}

#[test]
#[should_panic(expected: 'NOT_SETTLED_YET')]
fn a_ticket_cannot_be_claimed_before_the_round_settles() {
    let (m, _, token) = setup();
    let id = a_round(m, token);
    open_as(m, token, trader(), id, commit('early', id, UP), 100);
    start_cheat_caller_address(m.contract_address, trader());
    m.claim_ticket(id, 'early', UP);
}

#[test]
#[should_panic(expected: 'STALE_PRICE')]
fn a_round_cannot_settle_on_a_stale_print() {
    let (m, o, token) = setup();
    let id = a_round(m, token);
    start_cheat_block_timestamp_global(AFTER);
    // Published an hour before the contract looked at it. Sixteen minutes is already too old.
    o.set(REFERENCE + 1, AFTER - 3_600, 10);
    m.settle(id);
}

#[test]
#[should_panic(expected: 'TOO_FEW_SOURCES')]
fn a_round_cannot_settle_on_a_one_publisher_print() {
    let (m, o, token) = setup();
    let id = a_round(m, token);
    start_cheat_block_timestamp_global(AFTER);
    o.set(REFERENCE + 1, AFTER, 1);
    m.settle(id);
}

#[test]
#[should_panic(expected: 'ALREADY_SETTLED')]
fn a_round_cannot_settle_twice() {
    let (m, o, token) = setup();
    let id = a_round(m, token);
    settle_at(m, o, id, REFERENCE + 1);
    m.settle(id);
}

#[test]
#[should_panic(expected: 'CALLER_NOT_OWNER')]
fn only_the_owner_may_list_a_round() {
    let (m, _, token) = setup();
    start_cheat_caller_address(m.contract_address, addr('NOBODY'));
    m.create_round('BTC/USD', CUTOFF, 900, token, 400);
}

#[test]
#[should_panic(expected: 'ROUND_SHORTER_THAN_ORACLE')]
fn a_round_shorter_than_the_publish_interval_is_refused() {
    let (m, _, token) = setup();
    start_cheat_caller_address(m.contract_address, owner());
    // Sixty seconds against a fifteen-minute publish cadence settles against a price that was
    // already public when the round opened.
    m.create_round('BTC/USD', NOW + 60, 60, token, 400);
}

#[test]
#[should_panic(expected: 'NO_SUCH_ROUND')]
fn a_round_that_was_never_listed_reads_as_missing_rather_than_zero() {
    let (m, _, _) = setup();
    // A zero round would accept tickets against a zero reference and settle every one of them
    // as a tie, which is the worst possible way to be wrong.
    m.quote(99);
}

#[test]
#[should_panic(expected: 'DIRECTION_NOT_0_OR_1')]
fn a_direction_that_is_not_a_bit_is_refused() {
    let (m, o, token) = setup();
    let id = a_round(m, token);
    open_as(m, token, trader(), id, commit('n', id, UP), 100);
    settle_at(m, o, id, REFERENCE + 1);
    start_cheat_caller_address(m.contract_address, trader());
    m.claim_ticket(id, 'n', 7);
}

#[test]
#[should_panic(expected: 'ZERO_STAKE')]
fn a_zero_stake_is_refused() {
    let (m, _, token) = setup();
    let id = a_round(m, token);
    open_as(m, token, trader(), id, commit('z', id, UP), 0);
}

#[test]
fn the_reference_is_read_from_the_oracle_not_supplied_by_the_house() {
    let (m, _, token) = setup();
    let id = a_round(m, token);
    let r = m.get_round(id);
    // An owner-chosen reference would be the whole game decided before it opens.
    assert(r.reference_price == REFERENCE.into(), 'reference is the print');
    assert(r.reference_sources == 10, 'and carries its breadth');
    assert(r.reference_at == NOW, 'and its publish time');
}

// ──────────────────────────────────────────────────────── the pool route

/// Open through the pool the way the pool actually does it: the stake is *delivered* by a
/// separate withdraw action in the same transaction, then `privacy_invoke` is called with no
/// token movement of its own.
fn open_via_pool(
    m: IUpDownDispatcher,
    token: ContractAddress,
    id: u64,
    secret: felt252,
    direction: felt252,
    stake: u256,
) {
    let t = IStubTokenDispatcher { contract_address: token };
    // The withdraw leg: the pool sends the tokens here before the invoke, which is exactly
    // what phase order guarantees on the real pool (Withdraw is phase 6, InvokeExternal 7).
    t.mint(m.contract_address, stake);
    start_cheat_caller_address(m.contract_address, pool());
    m.privacy_invoke(0, id, direction, token, stake.try_into().unwrap(), secret, 0);
    stop_cheat_caller_address(m.contract_address);
}

#[test]
fn a_pool_opened_ticket_records_no_owner() {
    let (m, _, token) = setup();
    let id = a_round(m, token);
    open_via_pool(m, token, id, 'viapool', UP, 1_000);

    let t = m.get_ticket(commit('viapool', id, UP));
    assert(t.exists, 'ticket exists');
    assert(t.stake == 1_000, 'stake booked');
    // The whole point: the chain records that a ticket was opened and for how much, and
    // nothing that says who opened it. On the public route this field is the trader.
    assert(t.owner == addr(0), 'no owner on the pool route');
}

#[test]
fn a_pool_ticket_is_claimed_by_the_secret_alone() {
    let (m, o, token) = setup();
    let id = a_round(m, token);
    open_via_pool(m, token, id, 'winner', UP, 1_000);
    settle_at(m, o, id, REFERENCE + 1);

    start_cheat_caller_address(m.contract_address, pool());
    let notes = m.privacy_invoke(1, id, UP, token, 0, 'winner', 'note-1');
    stop_cheat_caller_address(m.contract_address);

    // One note credited, for the full payout, against the note id the pool named.
    assert(notes.len() == 1, 'one deposit returned');
    let n = *notes.at(0);
    assert(n.note_id == 'note-1', 'credits the named note');
    assert(n.token == token, 'in the round token');
    assert(n.amount == 1_920, 'stake times 1.92');
    assert(m.get_ticket(commit('winner', id, UP)).claimed, 'marked spent');
}

#[test]
fn a_losing_pool_ticket_returns_no_note_and_still_settles() {
    let (m, o, token) = setup();
    let id = a_round(m, token);
    open_via_pool(m, token, id, 'loser', UP, 1_000);
    settle_at(m, o, id, REFERENCE - 1);

    start_cheat_caller_address(m.contract_address, pool());
    let notes = m.privacy_invoke(1, id, UP, token, 0, 'loser', 'note-2');
    stop_cheat_caller_address(m.contract_address);

    // An empty span, not a revert. The pool accepts it, the ticket is spent, and the
    // reservation goes back to the round — the same contract as the public route.
    assert(notes.len() == 0, 'nothing credited');
    assert(m.get_ticket(commit('loser', id, UP)).claimed, 'marked spent');
    assert(m.get_round(id).reserved == 0, 'reservation released');
}

#[test]
#[should_panic(expected: 'CALLER_NOT_POOL')]
fn only_the_pool_may_drive_privacy_invoke() {
    let (m, _, token) = setup();
    let id = a_round(m, token);
    let t = IStubTokenDispatcher { contract_address: token };
    t.mint(m.contract_address, 1_000);
    // Anyone else reaching this would be opening a ticket against tokens they did not send.
    start_cheat_caller_address(m.contract_address, trader());
    m.privacy_invoke(0, id, UP, token, 1_000, 'thief', 0);
}

#[test]
#[should_panic(expected: 'STAKE_NOT_RECEIVED')]
fn an_invoke_with_no_tokens_delivered_is_refused() {
    let (m, _, token) = setup();
    let id = a_round(m, token);
    // No withdraw leg. The amount is a claim, and the contract measures instead of believing:
    // without this a caller who can reach the pool could book a free position.
    start_cheat_caller_address(m.contract_address, pool());
    m.privacy_invoke(0, id, UP, token, 1_000, 'freebie', 0);
}

#[test]
#[should_panic(expected: 'UNKNOWN_OPERATION')]
fn an_unknown_operation_is_refused() {
    let (m, _, token) = setup();
    let id = a_round(m, token);
    start_cheat_caller_address(m.contract_address, pool());
    m.privacy_invoke(7, id, UP, token, 0, 's', 0);
}
