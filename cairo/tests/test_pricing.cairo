//! The pricing library, checked against the properties a multiplier has to have.

use molfi::pricing::{
    BPS, PROB_ONE, half_prob, normal_table, payout_for, prob_inside, quote, sigma_bps_1e4,
    sqrt_u256, validate_table,
};

#[test]
fn the_normal_table_is_a_valid_cdf() {
    validate_table(normal_table());
}

#[test]
fn sqrt_truncates_the_way_the_kernel_does() {
    assert(sqrt_u256(0) == 0, 'sqrt 0');
    assert(sqrt_u256(1) == 1, 'sqrt 1');
    assert(sqrt_u256(4) == 2, 'sqrt 4');
    // 8 is not a perfect square; both implementations must land on 2, not 3.
    assert(sqrt_u256(8) == 2, 'sqrt 8');
    assert(sqrt_u256(100_000_000) == 10_000, 'sqrt 1e8');
}

#[test]
fn half_prob_clamps_above_four_sigma() {
    let t = normal_table();
    assert(half_prob(t, 40_000) == 999_937, 'at ceiling');
    assert(half_prob(t, 999_999) == 999_937, 'past ceiling');
}

#[test]
fn half_prob_interpolates_between_samples() {
    let t = normal_table();
    // Half a step past 0.25 sigma sits between the first two samples, not on either.
    let mid = half_prob(t, 3_750);
    assert(mid > 197_413 && mid < 382_925, 'interpolated');
}

#[test]
fn a_wider_band_is_more_likely_and_pays_less() {
    let t = normal_table();
    let sigma = 500_000;
    let tight = quote(t, 100_000, 99_000, 101_000, sigma, 300);
    let wide = quote(t, 100_000, 95_000, 105_000, sigma, 300);
    assert(wide.prob_1e6 > tight.prob_1e6, 'wider is likelier');
    assert(wide.multiplier_bps < tight.multiplier_bps, 'wider pays less');
}

#[test]
fn the_house_edge_is_actually_applied() {
    let t = normal_table();
    let sigma = 500_000;
    let free = quote(t, 100_000, 99_000, 101_000, sigma, 0);
    let charged = quote(t, 100_000, 99_000, 101_000, sigma, 300);
    assert(charged.multiplier_bps < free.multiplier_bps, 'edge applied');
    // 3% edge on the gross, within integer truncation.
    let expected = free.multiplier_bps * (BPS - 300) / BPS;
    assert(charged.multiplier_bps == expected, 'edge is exact');
}

#[test]
#[should_panic(expected: 'SPOT_OUTSIDE_BAND')]
fn a_band_that_does_not_straddle_spot_is_refused() {
    // Not a prediction — a claim the price already moved. Pricing it would produce a
    // multiplier that means nothing.
    prob_inside(normal_table(), 100_000, 101_000, 102_000, 500_000);
}

#[test]
#[should_panic(expected: 'ZERO_SIGMA')]
fn zero_volatility_is_refused_rather_than_dividing_by_it() {
    prob_inside(normal_table(), 100_000, 99_000, 101_000, 0);
}

#[test]
fn sigma_grows_with_the_square_root_of_time() {
    let one = sigma_bps_1e4(100, 1, 1);
    let four = sigma_bps_1e4(100, 4, 1);
    // Four times the blocks is twice the sigma.
    assert(four == one * 2, 'sqrt of time');
}

#[test]
fn payout_is_stake_times_multiplier() {
    assert(payout_for(1_000, 20_000) == 2_000, 'doubles');
    assert(payout_for(1_000, BPS) == 1_000, 'unchanged at 1x');
    // Truncates rather than rounding up, so the pot never pays a wei it did not take.
    assert(payout_for(3, 15_000) == 4, 'truncates');
}

#[test]
fn probability_never_exceeds_one() {
    let t = normal_table();
    let p = prob_inside(t, 100_000, 1, 199_999, 1);
    assert(p <= PROB_ONE, 'bounded by one');
}
