//! A minimal SEP-41 token whose `transfer` deducts a fee before crediting
//! the recipient, used to reproduce fee-on-transfer/deflationary
//! underlying-token behavior in tests (#54). Everything not exercised by
//! `wrap`/`unwrap` (allowances, burning, metadata) is implemented as
//! simply as the trait allows.

#![cfg(test)]

use soroban_sdk::{
    contract, contractimpl, symbol_short, token::TokenInterface, Address, Env, String, Symbol,
};

const KEY_BAL: Symbol = symbol_short!("BAL");

/// Fee taken out of every transfer, in basis points out of 10_000. 1_000 =
/// 10%, matching the issue's own reproduction plan.
const FEE_BPS: i128 = 1_000;

#[contract]
pub struct FeeOnTransferToken;

#[contractimpl]
impl FeeOnTransferToken {
    /// Test-only helper to fund an address — not part of the SEP-41
    /// interface (minting is admin-specific and intentionally out of
    /// scope for it).
    pub fn mint(env: Env, to: Address, amount: i128) {
        let key = (KEY_BAL, to);
        let bal: i128 = env.storage().persistent().get(&key).unwrap_or(0);
        env.storage().persistent().set(&key, &(bal + amount));
    }
}

#[contractimpl]
impl TokenInterface for FeeOnTransferToken {
    fn allowance(_env: Env, _from: Address, _spender: Address) -> i128 {
        0
    }

    fn approve(
        _env: Env,
        _from: Address,
        _spender: Address,
        _amount: i128,
        _expiration_ledger: u32,
    ) {
    }

    fn balance(env: Env, id: Address) -> i128 {
        let key = (KEY_BAL, id);
        env.storage().persistent().get(&key).unwrap_or(0)
    }

    fn transfer(env: Env, from: Address, to: Address, amount: i128) {
        from.require_auth();

        let from_key = (KEY_BAL, from.clone());
        let from_bal: i128 = env.storage().persistent().get(&from_key).unwrap_or(0);
        assert!(from_bal >= amount, "insufficient balance");
        env.storage()
            .persistent()
            .set(&from_key, &(from_bal - amount));

        // The fee is simply not credited anywhere — burned — modeling a
        // deflationary token where the recipient receives strictly less
        // than the sender's balance decreased by.
        let fee = (amount * FEE_BPS) / 10_000;
        let received = amount - fee;

        let to_key = (KEY_BAL, to);
        let to_bal: i128 = env.storage().persistent().get(&to_key).unwrap_or(0);
        env.storage()
            .persistent()
            .set(&to_key, &(to_bal + received));
    }

    fn transfer_from(env: Env, _spender: Address, from: Address, to: Address, amount: i128) {
        Self::transfer(env, from, to, amount);
    }

    fn burn(env: Env, from: Address, amount: i128) {
        from.require_auth();
        let key = (KEY_BAL, from);
        let bal: i128 = env.storage().persistent().get(&key).unwrap_or(0);
        assert!(bal >= amount, "insufficient balance");
        env.storage().persistent().set(&key, &(bal - amount));
    }

    fn burn_from(env: Env, _spender: Address, from: Address, amount: i128) {
        Self::burn(env, from, amount);
    }

    fn decimals(_env: Env) -> u32 {
        7
    }

    fn name(env: Env) -> String {
        String::from_str(&env, "FeeOnTransferToken")
    }

    fn symbol(env: Env) -> String {
        String::from_str(&env, "FEE")
    }
}
