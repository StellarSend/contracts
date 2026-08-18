//! # TokenBridge Contract
//!
//! A lightweight wrap/unwrap bridge for non-native Stellar assets.
//!
//! Users deposit an **underlying token** and receive an equal amount of a
//! **wrapped token** (issued by this contract acting as an SAC admin).
//! The wrapped token can be used in the StellarSend DEX path or anywhere
//! else on the network.  Unwrapping burns the wrapped token and returns
//! the underlying.
//!
//! Balances are tracked in persistent storage so they survive ledger closes.
//!
//! Underlying-token assumptions
//! ─────────────────────────────
//! `underlying_token` is a single address chosen by the caller of
//! `initialize`, with no restriction on its implementation beyond it
//! answering the standard SEP-41 interface. `wrap` measures this
//! contract's actual balance gain around the inbound transfer (rather than
//! trusting the requested amount) and rejects with
//! `UnderlyingTransferShortfall` if it doesn't match — so a fee-on-transfer
//! or deflationary underlying token causes individual `wrap` calls to fail
//! cleanly instead of silently under-funding the single shared underlying
//! pool every wrapper's `unwrap` draws from (#54). This bridge does not
//! attempt to *support* such tokens (there is no partial-credit path); it
//! only refuses to let one wrapper's misbehaving-token deposit create a
//! shortfall that a later, unrelated wrapper's honest `unwrap` would pay
//! for.
//!
//! Storage layout
//! ──────────────
//! Instance:
//!   KEY_ADMIN            → Address
//!   KEY_UNDERLYING_TOKEN → Address
//!   KEY_INIT             → bool
//!
//! Persistent (keyed per holder):
//!   (KEY_WRAPPED_BAL, address) → i128

#![no_std]

use soroban_sdk::{contract, contractimpl, symbol_short, token, Address, Env, Symbol};

mod reentrancy;

// ---------------------------------------------------------------------------
// Storage keys
// ---------------------------------------------------------------------------

const KEY_ADMIN: Symbol = symbol_short!("ADMIN");
const KEY_UNDER: Symbol = symbol_short!("UNDER");
const KEY_INIT: Symbol = symbol_short!("INIT");
const KEY_WBAL: Symbol = symbol_short!("WBAL");

// ---------------------------------------------------------------------------
// Errors
// ---------------------------------------------------------------------------

#[soroban_sdk::contracterror]
#[derive(Copy, Clone, Debug, Eq, PartialEq)]
#[repr(u32)]
pub enum TokenBridgeError {
    AlreadyInitialized = 1,
    NotInitialized = 2,
    Unauthorized = 3,
    InvalidAmount = 4,
    InsufficientWrappedBalance = 5,
    ArithmeticOverflow = 6,
    /// The contract's measured underlying-token balance gain from `wrap`'s
    /// transfer didn't match the requested `amount` — most likely a
    /// fee-on-transfer or deflationary underlying token deducting more
    /// than it credited. Distinct from `InvalidAmount` (a bad caller
    /// input) since this is a mismatch discovered only after actually
    /// measuring the transfer's real effect (#54).
    UnderlyingTransferShortfall = 7,
}

// ---------------------------------------------------------------------------
// Contract
// ---------------------------------------------------------------------------

#[contract]
pub struct TokenBridgeContract;

#[contractimpl]
impl TokenBridgeContract {
    // -----------------------------------------------------------------------
    // Lifecycle
    // -----------------------------------------------------------------------

    /// Initialise the bridge.
    ///
    /// * `admin`            – Can pause/upgrade the bridge in future versions.
    /// * `underlying_token` – The SAC or Soroban token that users deposit.
    ///
    /// # Security: deploy exclusively through `factory` (#58)
    ///
    /// This function cannot verify *who* is calling it — the pinned
    /// `soroban-sdk` (21.7.7) has neither constructor support nor any API
    /// for a contract to learn who deployed it, so there is nothing here to
    /// check a caller against. Called directly against a raw, independently
    /// deployed instance, `initialize` is front-runnable: anyone watching
    /// the ledger for the deploy can call it first, choose an arbitrary
    /// `underlying_token`, and seize `admin` permanently. Instances MUST be
    /// deployed exclusively through the `factory` contract's
    /// `deploy_token_bridge`, which deploys and calls this function
    /// atomically within a single host invocation, so no
    /// externally-observable deployed-but-uninitialized state ever exists.
    /// See `factory`'s module doc comment for the full rationale.
    pub fn initialize(
        env: Env,
        admin: Address,
        underlying_token: Address,
    ) -> Result<(), TokenBridgeError> {
        if env.storage().instance().has(&KEY_INIT) {
            return Err(TokenBridgeError::AlreadyInitialized);
        }
        admin.require_auth();

        env.storage().instance().set(&KEY_ADMIN, &admin);
        env.storage().instance().set(&KEY_UNDER, &underlying_token);
        env.storage().instance().set(&KEY_INIT, &true);
        Ok(())
    }

    // -----------------------------------------------------------------------
    // Core operations
    // -----------------------------------------------------------------------

