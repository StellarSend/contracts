//! # FeeCollector Contract
//!
//! Receives protocol fees forwarded by the `StellarSend` contract and allows
//! the treasury admin to withdraw accumulated balances.
//!
//! Storage layout
//! ──────────────
//! Instance storage:
//!   KEY_ADMIN    → Address
//!   KEY_TREASURY → Address
//!
//! Persistent storage (keyed by token address):
//!   (KEY_TOTAL, token) → i128   — lifetime total collected
//!
//! The actual token balances are tracked by the token contracts themselves;
//! `get_balance` queries the token contract directly.

#![no_std]

use soroban_sdk::{
    contract, contractimpl, symbol_short, token, Address, Env, Symbol,
};

// ---------------------------------------------------------------------------
// Storage keys
// ---------------------------------------------------------------------------

const KEY_ADMIN: Symbol = symbol_short!("ADMIN");
const KEY_TREASURY: Symbol = symbol_short!("TREASURY");
const KEY_INIT: Symbol = symbol_short!("INIT");

/// Persistent key prefix for lifetime-total-collected per token.
const KEY_TOTAL: Symbol = symbol_short!("TOTAL");

// ---------------------------------------------------------------------------
// TTL policy for (KEY_TOTAL, token) persistent entries
// ---------------------------------------------------------------------------

/// If the remaining TTL of a `(KEY_TOTAL, token)` entry falls below this
/// threshold when `collect_fee` is called, the TTL is extended up to
/// `TOTAL_TTL_TARGET`.
///
/// Set to ~30 days at 5 s/ledger (≈518 400 ledgers) so that a token which
/// stops receiving traffic has about a month before its entry needs an
/// external restore. On mainnet today the minimum persistent TTL is already
/// well above this, but the guard here keeps the entry alive even when the
/// network-minimum drops or a token becomes low-frequency.
const TOTAL_TTL_THRESHOLD: u32 = 518_400; // ~30 days at 5 s/ledger

/// Target TTL to extend a `(KEY_TOTAL, token)` entry to when its TTL falls
/// below `TOTAL_TTL_THRESHOLD`.
///
/// ~120 days at 5 s/ledger (≈2 073 600 ledgers).  This is intentionally
/// generous: the lifetime-total counter is the only on-chain audit surface
/// for fee accounting, and the cost of re-extending a healthy entry is
/// negligible compared to the cost of silently losing historical data.
const TOTAL_TTL_TARGET: u32 = 2_073_600; // ~120 days at 5 s/ledger

// ---------------------------------------------------------------------------
// Error type
// ---------------------------------------------------------------------------

#[soroban_sdk::contracterror]
#[derive(Copy, Clone, Debug, Eq, PartialEq)]
#[repr(u32)]
pub enum FeeCollectorError {
    AlreadyInitialized = 1,
    NotInitialized = 2,
    Unauthorized = 3,
    InvalidAmount = 4,
    ArithmeticOverflow = 5,
}

// ---------------------------------------------------------------------------
// Contract
// ---------------------------------------------------------------------------

#[contract]
pub struct FeeCollectorContract;

#[contractimpl]
impl FeeCollectorContract {
    // -----------------------------------------------------------------------
    // Lifecycle
    // -----------------------------------------------------------------------

    /// Initialise the fee-collector.
    ///
    /// * `admin`    – Can call `withdraw` and update the treasury.
    /// * `treasury` – Default recipient of withdrawn fees.
    pub fn initialize(
        env: Env,
        admin: Address,
        treasury: Address,
    ) -> Result<(), FeeCollectorError> {
        if env.storage().instance().has(&KEY_INIT) {
            return Err(FeeCollectorError::AlreadyInitialized);
        }
        admin.require_auth();

        env.storage().instance().set(&KEY_ADMIN, &admin);
        env.storage().instance().set(&KEY_TREASURY, &treasury);
        env.storage().instance().set(&KEY_INIT, &true);
        Ok(())
    }

    // -----------------------------------------------------------------------
    // Called by StellarSend (or any authorised caller)
    // -----------------------------------------------------------------------

    /// Record that `amount` of `token` has been collected as a fee.
    ///
    /// The actual token transfer must have already occurred (StellarSend
    /// transfers the fee to this contract's address before calling this).
    /// This function merely updates the lifetime accounting counter.
    pub fn collect_fee(
        env: Env,
        token: Address,
        amount: i128,
    ) -> Result<(), FeeCollectorError> {
        Self::assert_initialized(&env)?;

        if amount <= 0 {
            return Err(FeeCollectorError::InvalidAmount);
        }

        // Update lifetime total for this token.
        let total_key = (KEY_TOTAL, token.clone());
        let current_total: i128 = env
            .storage()
            .persistent()
            .get(&total_key)
            .unwrap_or(0i128);
        let new_total = current_total
            .checked_add(amount)
            .ok_or(FeeCollectorError::ArithmeticOverflow)?;
        env.storage().persistent().set(&total_key, &new_total);

        // Extend the TTL of the lifetime-total entry on every write so it
        // stays live even if this token goes dormant for a long stretch.
        // Without this, a token that stops receiving fees could have its
        // entry expire, causing `get_total_collected` to silently return 0
        // instead of the real historical total — indistinguishable from
        // "never collected any fees" and strictly worse than a loud error.
        env.storage()
            .persistent()
            .extend_ttl(&total_key, TOTAL_TTL_THRESHOLD, TOTAL_TTL_TARGET);

        // Emit event.
        env.events().publish(
            (symbol_short!("fee_rcvd"), token),
            amount,
        );

        Ok(())
    }

