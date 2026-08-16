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
//!   (KEY_TOTAL,     token) → i128   — lifetime total collected (reported)
//!   (KEY_WITHDRAWN, token) → i128   — lifetime total withdrawn
//!
//! The actual token balances are tracked by the token contracts themselves;
//! `get_balance` queries the token contract directly.
//!
//! ## Trust-the-caller caveat
//!
//! `get_total_collected` is a **reported / claimed** figure, not a value
//! independently verified against real token movement.  When `collect_fee` is
//! called, the contract blindly trusts the `amount` parameter supplied by the
//! caller (by design — the corresponding token transfer has already occurred
//! before `collect_fee` is called, and re-querying the balance would be
//! racy).  Consequently `get_total_collected` and `get_balance` can legitimately
//! diverge for entirely benign reasons:
//!
//! * Every `withdraw` call reduces `get_balance` without reducing
//!   `get_total_collected` (because `KEY_TOTAL` is a *lifetime* counter, not a
//!   live balance).
//! * A caller that passes an `amount` inconsistent with what was actually
//!   transferred (e.g. due to a rounding bug or a fee-on-transfer token) will
//!   silently skew the counter.
//!
//! To aid treasury auditing, the contract also tracks a parallel
//! `(KEY_WITHDRAWN, token)` lifetime counter so that the invariant
//!
//! ```text
//! get_expected_balance(token) == get_total_collected(token) - get_total_withdrawn(token)
//! ```
//!
//! can be computed on-chain and diffed against `get_balance(token)`.  Any
//! non-zero difference signals drift that warrants investigation, but the
//! contract itself cannot auto-correct it.

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

/// Persistent key prefix for lifetime-total-withdrawn per token.
const KEY_WITHDRAWN: Symbol = symbol_short!("WDRAWN");

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

        // Update lifetime-withdrawn counter for this token.
        let withdrawn_key = (KEY_WITHDRAWN, token.clone());
        let current_withdrawn: i128 = env
            .storage()
            .persistent()
            .get(&withdrawn_key)
            .unwrap_or(0i128);
        let new_withdrawn = current_withdrawn
            .checked_add(amount)
            .ok_or(FeeCollectorError::ArithmeticOverflow)?;
        env.storage().persistent().set(&withdrawn_key, &new_withdrawn);

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
    /// **Note:** this is a reported/claimed figure supplied by the caller of
    /// `collect_fee`.  It is not independently verified against the contract's
    /// real token balance.  See the module-level documentation for details.
    pub fn get_total_collected(env: Env, token: Address) -> i128 {
        let total_key = (KEY_TOTAL, token);
        env.storage()
            .persistent()
            .get(&total_key)
            .unwrap_or(0i128)
    }

    /// Return the lifetime total amount of `token` ever withdrawn by the admin.
    pub fn get_total_withdrawn(env: Env, token: Address) -> i128 {
        let withdrawn_key = (KEY_WITHDRAWN, token);
        env.storage()
            .persistent()
            .get(&withdrawn_key)
            .unwrap_or(0i128)
    }

    /// Return the expected current balance derived from on-chain counters:
    ///
    /// ```text
    /// expected = get_total_collected(token) - get_total_withdrawn(token)
    /// ```
    ///
    /// Comparing this value against `get_balance(token)` surfaces any drift
    /// between what the accounting counters claim and what the contract
    /// actually holds.  A non-zero difference signals that the `amount`
    /// passed to one or more `collect_fee` calls did not match the tokens
    /// that were actually transferred (e.g. a rounding bug or a
    /// fee-on-transfer token).
    pub fn get_expected_balance(env: Env, token: Address) -> i128 {
        let total_key = (KEY_TOTAL, token.clone());
        let total_collected: i128 = env
            .storage()
            .persistent()
            .get(&total_key)
            .unwrap_or(0i128);

        let withdrawn_key = (KEY_WITHDRAWN, token);
        let total_withdrawn: i128 = env
            .storage()
            .persistent()
            .get(&withdrawn_key)
            .unwrap_or(0i128);

        // Saturating subtraction: the result should never be negative in a
        // well-behaved deployment, but we guard against it defensively.
        total_collected.saturating_sub(total_withdrawn)
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
