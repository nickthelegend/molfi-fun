//! The multiplier, in integers.
//!
//! Exact mirror of `packages/sdk/src/pricing.ts`. Every operation is unsigned integer
//! arithmetic so the truncating division matches step for step — the desk quotes from the
//! TypeScript, the chain quotes from here, and `cairo/tests/test_parity.cairo` diffs the two
//! over thousands of inputs. That is what makes the number a trader is shown before they
//! commit provably the number they are charged.
//!
//! A float anywhere in this path would make the two disagree in the fourth decimal, and
//! nobody would notice until a settlement was contested.

/// Basis points denominator.
pub const BPS: u256 = 10_000;

/// Probabilities are 1e6 fixed point.
pub const PROB_ONE: u256 = 1_000_000;

/// Table step: 0.25 sigma in 1e4 fixed point.
pub const Z_STEP: u256 = 2_500;

/// Table ceiling: 4.00 sigma.
pub const Z_MAX: u256 = 40_000;

/// T(z) = P(|move| <= z*sigma) sampled on z = 0, 0.25 .. 4.00.
pub const TABLE_LEN: u32 = 17;

pub mod errors {
    pub const ZERO_SIGMA: felt252 = 'ZERO_SIGMA';
    pub const SPOT_OUTSIDE_BAND: felt252 = 'SPOT_OUTSIDE_BAND';
    pub const BAD_TABLE: felt252 = 'BAD_TABLE';
}

/// T(z) = 2*Phi(z) - 1 for the standard normal.
///
/// The fallback for a market with no measured tape. Real markets ship their own table: over a
/// short round an asset closes exactly where it opened far more often than a normal allows,
/// and a normal puts almost no probability on that.
pub fn normal_table() -> Span<u256> {
    array![
        0, 197_413, 382_925, 546_746, 682_689, 788_700, 866_386, 919_882, 954_500, 975_551,
        987_581, 994_040, 997_300, 998_845, 999_535, 999_823, 999_937,
    ]
        .span()
}

/// A table has to be a CDF: it starts at zero, never dips, and never exceeds one.
///
/// Checked rather than assumed because a table is the one input that can misprice every band
/// in a market at once, and a dip in it would read as a negative probability.
pub fn validate_table(t: Span<u256>) {
    assert(t.len() == TABLE_LEN, errors::BAD_TABLE);
    assert(*t.at(0) == 0, errors::BAD_TABLE);
    let mut i: u32 = 1;
    loop {
        if i == TABLE_LEN {
            break;
        }
        let prev = *t.at(i - 1);
        let cur = *t.at(i);
        assert(cur >= prev, errors::BAD_TABLE);
        assert(cur <= PROB_ONE, errors::BAD_TABLE);
        i += 1;
    };
}

/// Integer square root, Babylonian. Same loop and same truncation as the kernel's.
pub fn sqrt_u256(x: u256) -> u256 {
    if x == 0 {
        return 0;
    }
    let mut z = x;
    let mut y = x / 2 + 1;
    loop {
        if y >= z {
            break;
        }
        z = y;
        y = (x / y + y) / 2;
    };
    z
}

/// Linear interpolation into the table at z, in 1e4 fixed point.
pub fn half_prob(t: Span<u256>, z1e4: u256) -> u256 {
    if z1e4 >= Z_MAX {
        return *t.at(TABLE_LEN - 1);
    }
    let i: u256 = z1e4 / Z_STEP;
    let rem: u256 = z1e4 - i * Z_STEP;
    let idx: u32 = i.try_into().unwrap();
    let lo = *t.at(idx);
    let hi = *t.at(idx + 1);
    lo + ((hi - lo) * rem) / Z_STEP
}

/// The probability the price is inside the band at the cutoff, in 1e6 fixed point.
///
/// The band has to straddle spot. A band that does not is not a prediction, it is a claim the
/// price has already moved, and pricing one would produce a multiplier that means nothing.
pub fn prob_inside(t: Span<u256>, spot: u256, low: u256, high: u256, sig1e4: u256) -> u256 {
    assert(sig1e4 != 0, errors::ZERO_SIGMA);
    assert(low < spot, errors::SPOT_OUTSIDE_BAND);
    assert(high > spot, errors::SPOT_OUTSIDE_BAND);
    let z_low = (((spot - low) * 100_000_000) / spot) * BPS / sig1e4;
    let z_high = (((high - spot) * 100_000_000) / spot) * BPS / sig1e4;
    (half_prob(t, z_low) + half_prob(t, z_high)) / 2
}

#[derive(Drop, Copy, Serde, PartialEq, Debug)]
pub struct Quote {
    pub multiplier_bps: u256,
    pub prob_1e6: u256,
}

/// The multiplier a band sells for, after the house edge.
pub fn quote(
    t: Span<u256>, spot: u256, low: u256, high: u256, sig1e4: u256, house_edge_bps: u256,
) -> Quote {
    let prob_1e6 = prob_inside(t, spot, low, high, sig1e4);
    if prob_1e6 == 0 {
        return Quote { multiplier_bps: 0, prob_1e6: 0 };
    }
    let gross = (PROB_ONE * BPS) / prob_1e6;
    Quote { multiplier_bps: (gross * (BPS - house_edge_bps)) / BPS, prob_1e6 }
}

/// What a winning stake pays.
pub fn payout_for(stake: u256, multiplier_bps: u256) -> u256 {
    (stake * multiplier_bps) / BPS
}