    // -----------------------------------------------------------------------
    // Admin operations
    // -----------------------------------------------------------------------

    /// Withdraw `amount` of `token` from this contract to `recipient`.
    /// Only the admin may call this.
    pub fn withdraw(
        env: Env,
        token: Address,
        amount: i128,
        recipient: Address,
    ) -> Result<(), FeeCollectorError> {
        Self::assert_initialized(&env)?;

        let admin: Address = env
            .storage()
            .instance()
            .get(&KEY_ADMIN)
            .ok_or(FeeCollectorError::NotInitialized)?;
        admin.require_auth();

        if amount <= 0 {
            return Err(FeeCollectorError::InvalidAmount);
        }

        // Transfer from this contract to recipient.
        let token_client = token::Client::new(&env, &token);
        token_client.transfer(&env.current_contract_address(), &recipient, &amount);

        // Emit event.
        env.events().publish(
            (symbol_short!("fee_wdrw"), token, recipient),
            amount,
        );

        Ok(())
    }

    /// Update the treasury address.  Only admin may call this.
    pub fn set_treasury(env: Env, new_treasury: Address) -> Result<(), FeeCollectorError> {
        Self::assert_initialized(&env)?;
        let admin: Address = env
            .storage()
            .instance()
            .get(&KEY_ADMIN)
            .ok_or(FeeCollectorError::NotInitialized)?;
        admin.require_auth();
        env.storage().instance().set(&KEY_TREASURY, &new_treasury);
        Ok(())
    }

    // -----------------------------------------------------------------------
    // Queries
    // -----------------------------------------------------------------------

    /// Return the current token balance held by this contract.
    pub fn get_balance(env: Env, token: Address) -> i128 {
        let token_client = token::Client::new(&env, &token);
        token_client.balance(&env.current_contract_address())
    }

    /// Return the lifetime total amount of `token` ever collected as fees.
    ///
    /// # Caveat: ambiguous zero
    ///
    /// This function returns `0` in two distinct situations that it cannot
    /// distinguish:
    ///
    /// 1. **Genuinely zero** — no fees have ever been collected for `token`.
    /// 2. **Stale / archived** — fees *were* collected historically, but the
    ///    `(KEY_TOTAL, token)` persistent entry's TTL lapsed (e.g. the token
    ///    stopped receiving traffic long enough for the entry to be archived
    ///    by the network), and no one has restored it yet.
    ///
    /// As of this version, `collect_fee` calls `extend_ttl` on every write,
    /// which keeps the entry live for up to `TOTAL_TTL_TARGET` ledgers after
    /// the last fee was collected (~120 days at 5 s/ledger).  This makes
    /// scenario 2 unlikely for any token that has seen recent activity, but
    /// it **cannot be ruled out** for tokens that have been dormant longer
    /// than the target TTL.
    ///
    /// Callers that need to distinguish "genuinely zero" from "possibly
    /// stale" should use [`Self::get_total_collected_opt`], which returns
    /// `None` when the entry is absent rather than silently returning `0`.
    ///
    /// The `fee_rcvd` events emitted by `collect_fee` are the authoritative
    /// source of truth for lifetime fee totals; this counter is a cache that
    /// can, in principle, be reconstructed by replaying those events.
    pub fn get_total_collected(env: Env, token: Address) -> i128 {
        let total_key = (KEY_TOTAL, token);
        env.storage()
            .persistent()
            .get(&total_key)
            .unwrap_or(0i128)
    }

    /// Return the lifetime total fees collected for `token`, or `None` if
    /// the persistent entry is absent.
    ///
    /// Unlike [`Self::get_total_collected`], this function surfaces the
    /// distinction between:
    ///
    /// * `Some(0)`  — the entry exists and the running total is zero (an
    ///   edge case that should not occur in practice, but is technically
    ///   valid if the only fee collected was then subtracted — currently the
    ///   contract has no subtraction path, so `Some(0)` will only appear
    ///   immediately after the first `collect_fee` when `amount` would have
    ///   been 0, which is rejected, meaning `Some` is always `> 0` today).
    /// * `Some(n)`  — the entry exists with a nonzero running total `n`.
    /// * `None`     — the entry is absent: either this token has never had
    ///   any fees collected, **or** the entry existed but its TTL lapsed and
    ///   it has since been archived by the network.
    ///
    /// Use this variant in any context where silently returning `0` for a
    /// stale-but-historically-active token would be incorrect (e.g. treasury
    /// reporting, per-epoch withdrawal-limit calculations, or on-chain
    /// callers that gate logic on whether any fees exist).
    pub fn get_total_collected_opt(env: Env, token: Address) -> Option<i128> {
        let total_key = (KEY_TOTAL, token);
        env.storage().persistent().get(&total_key)
    }

    /// Return the admin address.
    pub fn get_admin(env: Env) -> Result<Address, FeeCollectorError> {
        env.storage()
            .instance()
            .get(&KEY_ADMIN)
            .ok_or(FeeCollectorError::NotInitialized)
    }

    /// Return the treasury address.
    pub fn get_treasury(env: Env) -> Result<Address, FeeCollectorError> {
        env.storage()
            .instance()
            .get(&KEY_TREASURY)
            .ok_or(FeeCollectorError::NotInitialized)
    }

    // -----------------------------------------------------------------------
    // Helpers
    // -----------------------------------------------------------------------

    fn assert_initialized(env: &Env) -> Result<(), FeeCollectorError> {
        if !env.storage().instance().has(&KEY_INIT) {
            return Err(FeeCollectorError::NotInitialized);
        }
        Ok(())
    }
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

#[cfg(test)]
mod test;
