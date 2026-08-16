//! # Escrow — Conditional Transfer Contract
//!
//! A standalone contract that locks a token deposit until a condition is
//! met, then releases it to a beneficiary or refunds it to the depositor.
//! This is a distinct concern from `stellar_send` (which only ever moves
//! funds atomically between two live signers) because escrowed funds are
//! *held by the contract itself* across an arbitrary number of ledgers,
//! with a lifecycle (Locked → Released | Refunded) that has nothing to do
//! with fee accounting — hence its own crate, mirroring how `token_bridge`
//! and `fee_collector` are separated from the main entry point.
//!
//! ## Release / refund rules
//!
//! * **`release_escrow`** — the `beneficiary` may claim the funds once
//!   `env.ledger().timestamp() >= unlock_time`.  If an `arbiter` was named
//!   at creation time, the arbiter may release the funds to the
//!   beneficiary **at any time**, even before `unlock_time` (e.g. to settle
//!   a dispute early in the beneficiary's favour).
//! * **`refund_escrow`** — only ever pays the depositor back.  The
//!   `arbiter` (if any) may authorise a refund at any time. Without an
//!   arbiter decision, the depositor may only reclaim the funds themself
//!   after a long *refund grace period* (`REFUND_GRACE_SECONDS`, one week)
//!   has elapsed **past** `unlock_time`. This prevents a depositor from
//!   griefing the beneficiary by yanking funds back right as they become
//!   claimable; the beneficiary always has a full grace window to call
//!   `release_escrow` first.
//!
//! Storage layout
//! ──────────────
//! Instance storage:
//!   KEY_SEQ → u64 (global escrow id counter)
//! Persistent storage:
//!   (KEY_ESCROW, id) → Escrow

#![no_std]

mod error;
mod events;
mod reentrancy;

pub use error::EscrowError;

use soroban_sdk::{contract, contractimpl, contracttype, symbol_short, token, Address, Env, Symbol};

/// Depositor-initiated refunds are only permitted this many seconds after
/// `unlock_time` has passed, giving the beneficiary a full week to claim
/// before the depositor can unilaterally pull the funds back.
pub const REFUND_GRACE_SECONDS: u64 = 7 * 24 * 60 * 60;

const KEY_SEQ: Symbol = symbol_short!("SEQ");
const KEY_ESCROW: Symbol = symbol_short!("ESCROW");

/// Lifecycle state of an escrow.
#[contracttype]
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum EscrowStatus {
    Locked,
    Released,
    Refunded,
}

/// A single escrowed deposit.
#[contracttype]
#[derive(Clone, Debug, PartialEq)]
pub struct Escrow {
    pub depositor: Address,
    pub beneficiary: Address,
    pub token: Address,
    pub amount: i128,
    /// Ledger timestamp at/after which the beneficiary may claim the funds.
    pub unlock_time: u64,
    /// Optional trusted third party who can release early or refund early.
    pub arbiter: Option<Address>,
    pub status: EscrowStatus,
}

#[contract]
pub struct EscrowContract;

#[contractimpl]
impl EscrowContract {
    /// Lock `amount` of `token`, pulled from `depositor`, until `unlock_time`.
    /// Returns the new escrow id.
    ///
    /// Funds are transferred into the contract's own balance immediately;
    /// `depositor` must authorise this call.
    pub fn create_escrow(
        env: Env,
        depositor: Address,
        beneficiary: Address,
        token: Address,
        amount: i128,
        unlock_time: u64,
        arbiter: Option<Address>,
    ) -> Result<u64, EscrowError> {
        depositor.require_auth();

        if amount <= 0 {
            return Err(EscrowError::InvalidAmount);
        }
        if unlock_time <= env.ledger().timestamp() {
            return Err(EscrowError::InvalidUnlockTime);
        }
        if depositor == beneficiary {
            return Err(EscrowError::SelfEscrowNotAllowed);
        }

        let token_client = token::Client::new(&env, &token);
        token_client.transfer(&depositor, &env.current_contract_address(), &amount);

        let id = Self::next_id(&env);
        let escrow = Escrow {
            depositor: depositor.clone(),
            beneficiary: beneficiary.clone(),
            token: token.clone(),
            amount,
            unlock_time,
            arbiter,
            status: EscrowStatus::Locked,
        };
        env.storage().persistent().set(&(KEY_ESCROW, id), &escrow);

        events::emit_escrow_created(&env, id, &depositor, &beneficiary, &token, amount, unlock_time);
        Ok(id)
    }

