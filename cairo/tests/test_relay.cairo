//! The relay's job is to be boring and honest: serve mainnet's number, and never be able to
//! launder its age or replay it.

use snforge_std::{
    ContractClassTrait, DeclareResultTrait, declare, start_cheat_block_timestamp_global,
    start_cheat_caller_address, stop_cheat_caller_address,
};
use starknet::ContractAddress;
use molfi::objects::DataType;
use molfi::relay::{IPriceRelayDispatcher, IPriceRelayDispatcherTrait};

const NOW: u64 = 1_800_000_000;

fn addr(v: felt252) -> ContractAddress {
    v.try_into().unwrap()
}

fn relayer() -> ContractAddress {
    addr('RELAYER')
}

fn setup() -> IPriceRelayDispatcher {
    let class = declare("PriceRelay").unwrap().contract_class();
    let (address, _) = class.deploy(@array![relayer().into(), addr('MAINNET_PRAGMA').into()]).unwrap();
    start_cheat_block_timestamp_global(NOW);
    IPriceRelayDispatcher { contract_address: address }
}

fn publish(r: IPriceRelayDispatcher, price: u128, published_at: u64, sources: u32) {
    start_cheat_caller_address(r.contract_address, relayer());
    r.relay('BTC/USD', price, 8, published_at, sources, 900_000);
    stop_cheat_caller_address(r.contract_address);
}

#[test]
fn it_serves_a_relayed_price_the_way_pragma_would() {
    let r = setup();
    publish(r, 7_970_000_000_000, NOW - 120, 11);

    let got = r.get_data_median(DataType::SpotEntry('BTC/USD'));
    assert(got.price == 7_970_000_000_000, 'price');
    assert(got.decimals == 8, 'decimals');
    assert(got.num_sources_aggregated == 11, 'sources carried through');
}

#[test]
fn it_serves_pragmas_timestamp_and_not_its_own() {
    // The one thing a relay must not be able to do. The market refuses a print older than
    // fifteen minutes; returning the relay time instead of the publish time would let a
    // stale mainnet price pass a freshness check it should fail.
    let r = setup();
    publish(r, 7_970_000_000_000, NOW - 600, 11);

    let got = r.get_data_median(DataType::SpotEntry('BTC/USD'));
    assert(got.last_updated_timestamp == NOW - 600, 'pragma time, not relay time');
    assert(r.get_relayed('BTC/USD').relayed_at == NOW, 'relay time kept separately');
}

#[test]
fn it_records_the_mainnet_block_the_price_came_from() {
    // Without it the relayed number is an assertion. With it anyone can re-read the source.
    let r = setup();
    publish(r, 7_970_000_000_000, NOW - 60, 11);
    assert(r.get_relayed('BTC/USD').source_block == 900_000, 'source block kept');
    assert(r.mirrors() == addr('MAINNET_PRAGMA'), 'and the contract it mirrors');
}

#[test]
#[should_panic(expected: 'PRINT_OLDER_THAN_STORED')]
fn it_refuses_to_move_a_pair_backwards_in_time() {
    // The one power a single-publisher relay must not have: replaying an old mainnet print
    // to force a settlement onto a price it had already seen.
    let r = setup();
    publish(r, 7_970_000_000_000, NOW - 60, 11);
    publish(r, 7_000_000_000_000, NOW - 600, 11);
}

#[test]
fn republishing_the_same_timestamp_is_allowed() {
    // Pragma's median can be re-read at the same publish time from a later block, and
    // refusing that would stall the relay between publishes for no reason.
    let r = setup();
    publish(r, 7_970_000_000_000, NOW - 60, 11);
    publish(r, 7_970_000_000_001, NOW - 60, 12);
    assert(r.get_relayed('BTC/USD').sources == 12, 'latest read wins');
}

#[test]
#[should_panic(expected: 'CALLER_NOT_RELAYER')]
fn a_stranger_cannot_publish() {
    let r = setup();
    start_cheat_caller_address(r.contract_address, addr('STRANGER'));
    r.relay('BTC/USD', 1, 8, NOW, 10, 1);
}

#[test]
#[should_panic(expected: 'ZERO_SOURCES')]
fn a_print_with_no_publishers_is_refused() {
    // The market's own floor is three. Zero is refused here as well, because a relay that
    // will carry a zero is a relay that can invent one.
    let r = setup();
    start_cheat_caller_address(r.contract_address, relayer());
    r.relay('BTC/USD', 7_970_000_000_000, 8, NOW, 0, 1);
}

#[test]
#[should_panic(expected: 'ZERO_PRICE')]
fn a_zero_price_is_refused() {
    let r = setup();
    start_cheat_caller_address(r.contract_address, relayer());
    r.relay('BTC/USD', 0, 8, NOW, 10, 1);
}

#[test]
#[should_panic(expected: 'NO_PRICE_FOR_PAIR')]
fn a_pair_never_relayed_reads_as_missing_rather_than_zero() {
    // A zero price settles every band as a miss, because no band straddling a real price
    // contains zero. Reverting is the honest answer.
    let r = setup();
    r.get_data_median(DataType::SpotEntry('DOGE/USD'));
}

#[test]
fn the_relayer_can_hand_over() {
    let r = setup();
    start_cheat_caller_address(r.contract_address, relayer());
    r.set_relayer(addr('NEXT'));
    stop_cheat_caller_address(r.contract_address);
    assert(r.relayer() == addr('NEXT'), 'handed over');
}
