//! molfi — prediction markets whose positions stay sealed until settlement.
//!
//! Three pieces, and the split is deliberate:
//!
//! * `pricing`  — the multiplier, integer only, mirrored by the TypeScript kernel so the quote
//!                a trader is shown before committing is provably the one they are charged.
//! * `objects`  — the pool's own types, reproduced because a helper has to speak them exactly.
//! * `market`   — the anonymizer. The pool withdraws to it, calls `privacy_invoke`, and reads
//!                back the notes to credit. Opening parks funds and credits nothing; claiming
//!                releases to the winner's open note.

pub mod pricing;
pub mod objects;
pub mod market;

/// The direction game: up or down, with the bit committed rather than stored.
pub mod updown;

/// Stand-ins for the pool's oracle and token, for local runs only. Never deployed publicly.
pub mod devnet;

/// Republishes mainnet Pragma onto a testnet whose own feed has stopped. Testnets only —
/// on mainnet molfi reads Pragma directly and this is not deployed.
pub mod relay;
