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

use soroban_sdk::{
    contract, contractimpl, symbol_short, token, Address, Env, Symbol,
};

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

        // Credit wrapped balance.
        let new_bal = Self::credit_wrapped(&env, &from, amount)?;

        // Pull underlying tokens into this contract.
        let token_client = token::Client::new(&env, &underlying);
        token_client.transfer(&from, &env.current_contract_address(), &amount);

        // Emit Wrapped event.
        env.events().publish(
            (symbol_short!("wrapped"), from.clone()),
            (underlying, amount),
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