    /// Wrap `amount` of the underlying token.
    ///
    /// 1. Transfers `amount` of underlying from `from` to this contract.
    /// 2. Credits `amount` of wrapped tokens to `from` in internal ledger.
    ///
    /// The wrapped balance is tracked internally (not as a separate SAC),
    /// keeping gas costs minimal.  Integrations that need the wrapped token
    /// as a transferable SEP-41 asset should deploy a dedicated SAC and call
    /// this contract as its admin.
    pub fn wrap(env: Env, from: Address, amount: i128) -> Result<i128, TokenBridgeError> {
        let _guard = crate::reentrancy::ReentrancyGuard::new(&env);
        from.require_auth();
        Self::assert_initialized(&env)?;

        if amount <= 0 {
            return Err(TokenBridgeError::InvalidAmount);
        }

        let underlying: Address = env
            .storage()
            .instance()
            .get(&KEY_UNDER)
            .ok_or(TokenBridgeError::NotInitialized)?;

        let token_client = token::Client::new(&env, &underlying);
        let contract_address = env.current_contract_address();

        // Measure the contract's real underlying-token balance gain instead
        // of trusting `amount` — a fee-on-transfer or deflationary
        // underlying token can deduct more from `from` than it credits to
        // this contract. Crediting the wrapped balance with the requested
        // amount rather than what was actually received would silently
        // under-fund the single shared underlying pool every wrapper's
        // unwrap draws from, so a later, entirely honest unwrap by a
        // different user can trap even though their own ledger entry says
        // they're entitled to it (#54).
        let balance_before = token_client.balance(&contract_address);
        token_client.transfer(&from, &contract_address, &amount);
        let balance_after = token_client.balance(&contract_address);
        let received = balance_after
            .checked_sub(balance_before)
            .ok_or(TokenBridgeError::ArithmeticOverflow)?;

        if received != amount {
            return Err(TokenBridgeError::UnderlyingTransferShortfall);
        }

        // Credit wrapped balance with the measured amount actually received.
        let new_bal = Self::credit_wrapped(&env, &from, received)?;

        // Emit Wrapped event.
        env.events().publish(
            (symbol_short!("wrapped"), from.clone()),
            (underlying, received),
        );

        Ok(new_bal)
    }

    /// Unwrap `amount` of wrapped tokens.
    ///
    /// 1. Debits `amount` from `from`'s wrapped balance.
    /// 2. Transfers `amount` of underlying tokens from this contract to `from`.
    pub fn unwrap(env: Env, from: Address, amount: i128) -> Result<i128, TokenBridgeError> {
        let _guard = crate::reentrancy::ReentrancyGuard::new(&env);
        from.require_auth();
        Self::assert_initialized(&env)?;

        if amount <= 0 {
            return Err(TokenBridgeError::InvalidAmount);
        }

        let current_bal = Self::get_wrapped_balance_internal(&env, &from);
        if current_bal < amount {
            return Err(TokenBridgeError::InsufficientWrappedBalance);
        }

        let underlying: Address = env
            .storage()
            .instance()
            .get(&KEY_UNDER)
            .ok_or(TokenBridgeError::NotInitialized)?;

        // Debit wrapped balance.
        let new_bal = current_bal
            .checked_sub(amount)
            .ok_or(TokenBridgeError::ArithmeticOverflow)?;
        let bal_key = (KEY_WBAL, from.clone());
        env.storage().persistent().set(&bal_key, &new_bal);

        // Return underlying tokens.
        let token_client = token::Client::new(&env, &underlying);
        token_client.transfer(&env.current_contract_address(), &from, &amount);

        // Emit Unwrapped event.
        env.events().publish(
            (symbol_short!("unwrapped"), from.clone()),
            (underlying, amount),
        );

        Ok(new_bal)
    }

    // -----------------------------------------------------------------------
    // Queries
    // -----------------------------------------------------------------------

    /// Return the wrapped token balance of `holder`.
    pub fn get_wrapped_balance(env: Env, holder: Address) -> i128 {
        Self::get_wrapped_balance_internal(&env, &holder)
    }

    /// Return the underlying token address.
    pub fn get_underlying_token(env: Env) -> Result<Address, TokenBridgeError> {
        env.storage()
            .instance()
            .get(&KEY_UNDER)
            .ok_or(TokenBridgeError::NotInitialized)
    }

    /// Return the admin address.
    pub fn get_admin(env: Env) -> Result<Address, TokenBridgeError> {
        env.storage()
            .instance()
            .get(&KEY_ADMIN)
            .ok_or(TokenBridgeError::NotInitialized)
    }

    // -----------------------------------------------------------------------
    // Helpers
    // -----------------------------------------------------------------------

    fn assert_initialized(env: &Env) -> Result<(), TokenBridgeError> {
        if !env.storage().instance().has(&KEY_INIT) {
            return Err(TokenBridgeError::NotInitialized);
        }
        Ok(())
    }

    fn get_wrapped_balance_internal(env: &Env, holder: &Address) -> i128 {
        let bal_key = (KEY_WBAL, holder.clone());
        env.storage().persistent().get(&bal_key).unwrap_or(0i128)
    }

    fn credit_wrapped(env: &Env, holder: &Address, amount: i128) -> Result<i128, TokenBridgeError> {
        let current = Self::get_wrapped_balance_internal(env, holder);
        let new_bal = current
            .checked_add(amount)
            .ok_or(TokenBridgeError::ArithmeticOverflow)?;
        let bal_key = (KEY_WBAL, holder.clone());
        env.storage().persistent().set(&bal_key, &new_bal);
        Ok(new_bal)
    }
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

#[cfg(test)]
mod test;

#[cfg(test)]
mod test_fee_token;