    /// Release escrowed funds to the beneficiary.
    ///
    /// * `caller` must authorise the call and must be either the
    ///   beneficiary (only once `unlock_time` has passed) or the arbiter
    ///   (at any time).
    pub fn release_escrow(env: Env, escrow_id: u64, caller: Address) -> Result<(), EscrowError> {
        let _guard = crate::reentrancy::ReentrancyGuard::new(&env);
        caller.require_auth();

        let mut escrow = Self::load(&env, escrow_id)?;
        Self::assert_locked(&escrow)?;

        let now = env.ledger().timestamp();
        let is_arbiter = escrow.arbiter.as_ref() == Some(&caller);
        let is_beneficiary_after_unlock = caller == escrow.beneficiary && now >= escrow.unlock_time;

        if !is_arbiter && !is_beneficiary_after_unlock {
            if caller == escrow.beneficiary {
                return Err(EscrowError::NotYetUnlocked);
            }
            return Err(EscrowError::Unauthorized);
        }

        escrow.status = EscrowStatus::Released;
        env.storage().persistent().set(&(KEY_ESCROW, escrow_id), &escrow);

        let token_client = token::Client::new(&env, &escrow.token);
        token_client.transfer(&env.current_contract_address(), &escrow.beneficiary, &escrow.amount);

        events::emit_escrow_released(&env, escrow_id, &escrow.beneficiary, escrow.amount, &caller);
        Ok(())
    }

    /// Refund escrowed funds back to the depositor.
    ///
    /// * `caller` must authorise the call and must be either the arbiter
    ///   (at any time) or the depositor — but the depositor may only
    ///   self-refund once `unlock_time + REFUND_GRACE_SECONDS` has passed
    ///   (see module docs for the anti-griefing rationale).
    pub fn refund_escrow(env: Env, escrow_id: u64, caller: Address) -> Result<(), EscrowError> {
        let _guard = crate::reentrancy::ReentrancyGuard::new(&env);
        caller.require_auth();

        let mut escrow = Self::load(&env, escrow_id)?;
        Self::assert_locked(&escrow)?;

        let now = env.ledger().timestamp();
        let is_arbiter = escrow.arbiter.as_ref() == Some(&caller);

        if !is_arbiter {
            if caller != escrow.depositor {
                return Err(EscrowError::Unauthorized);
            }
            let refund_eligible_at = escrow
                .unlock_time
                .checked_add(REFUND_GRACE_SECONDS)
                .ok_or(EscrowError::ArithmeticOverflow)?;
            if now < refund_eligible_at {
                return Err(EscrowError::RefundNotYetAvailable);
            }
        }

        escrow.status = EscrowStatus::Refunded;
        env.storage().persistent().set(&(KEY_ESCROW, escrow_id), &escrow);

        let token_client = token::Client::new(&env, &escrow.token);
        token_client.transfer(&env.current_contract_address(), &escrow.depositor, &escrow.amount);

        events::emit_escrow_refunded(&env, escrow_id, &escrow.depositor, escrow.amount, &caller);
        Ok(())
    }

    /// Fetch an escrow by id.
    pub fn get_escrow(env: Env, escrow_id: u64) -> Result<Escrow, EscrowError> {
        Self::load(&env, escrow_id)
    }

    fn load(env: &Env, id: u64) -> Result<Escrow, EscrowError> {
        env.storage()
            .persistent()
            .get(&(KEY_ESCROW, id))
            .ok_or(EscrowError::EscrowNotFound)
    }

    fn assert_locked(escrow: &Escrow) -> Result<(), EscrowError> {
        match escrow.status {
            EscrowStatus::Locked => Ok(()),
            EscrowStatus::Released => Err(EscrowError::AlreadyReleased),
            EscrowStatus::Refunded => Err(EscrowError::AlreadyRefunded),
        }
    }

    fn next_id(env: &Env) -> u64 {
        let seq: u64 = env.storage().instance().get(&KEY_SEQ).unwrap_or(0u64);
        let next = seq.wrapping_add(1);
        env.storage().instance().set(&KEY_SEQ, &next);
        next
    }
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

#[cfg(test)]
mod test;
